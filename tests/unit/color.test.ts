import { describe, expect, it } from "vitest";
import { contrastRatio, deriveTheme, ensureContrast, hexToOklch, oklchToHex, readableOn } from "@/lib/brand/color";
import { extractPalette } from "@/lib/brand/extract";

function image(colors: [string, number][], transparent = 0): number[] {
  const px: number[] = [];
  for (const [hex, count] of colors) {
    const n = parseInt(hex.slice(1), 16);
    for (let i = 0; i < count; i++) px.push((n >> 16) & 255, (n >> 8) & 255, n & 255, 255);
  }
  for (let i = 0; i < transparent; i++) px.push(0, 0, 0, 0);
  return px;
}

describe("colour maths", () => {
  it("round-trips through OKLCH", () => {
    for (const hex of ["#0F766E", "#C2410C", "#1D4ED8", "#FFFFFF", "#000000"]) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
  });

  it("darkens a light brand colour until white text passes AA", () => {
    const fixed = ensureContrast("#FACC15", "#FFFFFF", 4.5);
    expect(contrastRatio(fixed, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(hexToOklch(fixed).h - hexToOklch("#FACC15").h)).toBeLessThan(25);
  });

  it("picks readable text colour", () => {
    expect(readableOn("#111111")).toBe("#FFFFFF");
    expect(readableOn("#F5F5F5")).toBe("#0B0B0F");
  });

  it("derives accessible light and dark themes", () => {
    const { light, dark } = deriveTheme("#F59E0B", null);
    expect(contrastRatio(light.primary, light.primaryForeground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dark.primary, dark.primaryForeground)).toBeGreaterThanOrEqual(4.5);
    expect(light.accent).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe("logo palette extraction", () => {
  it("ignores transparent and white background, finds brand colours", () => {
    const p = extractPalette(image([["#FFFFFF", 5000], ["#0E7490", 1200], ["#EA580C", 400]], 3000));
    expect(p).not.toBeNull();
    expect(p!.primary).toMatch(/^#0E7490|#0[DEF]7[0-9A-F]9[0-9A-F]$/);
    expect(p!.accent).not.toBeNull();
    expect(Math.abs(hexToOklch(p!.accent!).h - hexToOklch("#EA580C").h)).toBeLessThan(10);
  });

  it("prefers a colourful mark over a larger grey text block", () => {
    const p = extractPalette(image([["#6B7280", 3000], ["#16A34A", 800]]));
    expect(Math.abs(hexToOklch(p!.primary).h - hexToOklch("#16A34A").h)).toBeLessThan(10);
  });

  it("falls back to the darkest colour for a black-on-white logo", () => {
    const p = extractPalette(image([["#FFFFFF", 4000], ["#111111", 900]]));
    expect(hexToOklch(p!.primary).l).toBeLessThan(0.25);
    expect(p!.accent).toBeNull();
  });

  it("returns null for a fully transparent image", () => {
    expect(extractPalette(image([], 100))).toBeNull();
  });
});
