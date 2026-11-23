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
