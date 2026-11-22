/**
 * Cut optimisation: lay required run lengths onto stock bars with offcut
 * reuse (first-fit-decreasing). Runs longer than a bar use full bars plus
 * a remainder piece (a joint). Returns bar count and the offcuts left.
 */
export type CutResult = { bars: number; offcuts: number[]; usedLength: number; stockLength: number };

const EPS = 1e-6;

export function cutToBars(runs: number[], stockLength: number): CutResult {
  if (stockLength <= 0) throw new Error("stockLength must be > 0");
  const pieces: number[] = [];
  let fullBars = 0;
  for (const r of runs) {
    if (r <= EPS) continue;
    const whole = Math.floor((r + EPS) / stockLength);
    const rest = r - whole * stockLength;
    fullBars += whole;
    if (rest > EPS) pieces.push(rest);
  }
  pieces.sort((a, b) => b - a);
  const remaining: number[] = [];
  for (const p of pieces) {
    const i = remaining.findIndex((left) => left + EPS >= p);
    if (i >= 0) remaining[i] -= p;
    else remaining.push(stockLength - p);
  }
  const offcuts = remaining.map((x) => Math.round(x * 1000) / 1000).filter((x) => x > 0.001);
  const usedLength = runs.reduce((a, b) => a + b, 0);
  return { bars: fullBars + remaining.length, offcuts, usedLength, stockLength };
}

/** Same as cutToBars for `count` identical pieces. */
export function cutIdentical(count: number, pieceLength: number, stockLength: number): CutResult {
  return cutToBars(Array.from({ length: Math.max(0, Math.round(count)) }, () => pieceLength), stockLength);
}
