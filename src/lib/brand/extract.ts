import { deltaE, hexToOklch, rgbToHex } from "./color";

/**
 * Extracts brand colours from a logo's pixels (RGBA, e.g. from a canvas).
 * Pure function so it is testable and works in the browser or on the server.
 *
 * Approach: bucket opaque pixels (5 bits/channel), then rank buckets by
 * frequency weighted by colourfulness, skipping near-white/near-black
 * backgrounds. Neutral logos fall back to their darkest colour.
 */
export type ExtractedPalette = {
  primary: string;
  accent: string | null;
  swatches: string[]; // up to 6 distinct candidates, best first
};

export function extractPalette(pixels: Uint8ClampedArray | number[], maxSamples = 40_000): ExtractedPalette | null {
  const total = Math.floor(pixels.length / 4);
  if (total === 0) return null;
  const step = Math.max(1, Math.floor(total / maxSamples));

  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    const a = pixels[o + 3];
    if (a < 160) continue;
    const r = pixels[o], g = pixels[o + 1], b = pixels[o + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.r += r; bucket.g += g; bucket.b += b; bucket.n += 1;
    } else {
      buckets.set(key, { r, g, b, n: 1 });
    }
  }
  if (buckets.size === 0) return null;

  type Candidate = { hex: string; n: number; l: number; c: number; score: number };
  const candidates: Candidate[] = [];
  for (const { r, g, b, n } of buckets.values()) {
    const hex = rgbToHex({ r: r / n, g: g / n, b: b / n });
    const { l, c } = hexToOklch(hex);
    const nearWhite = l > 0.95 && c < 0.03;
    const nearBlack = l < 0.12 && c < 0.03;
    const colourful = Math.min(1, c / 0.12);
    candidates.push({
      hex,
      n,
      l,
      c,
      score: nearWhite || nearBlack ? n * 0.02 : n * (0.15 + colourful),
    });
  }

  // Merge perceptually similar colours so anti-aliasing doesn't dominate.
  candidates.sort((x, y) => y.score - x.score);
  const merged: Candidate[] = [];
  for (const cand of candidates) {
    const near = merged.find((m) => deltaE(m.hex, cand.hex) < 0.06);
    if (near) {
      near.score += cand.score;
      near.n += cand.n;
    } else {
      merged.push({ ...cand });
    }
  }
  merged.sort((x, y) => y.score - x.score);

  const chromatic = merged.filter((m) => m.c >= 0.045 && m.l > 0.12 && m.l < 0.95);
  const distinct: string[] = [];
  for (const m of [...chromatic, ...merged]) {
    if (distinct.every((d) => deltaE(d, m.hex) > 0.12)) distinct.push(m.hex);
    if (distinct.length >= 6) break;
  }

  let primary: string;
  if (chromatic.length > 0) {
    primary = chromatic[0].hex;
  } else {
    // Monochrome logo: use the darkest prominent colour (often a near-black).
    const dark = [...merged].filter((m) => m.n > 0).sort((x, y) => x.l - y.l)[0];
    primary = dark.l < 0.95 ? dark.hex : "#0F766E";
  }

  const primaryHue = hexToOklch(primary).h;
  const hueGap = (h: number) => Math.abs((((h - primaryHue) % 360) + 540) % 360 - 180);
  const accent =
    chromatic.slice(1).find((m) => deltaE(m.hex, primary) > 0.15 && hueGap(hexToOklch(m.hex).h) > 25)?.hex ?? null;

  return { primary, accent, swatches: distinct };
}
