import { NextResponse } from "next/server";
import { pdfFileName, renderPdf } from "@/lib/pdf";
import { NUMBER_RE, TOKEN_RE } from "@/lib/portal";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Client page → PDF of one document: quote-<version> | contract | handover | RV-… | INV-….
 * The token in the URL is checked again by the page being rendered; this route
 * only maps the document to that page and rate-limits per visitor.
 */
export async function GET(req: Request, { params }: { params: Promise<{ number: string; token: string; doc: string }> }) {
  const { number, token, doc } = await params;
  const n = decodeURIComponent(number);
  const d = decodeURIComponent(doc);
  if (!NUMBER_RE.test(n) || !TOKEN_RE.test(token)) return new NextResponse("Not found", { status: 404 });
  const base = `/p/${encodeURIComponent(n)}/${token}`;
  const quoteVersion = /^quote-(\d{1,4})$/.exec(d)?.[1];
  const path =
    quoteVersion ? `${base}/quote?v=${quoteVersion}`
    : d === "contract" ? `${base}/contract`
    : d === "handover" ? `${base}/handover`
    : /^RV-\d{4}-\d{3,6}$/.test(d) ? `${base}/receipt/${d}`
    : /^INV-\d{4}-\d{3,6}$/.test(d) ? `${base}/bill/${d}`
    : null;
  if (!path) return new NextResponse("Not found", { status: 404 });
  if ((await rateLimit(`portal:pdf:${await clientIp()}`, 10, 600)) !== "ok") return new NextResponse("Too many requests", { status: 429 });
  try {
    const pdf = await renderPdf(new URL(req.url).origin, path);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfFileName(quoteVersion ? `${n}-v${quoteVersion}` : d === "contract" || d === "handover" ? `${n}-${d}` : d)}"`,
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    console.error("[pdf] portal render failed", { name: (e as Error).name }); // never the message: it may hold the page URL (token)
    return new NextResponse("PDF failed", { status: 500 });
  }
}
