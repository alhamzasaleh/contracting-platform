/**
 * §8.2: suggestions from the company's own past quotes — what margin it usually
 * wins at, typical price per m² per work type, and how long projects really take
 * versus plan. Pure and deterministic (no AI guessing with money); shown as a
 * suggestion the owner applies or ignores.
 */
export type PastQuote = {
  outcome: "won" | "lost";
  margin: number;
  workTypes: { workType: string; pricePerM2: number }[];
  plannedDays?: number | null;
  actualDays?: number | null;
};

export type PastStats = {
  won: number;
  lost: number;
  winRate: number | null;
  wonMargin: number | null;
  lostMargin: number | null;
  /** median margin of won quotes, rounded to 0.5 — null with fewer than 3 wins */
  suggestedMargin: number | null;
  pricePerM2: { workType: string; median: number; count: number }[];
  /** median actual ÷ planned duration of handed-over projects (e.g. 1.2 = 20 % longer) */
  durationFactor: number | null;
};

export function median(xs: number[]): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const r2 = (x: number) => Math.round(x * 100) / 100;

export function pastStats(list: PastQuote[], minMargin: number): PastStats {
  const won = list.filter((q) => q.outcome === "won");
  const lost = list.filter((q) => q.outcome === "lost");
  const wonMargin = median(won.map((q) => q.margin));
  const byType = new Map<string, number[]>();
  for (const q of won) for (const w of q.workTypes) if (w.pricePerM2 > 0) byType.set(w.workType, [...(byType.get(w.workType) ?? []), w.pricePerM2]);
  const ratios = won.filter((q) => q.plannedDays && q.actualDays).map((q) => q.actualDays! / q.plannedDays!);
  const factor = ratios.length >= 2 ? median(ratios) : null;
  return {
    won: won.length,
    lost: lost.length,
    winRate: won.length + lost.length >= 3 ? r2((won.length / (won.length + lost.length)) * 100) : null,
    wonMargin: wonMargin == null ? null : r2(wonMargin),
    lostMargin: median(lost.map((q) => q.margin)) == null ? null : r2(median(lost.map((q) => q.margin))!),
    suggestedMargin: won.length >= 3 && wonMargin != null ? Math.max(minMargin, Math.round(wonMargin * 2) / 2) : null,
    pricePerM2: [...byType.entries()].map(([workType, xs]) => ({ workType, median: r2(median(xs)!), count: xs.length })).sort((a, b) => b.count - a.count),
    durationFactor: factor == null ? null : r2(factor),
  };
}
