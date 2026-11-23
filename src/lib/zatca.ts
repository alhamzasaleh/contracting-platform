/**
 * ZATCA e-invoice QR (phase 1 / simplified tax invoice): TLV of
 * 1 seller name · 2 VAT number · 3 time stamp · 4 total incl. VAT · 5 VAT total,
 * encoded as Base64. Only for tax invoices (the company has a VAT number).
 * The official cleared e-invoice (phase 2) still comes from Qoyod.
 */
export type ZatcaFields = { seller: string; vatNumber: string; timestamp: string; total: number; vat: number };

function tlv(tag: number, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 255) throw new Error("value too long");
  const out = new Uint8Array(bytes.length + 2);
  out[0] = tag;
  out[1] = bytes.length;
  out.set(bytes, 2);
  return out;
}

export function zatcaQrPayload(f: ZatcaFields): string {
  const parts = [
    tlv(1, f.seller.slice(0, 120)),
    tlv(2, f.vatNumber),
    tlv(3, new Date(f.timestamp).toISOString().replace(/\.\d{3}Z$/, "Z")),
    tlv(4, f.total.toFixed(2)),
    tlv(5, f.vat.toFixed(2)),
  ];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    all.set(p, i);
    i += p.length;
  }
  return Buffer.from(all).toString("base64");
}

/** Decode (for tests and checks). */
export function zatcaQrDecode(b64: string): Record<number, string> {
  const bytes = Buffer.from(b64, "base64");
  const out: Record<number, string> = {};
  for (let i = 0; i < bytes.length; ) {
    const tag = bytes[i];
    const len = bytes[i + 1];
    out[tag] = new TextDecoder().decode(bytes.subarray(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return out;
}
