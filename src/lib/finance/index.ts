/**
 * Owner finance (Phase 9) — pure helpers: expected payment dates, weekly
 * cash-flow forecast, receivables ageing, profit per project.
 */
import { addDays, daysBetween, weekStart, type Day } from "@/lib/schedule";

const r2 = (x: number) => Math.round(x * 100) / 100;

export type DueEvent = "signing" | "material_supply" | "board_closing" | "primer_done" | "handover" | "custom";

/**
 * When a client payment is expected (§3.16): the date finance set, else from
 * the contract timeline — signing at the start, handover at the end, stage
 * payments part-way. Requested but unpaid money is due now.
 */
export function expectedPaymentDate(
  p: { due_event: DueEvent; expected_date: string | null; status: string; requested_at: string | null },
  c: { start_date: Day; days: number },
  today: Day,
): Day {
  if (p.expected_date) return p.expected_date;
  if (p.status === "requested") return today;
  const at = (share: number) => addDays(c.start_date, Math.round(c.days * share));
  const d = { signing: c.start_date, material_supply: at(0.1), board_closing: at(0.5), primer_done: at(0.55), handover: at(1), custom: at(0.5) }[p.due_event];
  return d < today ? today : d;
}

/**
 * Staff may ask the client for a pending payment (public.request_contract_payment) unless the
 * client's stage confirmation requests it: material supply and custom payments, and a stage
 * payment whose stage isn't on the project. The signing payment is requested on acceptance.
 */
export function canRequestPayment(p: { due_event: DueEvent; status: string }, stageEvents: ReadonlySet<string>): boolean {
  if (p.status !== "pending" || p.due_event === "signing") return false;
  return p.due_event === "material_supply" || p.due_event === "custom" || !stageEvents.has(p.due_event);
}

/** Why public.request_contract_payment refused (22023), as a message key; null for anything else. */
export function paymentRequestError(message: string | null | undefined): "paymentNotAccepted" | "paymentByStage" | "paymentAlreadyRequested" | null {
  if (!message) return null;
  if (/isn't accepted/.test(message)) return "paymentNotAccepted";
  if (/confirms the stage/.test(message)) return "paymentByStage";
  if (/already requested/.test(message)) return "paymentAlreadyRequested";
  return null;
}

/** A refused record_client_payment / record_addendum_payment → a message key for the person. */
export function paymentRecordError(message: string | null | undefined): "paymentOverDue" | "paymentAlreadyPaid" | "paymentNotAccepted" | null {
  if (!message) return null;
  if (/more than the amount due/.test(message)) return "paymentOverDue";
  if (/already paid/.test(message)) return "paymentAlreadyPaid";
  if (/isn't accepted/.test(message)) return "paymentNotAccepted";
  return null;
}

/** Days since a payment was requested when it is late (7 days or more), else null. */
export function lateDays(requestedAt: string | null | undefined, today: string): number | null {
  if (!requestedAt) return null;
  // the request day in Riyadh (a timestamp just after midnight there is still the previous UTC day)
  const day = requestedAt.length > 10 ? new Date(requestedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }) : requestedAt;
  const days = Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000);
  return days >= 7 ? days : null;
}

/** What is left to collect on an amount (never negative, cents). */
export function remainingAmount(amount: number, paid: number | null | undefined): number {
  return Math.max(0, r2(amount - (paid ?? 0)));
}

/** Received on an addendum: rows marked paid before amounts were recorded count as paid in full. */
export function addendumPaid(a: { payment_status: string; paid_amount: number | null | undefined; total: number }): number {
  const paid = Number(a.paid_amount ?? 0);
  return a.payment_status === "paid" ? Math.max(paid, a.total) : paid;
}

export type Flow = { date: Day; amount: number; label: string; kind: string };
export type ForecastWeek = { start: Day; end: Day; inflow: number; outflow: number; net: number; balance: number; shortfall: boolean; items: Flow[] };

/** Weekly cash-flow from today (Saturday weeks); anything overdue lands in the first week. */
export function weeklyForecast(opening: number, inflows: Flow[], outflows: Flow[], today: Day, weeks = 12): ForecastWeek[] {
  const first = weekStart(today);
  let balance = opening;
  const out: ForecastWeek[] = [];
  for (let w = 0; w < weeks; w++) {
    const start = addDays(first, w * 7);
    const end = addDays(start, 6);
    const inWeek = (f: Flow) => (w === 0 ? f.date <= end : f.date >= start && f.date <= end);
    const ins = inflows.filter(inWeek);
    const outs = outflows.filter(inWeek);
    const inflow = r2(ins.reduce((s, f) => s + f.amount, 0));
    const outflow = r2(outs.reduce((s, f) => s + f.amount, 0));
    balance = r2(balance + inflow - outflow);
    out.push({ start, end, inflow, outflow, net: r2(inflow - outflow), balance, shortfall: balance < 0, items: [...ins, ...outs] });
  }
  return out;
}

/** Paydays (day N of each month) inside a window. */
export function paydays(today: Day, payday: number, until: Day): Day[] {
  const days: Day[] = [];
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  for (let i = 0; i < 6; i++) {
    const d = `${y}-${String(m).padStart(2, "0")}-${String(payday).padStart(2, "0")}`;
    if (d >= today && d <= until) days.push(d);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return days;
}

/**
 * Statutory cost items that leave the bank every month (GOSI %, monthly fees). Provisions
 * (end-of-service, annual leave — accruals, not cash) and annual / one-off items are not
 * monthly cash, so the forecast leaves them out.
 */
export function cashStatutoryItems<T extends { basis: string; is_provision?: boolean | null }>(items: T[]): T[] {
  return items.filter((i) => (i.basis === "percent" || i.basis === "monthly") && !i.is_provision);
}

/**
 * Salary outflows on each payday (§3.16/§3.20): a month's payroll run net when the run exists
 * (nothing once it is paid — the money already left), otherwise the gross monthly salaries;
 * plus the statutory items paid every month (GOSI and other monthly items).
 */
export function payrollFlows(days: Day[], runs: { month: string; status: string; net: number }[], gross: number, statutoryMonthly: number): Flow[] {
  const out: Flow[] = [];
  for (const d of days) {
    const run = runs.find((r) => r.month.slice(0, 7) === d.slice(0, 7));
    const salaries = run ? (run.status === "paid" ? 0 : r2(run.net)) : r2(gross);
    if (salaries > 0) out.push({ date: d, amount: salaries, label: "salaries", kind: "payroll" });
    if (statutoryMonthly > 0) out.push({ date: d, amount: r2(statutoryMonthly), label: "statutory", kind: "statutory" });
  }
  return out;
}

export type AgeBucket = "0_30" | "31_60" | "61_90" | "90_plus";

/** Receivables ageing from the day each payment was requested. */
export function ageing(items: { requested_at: string | null; outstanding: number }[], today: Day): Record<AgeBucket, number> {
  const b: Record<AgeBucket, number> = { "0_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0 };
  for (const i of items) {
    if (i.outstanding <= 0) continue;
    const age = i.requested_at ? daysBetween(i.requested_at.slice(0, 10), today) : 0;
    const k: AgeBucket = age <= 30 ? "0_30" : age <= 60 ? "31_60" : age <= 90 ? "61_90" : "90_plus";
    b[k] = r2(b[k] + i.outstanding);
  }
  return b;
}

/** Expected vs actual profit of a project (revenue excl. VAT). */
export function projectProfit(revenue: number, estimatedCost: number | null, actualCost: number) {
  const expected = estimatedCost == null ? null : r2(revenue - estimatedCost);
  const actual = r2(revenue - actualCost);
  return {
    expected,
    expectedMargin: expected == null || revenue <= 0 ? null : r2((expected / revenue) * 100),
    actual,
    actualMargin: revenue > 0 ? r2((actual / revenue) * 100) : null,
    losing: actual < 0 || (expected != null && actual < expected * 0.5),
  };
}

/**
 * Repairs the company pays: covered by the warranty (`covered = true`) with a cost. Repairs
 * charged to the client are not our cost (the same rule as a project's actual cost).
 */
export function companyPaidRepairs<T extends { covered: boolean; cost: number }>(rows: T[]): T[] {
  return rows.filter((r) => r.covered && r.cost > 0);
}

/** A project's page for the viewer: the contract with quotes.view, else the project with projects.view, else none. */
export function projectHref(number: string, links: { contracts: boolean; projects: boolean }): string | null {
  return links.contracts ? `/contracts/${number}` : links.projects ? `/projects/${number}` : null;
}
