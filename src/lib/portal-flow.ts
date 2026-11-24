/**
 * Quote first, then contract (owner, Nov 2026 — §3.6 / §3.14). One client-page link for
 * every stage: issued from the quote, then followed by the contract made from it, the project
 * and the warranty. Pure helpers shared by the client page, the staff pages and the loaders.
 */
import type { QuoteStatus } from "@/lib/supabase/database.types";

export type QuoteDecision = "accepted" | "changes_requested" | "rejected";

export type QuoteStage = {
  state: "open" | "changes_requested" | "expired" | "accepted" | "rejected" | "revising" | "contract_draft";
  /** the client may accept the offer now */
  canAccept: boolean;
  /** the client may still answer (ask for changes / decline) */
  canAnswer: boolean;
};

/**
 * What the client page shows on the quote stage. Accepted / rejected are final; a change
 * request keeps the offer open (a new version clears it in the database); a quote being
 * revised (draft / waiting for approval) shows no document; an expired offer can't be
 * accepted but the client may ask for changes (= a renewed offer); a contract being prepared
 * from the quote → waiting for the contract.
 */
export function quoteStageState(q: { status: QuoteStatus; decision: QuoteDecision | null; contract: { status: string } | null; validUntil: string | null; today: string }): QuoteStage {
  const closed = (state: QuoteStage["state"]): QuoteStage => ({ state, canAccept: false, canAnswer: false });
  if (q.contract) return closed("contract_draft");
  if (q.decision === "accepted") return closed("accepted");
  if (q.decision === "rejected" || q.status === "rejected") return closed("rejected");
  if (q.status !== "issued") return closed("revising");
  if (q.validUntil && q.validUntil < q.today) return { state: "expired", canAccept: false, canAnswer: true };
  return { state: q.decision === "changes_requested" ? "changes_requested" : "open", canAccept: true, canAnswer: true };
}

/** Which message a refused answer shows (portal_accept_quote / _request_quote_changes / _reject_quote). */
export function quoteDecisionError(error: { code?: string; message?: string } | null | undefined): "chooseOption" | "quoteChanged" | "quoteExpired" | "alreadyDecided" | "quoteNotOpen" | "invalid" | null {
  if (!error) return null;
  const m = error.message ?? "";
  if (/offer changed/.test(m)) return "quoteChanged";
  if (/choose an option|no options on this quote/.test(m)) return "chooseOption";
  if (/quote expired/.test(m)) return "quoteExpired";
  if (/already decided/.test(m)) return "alreadyDecided";
  if (/quote not open/.test(m)) return "quoteNotOpen";
  if (error.code === "22023") return "invalid";
  return null;
}

export type PortalWaKey = "quoteLink" | "quoteSameLink" | "contractLink" | "contractSameLink" | "projectLink" | "projectSameLink";

/**
 * The WhatsApp text (messages → wa) for each stage. The link's token is shown once and never
 * stored, so without a freshly issued address the text points to the link already in the chat.
 */
export function portalWaKey(stage: "quote" | "contract" | "project", hasUrl: boolean): PortalWaKey {
  return `${stage}${hasUrl ? "Link" : "SameLink"}` as PortalWaKey;
}

/**
 * Past quotes (pricing suggestions): won = its contract was accepted; lost = declined by the
 * client (on his page or marked rejected), expired, or issued long ago with no contract — also
 * when the client accepted on his page but no contract followed within 30 days.
 * null = still open (not counted).
 */
export function quoteOutcome(
  q: { status: QuoteStatus; client_decision?: QuoteDecision | null; valid_until: string | null; updated_at: string },
  contract: { status: string } | null,
  monthAgo: string,
): "won" | "lost" | null {
  if (contract?.status === "accepted" || q.status === "accepted") return "won";
  if (contract) return null;
  if (q.status === "rejected" || q.client_decision === "rejected" || q.status === "expired") return "lost";
  if (q.status === "issued" && (q.valid_until ?? q.updated_at.slice(0, 10)) < monthAgo) return "lost";
  return null;
}

/**
 * What the client accepts: always the version on his screen (the picked option, else the
 * quote's current version) — the database refuses it if the offer changed meanwhile.
 */
export function acceptInput(p: { name: string; shown: { version: number } | null; quoteVersion: number | null }): { name: string; agree: true; version: number | null } {
  return { name: p.name.trim(), agree: true, version: p.shown?.version ?? p.quoteVersion };
}

export type QuoteWaiting = { number: string; client: string; kind: "contract" | "changes"; since: string; href: string };

/**
 * Home «عروض تنتظرك»: the client accepted on his page and no contract yet → create it; the
 * client asked for changes on an issued quote → revise it. Oldest answer first.
 */
export function quotesWaiting(
  rows: { number: string; client: string; decision: QuoteDecision | null; decided_at: string | null; status: QuoteStatus; hasContract: boolean }[],
): QuoteWaiting[] {
  return rows
    .flatMap((r): QuoteWaiting[] => {
      if (!r.decided_at || r.hasContract) return [];
      if (r.decision === "accepted" && r.status === "issued") return [{ number: r.number, client: r.client, kind: "contract", since: r.decided_at, href: `/contracts/new?quote=${r.number}` }];
      if (r.decision === "changes_requested") return [{ number: r.number, client: r.client, kind: "changes", since: r.decided_at, href: `/quotations/${r.number}` }];
      return [];
    })
    .sort((a, b) => a.since.localeCompare(b.since));
}

type MonthQuotes = { issued: number; accepted: number; changesRequested: number; rejected: number; numbers: { issued: string[]; accepted: string[]; changesRequested: string[]; rejected: string[] } };
export type QuoteMonthStats = Record<string, MonthQuotes>;

/**
 * Assistant facts: quotes per month — made (anything past draft / waiting for approval, by
 * the month it was created) and the client's answers (by the month he answered), with numbers.
 */
export function quoteMonthStats(rows: { number: string; created_at: string; decision: QuoteDecision | null; decided_at: string | null; status: QuoteStatus }[]): QuoteMonthStats {
  const out: QuoteMonthStats = {};
  const at = (m: string) => (out[m] ??= { issued: 0, accepted: 0, changesRequested: 0, rejected: 0, numbers: { issued: [], accepted: [], changesRequested: [], rejected: [] } });
  const add = (m: string, k: keyof MonthQuotes["numbers"], n: string) => {
    const x = at(m);
    x[k] += 1;
    if (x.numbers[k].length < 20) x.numbers[k].push(n);
  };
  for (const r of rows) {
    if (r.status !== "draft" && r.status !== "pending_approval") add(r.created_at.slice(0, 7), "issued", r.number);
    if (r.decision && r.decided_at) add(r.decided_at.slice(0, 7), r.decision === "changes_requested" ? "changesRequested" : r.decision, r.number);
  }
  return out;
}

/** Badge tone of the client's answer (quotes list, client page). */
export const DECISION_TONE = { accepted: "success", changes_requested: "warning", rejected: "danger" } as const;
