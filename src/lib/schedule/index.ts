/**
 * Scheduling (Phase 5) — pure helpers, no I/O.
 * Dates are "YYYY-MM-DD" strings; a span is inclusive (start … end).
 * Durations are calendar days, the same as the contract's duration.
 */
import type { ServiceKind } from "@/lib/pricing";

export type Day = string;
export type Span = { start: Day; end: Day };
export type Entry = Span & { id?: string; team_id: string; contract_id?: string | null; kind?: "work" | "leave" | "other" };
export type TeamInfo = { id: string; name: string; services: ServiceKind[]; is_active: boolean };

const MS = 86_400_000;
const toTime = (d: Day) => Date.parse(`${d}T00:00:00Z`);
const fromTime = (t: number): Day => new Date(t).toISOString().slice(0, 10);

export const addDays = (d: Day, n: number): Day => fromTime(toTime(d) + n * MS);
export const daysBetween = (a: Day, b: Day): number => Math.round((toTime(b) - toTime(a)) / MS);
/** Inclusive end of a job that starts on `start` and lasts `days` calendar days. */
export const spanOf = (start: Day, days: number): Span => ({ start, end: addDays(start, Math.max(1, Math.round(days)) - 1) });
/**
 * A project on the timeline: its bar ends on the last work day (start + days − 1); the
 * delivery date is the day after (the same as deliveryDate() on the contract page).
 */
export const projectDates = (start: Day, days: number): { lastWorkDay: Day; delivery: Day } => ({ lastWorkDay: addDays(start, Math.max(1, days) - 1), delivery: addDays(start, Math.max(1, days)) });
export const overlaps = (a: Span, b: Span): boolean => a.start <= b.end && b.start <= a.end;
export const maxDay = (a: Day, b: Day): Day => (a >= b ? a : b);

/** Bookings of the same team that clash with the candidate (warn, don't block). */
export function conflicts<T extends Entry>(entries: T[], candidate: Entry): T[] {
  return entries.filter((e) => e.team_id === candidate.team_id && e.id !== candidate.id && overlaps(e, candidate));
}

/** First day ≥ `from` when a job of `days` fits between the busy spans. */
export function earliestStart(busy: Span[], from: Day, days: number): Day {
  const sorted = [...busy].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  let d = from;
  // each pass moves past at least one busy span, so this ends
  for (let guard = 0; guard <= sorted.length; guard++) {
    const want = spanOf(d, days);
    const hit = sorted.find((s) => overlaps(s, want));
    if (!hit) return d;
    d = maxDay(d, addDays(hit.end, 1));
  }
  return d;
}

/** Teams that can take a job: the priced team when known and active, else active teams doing the service (else all active). */
function teamPool(teams: TeamInfo[], service: ServiceKind, preferTeam?: string | null): TeamInfo[] {
  const active = teams.filter((t) => t.is_active);
  const preferred = preferTeam ? active.find((t) => t.id === preferTeam) : undefined;
  if (preferred) return [preferred];
  const able = active.filter((t) => t.services.includes(service));
  return able.length ? able : active;
}

/**
 * Earliest start for a new job (§3.9): among active teams that do the
 * service (or every active team when none is set up for it), the team that
 * can start soonest. Ties go to the team with fewer bookings.
 */
export function suggestStart(
  teams: TeamInfo[],
  entries: Entry[],
  service: ServiceKind,
  from: Day,
  days: number,
  exclude?: { contract_id?: string },
  /** the team priced on the quote (G1): when it is an active team, only it is considered */
  preferTeam?: string | null,
): { date: Day; team: TeamInfo } | null {
  const pool = teamPool(teams, service, preferTeam);
  let best: { date: Day; team: TeamInfo; load: number } | null = null;
  for (const team of pool) {
    const own = entries.filter((e) => e.team_id === team.id && (!exclude?.contract_id || e.contract_id !== exclude.contract_id));
    const date = earliestStart(own, from, days);
    if (!best || date < best.date || (date === best.date && own.length < best.load)) best = { date, team, load: own.length };
  }
  return best && { date: best.date, team: best.team };
}

/** Is at least one suitable team free for the whole span? (contract start warning) */
export function anyTeamFree(teams: TeamInfo[], entries: Entry[], service: ServiceKind, span: Span, exclude?: { contract_id?: string }, preferTeam?: string | null): boolean {
  const pool = teamPool(teams, service, preferTeam);
  if (!pool.length) return true; // no teams set up yet → nothing to warn about
  return pool.some((t) => !entries.some((e) => e.team_id === t.id && (!exclude?.contract_id || e.contract_id !== exclude.contract_id) && overlaps(e, span)));
}

/** Days of a window starting on `from` (for the timeline). */
export const windowDays = (from: Day, n: number): Day[] => Array.from({ length: n }, (_, i) => addDays(from, i));

/** Saturday that starts the week containing `d` (Saudi week: Sat … Fri). */
export function weekStart(d: Day): Day {
  const dow = new Date(toTime(d)).getUTCDay(); // 0 Sun … 6 Sat
  return addDays(d, -((dow + 1) % 7));
}

/**
 * The team to book for a contract, from how its labour was priced (G1): the in-house team picked
 * with one tap, or the team of the external labour rate's subcontractor. Null when none applies.
 */
export function bookingTeam(
  labour: { source: string; teamId?: string | null; externalId?: string | null; crew?: string[] } | null | undefined,
  rates: { id: string; subcontractor_id?: string | null }[],
  teams: { id: string; subcontractor_id?: string | null }[],
): string | null {
  if (!labour) return null;
  if (labour.source === "inhouse" && labour.teamId) return teams.some((t) => t.id === labour.teamId) ? labour.teamId : null;
  if (labour.source === "external" && labour.externalId) {
    const sub = rates.find((r) => r.id === labour.externalId)?.subcontractor_id;
    return (sub && teams.find((t) => t.subcontractor_id === sub)?.id) || null;
  }
  return null;
}
