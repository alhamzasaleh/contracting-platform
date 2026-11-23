/** Every formula the engine can show has an Arabic and English text (no English in the Arabic UI). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FORMULA_KEYS } from "@/lib/engine/formula-keys";

const ar = JSON.parse(readFileSync("messages/ar.json", "utf8"));
const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
const sources = ["src/lib/engine/gypsum.ts", "src/lib/engine/paint.ts", "src/lib/pricing/index.ts"].map((f) => readFileSync(f, "utf8")).join("\n");

describe("formula translations", () => {
  it("every engine formula literal is mapped", () => {
    const literals = [...sources.matchAll(/formula: "([^"]+)"/g)].map((m) => m[1]);
    const passed = [...sources.matchAll(/, "([^"]*(?:×|÷|≈|per hanger|onto)[^"]*)"/g)].map((m) => m[1]);
    const missing = [...literals, ...passed].filter((f) => !FORMULA_KEYS[f]);
    expect(missing).toEqual([]);
  });

  it("every mapped formula has Arabic and English text", () => {
    for (const key of Object.values(FORMULA_KEYS)) {
      expect(ar.formulas[key], key).toBeTruthy();
      expect(en.formulas[key], key).toBeTruthy();
    }
  });
});
