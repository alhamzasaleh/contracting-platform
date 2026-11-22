import { expect, it } from "vitest";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

function keys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

it("Arabic and English have exactly the same message keys", () => {
  expect(keys(ar).sort()).toEqual(keys(en).sort());
});

it("message keys contain no dots (next-intl uses dots for nesting)", () => {
  const raw = (o: Record<string, unknown>): string[] =>
    Object.entries(o).flatMap(([k, v]) => [k, ...(v && typeof v === "object" ? raw(v as Record<string, unknown>) : [])]);
  expect(raw(ar).filter((k) => k.includes("."))).toEqual([]);
});
