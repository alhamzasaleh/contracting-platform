/**
 * Deleting clients, surveys and quotes — the owner only (owner, Nov 2026). The database decides
 * (public.delete_client / delete_survey / delete_quote); these mirror its rules so the page can
 * disable the button with the reason, and map its refusals to messages (`errors.<key>`).
 */
export type DeleteBlock = "deletePartnerUsed" | "deleteQuoteContract" | "deleteQuoteAccepted" | "deleteSurveyQuotes" | "deleteClientContracts" | "deleteClientAccepted";

type Decision = string | null | undefined;

/** A quote with any contract (even cancelled) or accepted by the client on his page stays. */
export function quoteDeleteBlock(q: { hasContract: boolean; clientDecision?: Decision }): DeleteBlock | null {
  if (q.hasContract) return "deleteQuoteContract";
  if (q.clientDecision === "accepted") return "deleteQuoteAccepted";
  return null;
}

/** A survey with a quote built on it stays (the quote is priced from its rooms). */
export function surveyDeleteBlock(s: { quotes: number }): DeleteBlock | null {
  return s.quotes > 0 ? "deleteSurveyQuotes" : null;
}

/** A client with any contract stays; so does one with a quote the client accepted. */
export function clientDeleteBlock(c: { contracts: number; quotes: { hasContract?: boolean; clientDecision?: Decision }[] }): DeleteBlock | null {
  if (c.contracts > 0 || c.quotes.some((q) => q.hasContract)) return "deleteClientContracts";
  if (c.quotes.some((q) => q.clientDecision === "accepted")) return "deleteClientAccepted";
  return null;
}

/** A success partner with any quote, contract or reward stays (deactivate him instead). */
export function partnerDeleteBlock(p: { quotes: number; contracts: number; rewards: number }): DeleteBlock | null {
  return p.quotes + p.contracts + p.rewards > 0 ? "deletePartnerUsed" : null;
}

const REFUSALS: [RegExp, DeleteBlock][] = [
  [/partner has records/, "deletePartnerUsed"],
  [/quote has a contract/, "deleteQuoteContract"],
  [/quote accepted by the client/, "deleteQuoteAccepted"],
  [/survey has quotes/, "deleteSurveyQuotes"],
  [/client has contracts/, "deleteClientContracts"],
  [/client has an accepted quote/, "deleteClientAccepted"],
];

/** The database refusal → an error key (`errors.*`). */
export function deleteError(error: { code?: string; message: string }): DeleteBlock | "noAccess" | "error" {
  for (const [re, key] of REFUSALS) if (re.test(error.message)) return key;
  if (error.code === "42501") return "noAccess";
  return "error";
}
