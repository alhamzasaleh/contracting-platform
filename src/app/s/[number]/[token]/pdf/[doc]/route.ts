import { NextResponse } from "next/server";
import { pdfFileName, renderPdf } from "@/lib/pdf";
import { TOKEN_RE } from "@/lib/portal-token";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { SUB_NUMBER_RE, SUB_VOUCHER_RE } from "@/lib/subcontractors/statement";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Subcontractor page → PDF of his statement or one of his payment vouchers. The token is checked again by
 * the page being rendered; this route only maps it and rate-limits per visitor (like the client page).
 */
export async function GET(req: Request, { params }: { params: Promise<{ number: string; token: string; doc: string }> }) {
  const { number, token, doc } = await params;
  const n = decodeURIComponent(number);
  const d = decodeURIComponent(doc);
  if (!SUB_NUMBER_RE.test(n) || !TOKEN_RE.test(token)) return new NextResponse("Not found", { status: 404 });
  const base = `/s/${encodeURIComponent(n)}/${token}`;
  const path = d === "statement" ? `${base}/statement` : SUB_VOUCHER_RE.test(d) ? `${base}/voucher/${encodeURIComponent(d)}` : null;
  if (!path) return new NextResponse("Not found", { status: 404 });
  if ((await rateLimit(`sub:pdf:${await clientIp()}`, 10, 600)) !== "ok") return new NextResponse("Too many requests", { status: 429 });
  try {
    const pdf = await renderPdf(new URL(req.url).origin, path);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfFileName(d === "statement" ? `${n}-statement` : d)}"`,
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    console.error("[pdf] subcontractor render failed", { name: (e as Error).name }); // never the message: it may hold the token
    return new NextResponse("PDF failed", { status: 500 });
  }
}
