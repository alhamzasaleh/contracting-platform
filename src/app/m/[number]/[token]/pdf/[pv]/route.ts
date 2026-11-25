import { NextResponse } from "next/server";
import { pdfFileName, renderPdf } from "@/lib/pdf";
import { MARKETER_NUMBER_RE } from "@/lib/marketers";
import { VOUCHER_RE } from "@/lib/marketer-portal";
import { TOKEN_RE } from "@/lib/portal-token";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Partner page → PDF of one of his payment vouchers. The token is checked again by the voucher
 * page being rendered; this route only maps it and rate-limits per visitor (like the client page).
 */
export async function GET(req: Request, { params }: { params: Promise<{ number: string; token: string; pv: string }> }) {
  const { number, token, pv } = await params;
  const n = decodeURIComponent(number);
  const v = decodeURIComponent(pv);
  if (!MARKETER_NUMBER_RE.test(n) || !TOKEN_RE.test(token) || !VOUCHER_RE.test(v)) return new NextResponse("Not found", { status: 404 });
  if ((await rateLimit(`marketer:pdf:${await clientIp()}`, 10, 600)) !== "ok") return new NextResponse("Too many requests", { status: 429 });
  try {
    const pdf = await renderPdf(new URL(req.url).origin, `/m/${encodeURIComponent(n)}/${token}/voucher/${encodeURIComponent(v)}`);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfFileName(v)}"`,
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    console.error("[pdf] partner render failed", { name: (e as Error).name }); // never the message: it may hold the token
    return new NextResponse("PDF failed", { status: 500 });
  }
}
