import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Runs before every page request:
 *  1. Generates a per-request CSP nonce (strict script policy).
 *  2. Refreshes the Supabase session cookie.
 *  3. Sends signed-out visitors to /login (pages still re-check on the server).
 */

const PUBLIC_PATHS = ["/login", "/auth", "/p", "/setup", "/dev/preview", "/offline"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function buildCsp(nonce: string, supabaseUrl?: string) {
  const isDev = process.env.NODE_ENV === "development";
  const supabase = supabaseUrl ? new URL(supabaseUrl).origin : "";
  const supabaseWs = supabase.replace(/^http/, "ws");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are needed by animation libraries; scripts stay strict.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${supabase}`.trim(),
    "font-src 'self' data:",
    `connect-src 'self' ${supabase} ${supabaseWs}`.trim(),
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const csp = buildCsp(nonce, supabaseUrl);
  const { pathname, search } = request.nextUrl;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const finalize = (res: NextResponse) => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  // Not connected to Supabase yet: show the friendly setup page.
  if (!supabaseUrl || !supabaseKey) {
    if (isPublic(pathname)) return finalize(NextResponse.next({ request: { headers: requestHeaders } }));
    return finalize(NextResponse.redirect(new URL("/setup", request.url)));
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Validates the JWT (signature + expiry) and refreshes it if needed.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && !isPublic(pathname)) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    const redirect = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return finalize(redirect);
  }

  if (signedIn && pathname === "/login") {
    const redirect = NextResponse.redirect(new URL("/", request.url));
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return finalize(redirect);
  }

  return finalize(response);
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
