/**
 * HR helpers (§3.20) — pure: document expiry reminders and payroll totals.
 */
import { daysBetween, type Day } from "@/lib/schedule";

export type DocKind = "id" | "passport" | "insurance";
export type ExpiringDoc = { employee_id: string; name: string; kind: DocKind; date: Day; days: number; level: "expired" | "7" | "30" | "60" };

/** Documents expiring within `window` days (and already expired), soonest first — reminders at 60 / 30 / 7 days. */
export function expiringDocuments(
  employees: { id: string; full_name: string; status: string; id_expiry: string | null; passport_expiry: string | null; insurance_expiry: string | null }[],
  today: Day,
  window = 60,
): ExpiringDoc[] {
  const out: ExpiringDoc[] = [];
  for (const e of employees) {
    if (e.status === "final_exit") continue;
    for (const [kind, date] of [["id", e.id_expiry], ["passport", e.passport_expiry], ["insurance", e.insurance_expiry]] as const) {
      if (!date) continue;
      const days = daysBetween(today, date);
      if (days > window) continue;
      out.push({ employee_id: e.id, name: e.full_name, kind, date, days, level: days < 0 ? "expired" : days <= 7 ? "7" : days <= 30 ? "30" : "60" });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

export type PayLine = { basic: number; housing: number; transport: number; other: number; overtime: number; deductions: number; advances: number };

/** Same formula as the database (shown live while editing). */
export const netPay = (l: PayLine) => Math.round((l.basic + l.housing + l.transport + l.other + l.overtime - l.deductions - l.advances) * 100) / 100;

/** Bank transfer file (CSV, UTF-8 with BOM so Excel shows Arabic). */
export function payrollCsv(rows: { full_name: string; iban: string | null; net: number }[], month: string): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [["الاسم", "الآيبان", "صافي الراتب", "الشهر"].map(esc).join(",")];
  for (const r of rows) lines.push([esc(r.full_name), esc(r.iban ?? ""), r.net.toFixed(2), esc(month)].join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
