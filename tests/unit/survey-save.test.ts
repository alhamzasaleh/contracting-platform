import { describe, expect, it } from "vitest";
import { surveyTotalsSchema } from "@/lib/survey/schema";
import { actionFailureToast } from "@/lib/client/action-failure";

describe("saving a survey by total areas", () => {
  it("accepts hatches for only some sizes (one size typed is the usual case)", () => {
    expect(surveyTotalsSchema.safeParse({ walls: 100, hatches: { "40x40": 2 } }).success).toBe(true);
    expect(surveyTotalsSchema.safeParse({ hatches: {} }).success).toBe(true);
  });
  it("still refuses unknown sizes, negative or fractional counts, and unknown fields", () => {
    expect(surveyTotalsSchema.safeParse({ hatches: { "10x10": 1 } }).success).toBe(false);
    expect(surveyTotalsSchema.safeParse({ hatches: { "40x40": -1 } }).success).toBe(false);
    expect(surveyTotalsSchema.safeParse({ hatches: { "40x40": 1.5 } }).success).toBe(false);
    expect(surveyTotalsSchema.safeParse({ gypsumRooms: [] }).success).toBe(false);
  });
});

describe("a refused save is never silent", () => {
  it("field errors with no form to show them → a message", () => {
    expect(actionFailureToast({ ok: false, error: "invalid", fieldErrors: { "totals.hatches": "x" } }, false)).toBe(true);
  });
  it("field errors shown by the form → no extra message; other errors → a message", () => {
    expect(actionFailureToast({ ok: false, error: "invalid", fieldErrors: { name: "required" } }, true)).toBe(false);
    expect(actionFailureToast({ ok: false, error: "error" }, true)).toBe(true);
  });
});
