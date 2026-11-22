import { ceilInt } from "./math";

export type PackOption = { size: number; price: number };
export type PackChoice = { size: number; count: number; price: number };
export type PackResult = { packs: PackChoice[]; volume: number; cost: number; leftover: number };

/**
 * Cheapest combination of pack sizes whose total volume covers `need`
 * (unbounded knapsack over 1/100 units). Ties: least leftover, then fewest
 * packs. E.g. 83.5 L with 18 L @180 and 4 L @45 → 4×18 + 3×4 (855) rather
 * than 5×18 (900).
 */
export function optimisePacks(need: number, options: PackOption[]): PackResult {
  const opts = options.filter((o) => o.size > 0);
  if (need <= 0 || opts.length === 0) return { packs: [], volume: 0, cost: 0, leftover: 0 };

  const SCALE = 100;
  const target = ceilInt(need * SCALE);
  const sizes = opts.map((o) => Math.round(o.size * SCALE));
  // best[v] = best way to cover at least v units: [cost, volume, count, optionIndex, prev]
  const cost = new Float64Array(target + 1).fill(Infinity);
  const vol = new Float64Array(target + 1);
  const cnt = new Float64Array(target + 1);
  const pick = new Int32Array(target + 1).fill(-1);
  const prev = new Int32Array(target + 1).fill(-1);
  cost[0] = 0;

  const better = (c: number, v: number, n: number, i: number) =>
    c < cost[i] - 1e-9 ||
    (Math.abs(c - cost[i]) <= 1e-9 && (v < vol[i] || (v === vol[i] && n < cnt[i])));

  for (let v = 1; v <= target; v++) {
    for (let k = 0; k < opts.length; k++) {
      const from = Math.max(0, v - sizes[k]);
      if (cost[from] === Infinity) continue;
      const c = cost[from] + opts[k].price;
      const vv = vol[from] + sizes[k];
      const n = cnt[from] + 1;
      if (better(c, vv, n, v)) {
        cost[v] = c;
        vol[v] = vv;
        cnt[v] = n;
        pick[v] = k;
        prev[v] = from;
      }
    }
  }

  const counts = new Map<number, number>();
  for (let v = target; v > 0 && pick[v] >= 0; v = prev[v]) counts.set(pick[v], (counts.get(pick[v]) ?? 0) + 1);
  const packs = [...counts.entries()]
    .map(([k, count]) => ({ size: opts[k].size, count, price: opts[k].price }))
    .sort((a, b) => b.size - a.size);
  const volume = vol[target] / SCALE;
  return { packs, volume, cost: cost[target], leftover: Math.round((volume - need) * 1000) / 1000 };
}
