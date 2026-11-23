import { z } from "zod";

/**
 * Editable contract clauses (owner, Nov 2026). The standard clauses stay in
 * their legal order; the owner can hide one, rename it, replace its text, and add
 * his own clauses after any of them. Tables (scope, specifications, payments)
 * always come from the frozen quote. Texts may use placeholders that are filled
 * from the contract: {client} {contract} {quote} {total} {start} {end} {days} {warranty} {city}.
 */
export const CLAUSE_KEYS = [
  "annex", "scope", "specs", "value", "payments", "duration", "first", "second", "handover",
  "additional", "warranty", "termination", "force", "notices", "law", "extra", "signing",
] as const;
export type ClauseKey = (typeof CLAUSE_KEYS)[number];

export const PLACEHOLDERS = ["client", "contract", "quote", "total", "start", "end", "days", "warranty", "city"] as const;

const text = (max: number) => z.string().trim().max(max);
export const clauseOverrideSchema = z.object({ title: text(120).nullable().optional(), body: text(4000).nullable().optional(), hidden: z.boolean().optional() }).strict();
export const customClauseSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{4,40}$/), title: text(120).min(1), body: text(4000).min(1), after: z.enum(CLAUSE_KEYS) }).strict();
export const termsSchema = z
  .object({
    overrides: z.partialRecord(z.enum(CLAUSE_KEYS), clauseOverrideSchema).optional(),
    custom: z.array(customClauseSchema).max(30).optional(),
  })
  .strict();
export type ContractTermsConfig = z.infer<typeof termsSchema>;
export type CustomClause = z.infer<typeof customClauseSchema>;

/** Replace {placeholders} with the contract's values (unknown ones stay as typed). */
export function fillPlaceholders(body: string, values: Partial<Record<(typeof PLACEHOLDERS)[number], string>>): string {
  return body.replace(/\{([a-z]+)\}/g, (m, k: string) => (k in values && values[k as keyof typeof values] != null ? String(values[k as keyof typeof values]) : m));
}

/** Clauses that keep a table under the (editable) text. */
export const CLAUSES_WITH_TABLE: ClauseKey[] = ["scope", "specs", "payments"];
