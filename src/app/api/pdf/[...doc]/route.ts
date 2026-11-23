import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { LOCALE_COOKIE, NUMERALS_COOKIE } from "@/i18n/config";
import { getSession } from "@/lib/auth/session";
import { pdfFileName, renderPdf, STAFF_DOCS } from "@/lib/pdf";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Staff PDF download: /api/pdf/quotations/Q-2026-001 → the print page rendered
 * by the server as the signed-in user (their own session cookies, so the page's
 * permission checks and RLS apply exactly as on screen).
 */
export async function GET(req: Request, { params }: { params: Promise<{ doc: string[] }> }) {
  const { doc } = await params;
  const path = doc.map((d) => decodeURIComponent(d)).join("/");
  if (!STAFF_DOCS.test(path)) return new NextResponse("Not found", { status: 404 });
  const session = await getSession();
  if ((await rateLimit(`pdf:${session.userId}`, 30, 600)) !== "ok") return new NextResponse("Too many requests", { status: 429 });
  const jar = await cookies();
  // the caller's own session + language settings only
  const own = jar.getAll().filter((c) => c.name.startsWith("sb-") || c.name === LOCALE_COOKIE || c.name === NUMERALS_COOKIE);
  try {
    const pdf = await renderPdf(new URL(req.url).origin, `/print/${path}`, own);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfFileName(path.split("/")[1])}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("[pdf] render failed", { doc: path.split("/")[0], message: (e as Error).message.slice(0, 120) });
    return new NextResponse("PDF failed", { status: 500 });
  }
}
