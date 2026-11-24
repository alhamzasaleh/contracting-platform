import { NextResponse, type NextRequest } from "next/server";
import { signOutEndpoint } from "@/lib/notifications/endpoint";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  // Same-origin check (forms post here from the app only).
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const supabase = await createClient();
  // This device stops receiving the signed-out user's notifications (shared iPad): the app
  // sends its push endpoint; only the caller's own row can be deleted (RLS).
  if (request.headers.get("content-type")?.startsWith("application/json")) {
    const endpoint = signOutEndpoint(await request.json().catch(() => null));
    if (endpoint) {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        const { error } = await supabase.from("push_subscriptions").delete().eq("user_id", data.user.id).eq("endpoint", endpoint);
        if (error) console.error("[push] sign-out removal failed", { code: error.code });
      }
    }
  }
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
