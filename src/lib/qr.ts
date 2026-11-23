import "server-only";
import QRCode from "qrcode";
import type { InvoiceDoc } from "@/lib/invoices";
import { zatcaQrPayload } from "@/lib/zatca";

/** A QR code as an SVG data URL (rendered on the server, no external service). */
export async function qrDataUrl(text: string): Promise<string> {
  const svg = await QRCode.toString(text, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#22262A", light: "#FFFFFF" } });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** The ZATCA QR for a tax invoice; null for a plain invoice (no VAT number). */
export async function invoiceQr(inv: Pick<InvoiceDoc, "kind" | "seller" | "issue_date" | "created_at" | "total" | "vat">): Promise<string | null> {
  if (inv.kind !== "tax" || !inv.seller.vat_number) return null;
  return qrDataUrl(
    zatcaQrPayload({
      seller: inv.seller.legal_name ?? inv.seller.name ?? "",
      vatNumber: inv.seller.vat_number,
      timestamp: inv.created_at ?? `${inv.issue_date}T00:00:00Z`,
      total: inv.total,
      vat: inv.vat,
    }),
  );
}
