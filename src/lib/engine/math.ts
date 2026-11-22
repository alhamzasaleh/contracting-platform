/** Rounding helpers that are robust to floating-point noise. */
const EPS = 1e-9;

export function ceilInt(x: number): number {
  return Math.ceil(x - EPS);
}

/** Round up to a step (e.g. 1, 0.5, 0.25, 0.01 SAR). */
export function ceilTo(x: number, step: number): number {
  if (step <= 0) return x;
  return Math.round(ceilInt(x / step) * step * 1e6) / 1e6;
}

export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
