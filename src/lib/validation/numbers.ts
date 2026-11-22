import { z } from "zod";

/** Accepts numbers typed with Arabic-Indic digits, Arabic separators or commas. */
export function toNumber(v: unknown): unknown {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return v;
  const s = v
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/٫/g, ".")
    .replace(/[٬,\s]/g, "");
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : v;
}

export const num = (opts: { min?: number; max?: number } = {}) => {
  let s = z.number({ error: "number" });
  if (opts.min !== undefined) s = s.min(opts.min, "range");
  if (opts.max !== undefined) s = s.max(opts.max, "range");
  return z.preprocess(toNumber, s);
};

export const optionalNum = (opts: { min?: number; max?: number } = {}) =>
  z.preprocess((v) => {
    const n = toNumber(v);
    return n === undefined || n === null || n === "" ? null : n;
  }, (() => {
    let s = z.number({ error: "number" });
    if (opts.min !== undefined) s = s.min(opts.min, "range");
    if (opts.max !== undefined) s = s.max(opts.max, "range");
    return s.nullable();
  })());

export const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v), z.string().max(max).nullable().optional());

export const optionalDate = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date").nullable(),
);
