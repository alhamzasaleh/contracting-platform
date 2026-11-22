/**
 * Small, dependency-free colour toolkit (sRGB ⇄ OKLab/OKLCH, WCAG contrast).
 * Used to derive an accessible UI theme from the company's brand colour.
 */

export type RGB = { r: number; g: number; b: number }; // 0..255
export type OKLCH = { l: number; c: number; h: number }; // l 0..1, c 0..~0.4, h degrees

export function isHex(v: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(v);
}

export function hexToRgb(hex: string): RGB {
  if (!isHex(hex)) throw new Error(`Invalid hex colour: ${hex}`);
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (x: number) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => {
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return s * 255;
};

export function rgbToOklab({ r, g, b }: RGB) {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb({ L, a, b }: { L: number; a: number; b: number }): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

export function hexToOklch(hex: string): OKLCH {
  const { L, a, b } = rgbToOklab(hexToRgb(hex));
  const c = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

function inGamut({ r, g, b }: RGB) {
  return [r, g, b].every((x) => x >= -0.5 && x <= 255.5);
}

/** OKLCH → hex, reducing chroma until the colour fits in sRGB. */
export function oklchToHex({ l, c, h }: OKLCH): string {
  const rad = (h * Math.PI) / 180;
  let chroma = c;
  for (let i = 0; i < 40; i++) {
    const rgb = oklabToRgb({ L: l, a: chroma * Math.cos(rad), b: chroma * Math.sin(rad) });
    if (inGamut(rgb)) return rgbToHex(rgb);
    chroma *= 0.92;
  }
  return rgbToHex(oklabToRgb({ L: l, a: 0, b: 0 }));
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Distance in OKLab — perceptual difference between two colours. */
export function deltaE(a: string, b: string): number {
  const x = rgbToOklab(hexToRgb(a));
  const y = rgbToOklab(hexToRgb(b));
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

/** Pick white or near-black text, whichever reads better on `bg`. */
export function readableOn(bg: string): string {
  return contrastRatio(bg, "#FFFFFF") >= contrastRatio(bg, "#0B0B0F") ? "#FFFFFF" : "#0B0B0F";
}

/**
 * Adjust lightness (keeping hue/chroma feel) until `fg` text on the colour
 * reaches `target` contrast. Used so brand-coloured buttons stay WCAG AA.
 */
export function ensureContrast(hex: string, fg: string, target = 4.5): string {
  if (contrastRatio(hex, fg) >= target) return hex.toUpperCase();
  const base = hexToOklch(hex);
  const darken = relativeLuminance(fg) > 0.5;
  let { l } = base;
  for (let i = 0; i < 60; i++) {
    l = darken ? l - 0.01 : l + 0.01;
    if (l <= 0 || l >= 1) break;
    const candidate = oklchToHex({ ...base, l });
    if (contrastRatio(candidate, fg) >= target) return candidate;
  }
  return darken ? "#0B0B0F" : "#FFFFFF";
}

export type ThemeTokens = {
  primary: string;
  primaryForeground: string;
  accent: string;
  accentForeground: string;
};

/** Accessible primary/accent for light and dark UI from the raw brand colours. */
export function deriveTheme(primary: string, accent?: string | null) {
  const acc = accent && isHex(accent) ? accent : oklchToHex({ ...hexToOklch(primary), h: (hexToOklch(primary).h + 150) % 360 });

  const light: ThemeTokens = {
    primary: ensureContrast(primary, "#FFFFFF", 4.5),
    primaryForeground: "#FFFFFF",
    accent: ensureContrast(acc, "#FFFFFF", 4.5),
    accentForeground: "#FFFFFF",
  };

  // Dark UI: brighten so the colour stands out on near-black, then pick text.
  const brighten = (hex: string) => {
    const o = hexToOklch(hex);
    return oklchToHex({ ...o, l: Math.max(o.l, 0.68) });
  };
  const dp = brighten(primary);
  const da = brighten(acc);
  const dark: ThemeTokens = {
    primary: dp,
    primaryForeground: readableOn(dp),
    accent: da,
    accentForeground: readableOn(da),
  };
  return { light, dark };
}
