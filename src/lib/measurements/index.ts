/**
 * Measurement sheets (owner, Nov 2026): the actual m² per work type against the contract's agreed m².
 * Pure — mirrors private.measurement_fill (the database recomputes and is the source of truth).
 */

export type MeasureBasis = {
  method: "unit" | "lump";
  workTypes: { workType: string; area: number; pricePerM2: number }[];
  discountPercent: number;
  vatPercent: number;
};

export type MeasureLine = {
  work_type: string;
  agreed_area: number;
  measured_area: number;
  price_per_m2: number;
  diff_area: number;
  diff_amount: number;
};

export type MeasurementStatus = "draft" | "sent" | "approved" | "objected";

export type Measurement = {
  id: string;
  number: string;
  status: MeasurementStatus;
  lines: MeasureLine[];
  notes: string | null;
  photos: { path: string; url: string | null }[];
  diff_subtotal: number;
  diff_vat: number;
  diff_total: number;
  sent_at: string | null;
  client_decided_at: string | null;
  client_name: string | null;
  client_note: string | null;
  credit_amount: number;
  refunded_at: string | null;
};

/** money rounding like Postgres round(x, 2): half away from zero */
export function r2(x: number): number {
  const a = Math.abs(x);
  return Math.sign(x) * Math.round(Number(`${a.toFixed(6)}e2`)) / 100 || 0;
}

/** The database's basis (public.measurement_basis) → typed; null when missing. */
export function toBasis(raw: unknown): MeasureBasis | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as { method?: string; work_types?: { workType?: string; area?: unknown; pricePerM2?: unknown }[]; discount_percent?: unknown; vat_percent?: unknown };
  return {
    method: b.method === "lump" ? "lump" : "unit",
    workTypes: (Array.isArray(b.work_types) ? b.work_types : [])
      .filter((w) => typeof w.workType === "string")
      .map((w) => ({ workType: w.workType as string, area: Number(w.area) || 0, pricePerM2: Number(w.pricePerM2) || 0 })),
    discountPercent: Math.min(100, Math.max(0, Number(b.discount_percent) || 0)),
    vatPercent: Math.max(0, Number(b.vat_percent) || 0),
  };
}

/** The difference the database will compute for these measured areas (preview in the dialog). */
export function measureDiff(basis: MeasureBasis, entries: { workType: string; measured: number }[]) {
  const lines: MeasureLine[] = [];
  let sum = 0;
  for (const e of entries) {
    const w = basis.workTypes.find((x) => x.workType === e.workType);
    if (!w) continue;
    const measured = r2(e.measured);
    const agreed = r2(w.area);
    const diffArea = r2(measured - agreed);
    const amount = r2(diffArea * w.pricePerM2);
    lines.push({ work_type: e.workType, agreed_area: agreed, measured_area: measured, price_per_m2: w.pricePerM2, diff_area: diffArea, diff_amount: amount });
    sum += amount;
  }
  const subtotal = r2(r2(sum) * (1 - basis.discountPercent / 100));
  const vat = r2((subtotal * basis.vatPercent) / 100);
  return { lines, subtotal, vat, total: r2(subtotal + vat) };
}

/** Work types of the contract not yet on another sheet (each work type is measured once). */
export function measurableTypes(basis: MeasureBasis, sheets: Pick<Measurement, "id" | "lines">[], exceptId?: string): string[] {
  const taken = new Set(sheets.filter((s) => s.id !== exceptId).flatMap((s) => s.lines.map((l) => l.work_type)));
  return basis.workTypes.map((w) => w.workType).filter((w) => !taken.has(w));
}

/** Totals over the sheets the client approved: value change (before VAT / with VAT) and what is owed to him. */
export function measurementTotals(sheets: Pick<Measurement, "status" | "diff_subtotal" | "diff_total" | "credit_amount" | "refunded_at">[]) {
  const ok = sheets.filter((s) => s.status === "approved");
  return {
    net: r2(ok.reduce((a, s) => a + s.diff_subtotal, 0)),
    total: r2(ok.reduce((a, s) => a + s.diff_total, 0)),
    owed: r2(ok.filter((s) => !s.refunded_at).reduce((a, s) => a + s.credit_amount, 0)),
  };
}

/** The database's refusal → a message key under «measure». */
export function measurementError(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("lump sum contract")) return "measureLump";
  if (m.includes("already measured")) return "measureTaken";
  if (m.includes("work type not in the contract")) return "measureUnknownType";
  if (m.includes("isn't accepted")) return "notAccepted";
  if (m.includes("can't change") || m.includes("already sent") || m.includes("can't be deleted")) return "measureLocked";
  if (m.includes("empty measurement")) return "measureEmpty";
  if (m.includes("nothing to refund")) return "measureNothingToRefund";
  if (m.includes("measurement pending")) return "measurePending";
  if (m.includes("invalid measurement") || m.includes("invalid photo")) return "invalid";
  return "error";
}

/** A contract can be measured only when priced per m² (lump sum: no settlement). */
export const canMeasure = (basis: MeasureBasis | null) => !!basis && basis.method === "unit" && basis.workTypes.length > 0;
