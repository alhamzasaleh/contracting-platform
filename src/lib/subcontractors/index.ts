/**
 * Subcontractors & petty cash (Phase 8) — pure helpers.
 */
const r2 = (x: number) => Math.round(x * 100) / 100;

export type Agreement = { basis: "lump" | "per_m2"; rate: number; quantity_m2: number | null };

/** Agreed total: lump sum, or rate × agreed area. */
export const agreementTotal = (g: Agreement) => r2(g.basis === "lump" ? g.rate : g.rate * (g.quantity_m2 ?? 0));

/** Earned so far vs paid (no retention): what's due now, what's left on the agreement, and warnings. */
export function subSummary(g: Agreement, earned: number, paid: number) {
  const total = agreementTotal(g);
  return {
    total,
    earned: r2(earned),
    paid: r2(paid),
    due: r2(Math.max(0, earned - paid)),
    remaining: r2(total - paid),
    overpaid: paid > earned + 0.005, // paid ahead of the work done (warn, don't block)
    overEarned: earned > total + 0.005, // more work recorded than agreed (variation?)
    progress: total > 0 ? Math.min(100, Math.round((earned / total) * 100)) : 0,
  };
}

/** What a work entry earns (the database computes the same; shown before saving). */
export const workAmount = (g: Agreement, input: { quantity_m2?: number | null; percent?: number | null }) =>
  r2(g.basis === "per_m2" ? (input.quantity_m2 ?? 0) * g.rate : (g.rate * (input.percent ?? 0)) / 100);

/** What is still left to record on an agreement: area (per m²) or share of the job in % (lump sum). The database refuses more. */
export function workRemaining(g: Agreement, work: { quantity_m2: number | null; percent: number | null }[]): number {
  const done = work.reduce((s, w) => s + (g.basis === "per_m2" ? (w.quantity_m2 ?? 0) : (w.percent ?? 0)), 0);
  return r2(Math.max(0, (g.basis === "per_m2" ? (g.quantity_m2 ?? 0) : 100) - done));
}

/** A refused work entry (price_subcontractor_work) → a message key for the person. */
export function subWorkError(message: string | null | undefined): "subWorkOver" | "agreementClosed" | null {
  if (!message) return null;
  if (/more than the agreement/.test(message)) return "subWorkOver";
  if (/agreement is closed/.test(message)) return "agreementClosed";
  return null;
}

export type PettyEntry = { kind: "topup" | "expense" | "return"; amount: number };

/** Petty cash balance: top-ups minus expenses and cash returned. Negative = the holder fronted money. */
export const pettyBalance = (entries: PettyEntry[]) => r2(entries.reduce((s, e) => s + (e.kind === "topup" ? e.amount : -e.amount), 0));
