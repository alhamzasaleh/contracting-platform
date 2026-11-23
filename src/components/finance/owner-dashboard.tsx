"use client";
import { AlertTriangle, ArrowUpLeft, Check, CheckCircle2, Clock, Pencil, TrendingDown, X } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import * as React from "react";
import { chartColours, EChart, type EChartOption } from "@/components/charts/echart";
import { DocNo } from "@/components/doc-no";
import { useFormatter } from "@/components/formatter-provider";
import { FormDialog, NumberInput, useActionRunner } from "@/components/forms/form-kit";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import type { OwnerFinance } from "@/lib/data/finance";
import type { AgeBucket } from "@/lib/finance";
import { toNumber } from "@/lib/validation/numbers";
import { cn } from "@/lib/utils";

const ease = [0.16, 1, 0.3, 1] as const;
const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } } };

export type FinanceActions = {
  decide: (i: Record<string, unknown>) => Promise<ActionResult>;
  saveCash: (i: Record<string, unknown>) => Promise<ActionResult>;
};

/** §3.16 owner home: KPIs, cash-flow forecast, approvals, profit, receivables, delays. Every number links to its details. */
export function OwnerFinanceSections({ f, actions, base = "" }: { f: OwnerFinance; actions?: FinanceActions; base?: string }) {
  const t = useTranslations("finance");
  const { fmt } = useFormatter();
  const kpis = [
    { key: "outstanding", value: f.kpis.outstanding, href: `${base}/reports`, tone: f.kpis.outstanding > 0 ? "warn" : "" },
    { key: "dueSoon", value: f.kpis.dueSoon, href: `${base}/reports`, tone: "" },
    { key: "collectedMonth", value: f.kpis.collectedMonth, href: `${base}/reports`, tone: "" },
  ] as const;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {kpis.map((k) => (
          <motion.div key={k.key} variants={item}>
            <Link href={k.href} className="block rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-primary/40 sm:p-5">
              <p className="text-[13px] text-muted-foreground">{t(k.key)}</p>
              <p className={cn("num mt-2 text-[clamp(1rem,5vw,1.5rem)] font-extrabold tabular-nums break-words sm:text-[28px]", k.tone === "warn" && "text-primary")}>{fmt.money(k.value)}</p>
            </Link>
          </motion.div>
        ))}
        <motion.div variants={item}>
          <Link href={`${base}/projects`} className="block rounded-2xl bg-ink p-4 text-ink-foreground sm:p-5">
            <p className="text-[13px] opacity-80">{t("activeProjects")}</p>
            <p className="num mt-2 text-[28px] font-extrabold text-gypsum">{fmt.number(f.kpis.activeProjects)}</p>
            {(f.delayed.length > 0 || f.overBudget.length > 0) && (
              <p className="mt-1 text-[12px] text-ink-muted">{t("attention", { delayed: f.delayed.length, over: f.overBudget.length })}</p>
            )}
          </Link>
        </motion.div>
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <CashFlow f={f} actions={actions} />
        <Approvals f={f} decide={actions?.decide} base={base} />
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <Profit f={f} base={base} />
        <div className="grid content-start gap-4 sm:gap-5">
          <Receivables f={f} base={base} />
          <Attention f={f} base={base} />
          <TeamCost f={f} base={base} />
        </div>
      </div>
    </>
  );
}

function CashFlow({ f, actions }: { f: OwnerFinance; actions?: FinanceActions }) {
  const t = useTranslations("finance");
  const { fmt } = useFormatter();
  const [week, setWeek] = React.useState<number | null>(null);
  const [editing, setEditing] = React.useState(false);
  const firstShort = f.forecast.findIndex((w) => w.shortfall);
  const option = React.useMemo<EChartOption>(() => {
    const c = chartColours();
    return {
      grid: { left: 8, right: 8, top: 30, bottom: 24, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => fmt.money(v) },
      legend: { top: 0, textStyle: { color: c.muted }, data: [t("inflow"), t("outflow"), t("balance")] },
      xAxis: { type: "category", inverse: true, data: f.forecast.map((w) => fmt.dayMonth(w.start)), axisLabel: { color: c.muted }, axisLine: { lineStyle: { color: c.border } } },
      yAxis: { type: "value", position: "right", axisLabel: { color: c.muted, formatter: (v: number) => fmt.compactMoney(v) }, splitLine: { lineStyle: { color: c.border } } },
      series: [
        { name: t("inflow"), type: "bar", data: f.forecast.map((w) => w.inflow), itemStyle: { color: c.clay, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 16 },
        { name: t("outflow"), type: "bar", data: f.forecast.map((w) => w.outflow), itemStyle: { color: c.sand, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 16 },
        {
          name: t("balance"), type: "line", smooth: true, symbolSize: 6, data: f.forecast.map((w) => ({ value: w.balance, itemStyle: { color: w.shortfall ? c.danger : c.text } })),
          itemStyle: { color: c.text }, lineStyle: { color: c.text, width: 2 }, markLine: { silent: true, symbol: "none", lineStyle: { color: c.danger, type: "dashed" }, data: [{ yAxis: 0 }], label: { show: false } },
        },
      ],
    };
  }, [f.forecast, fmt, t]);
  const w = week == null ? null : f.forecast[week];
  return (
    <motion.section variants={item} className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold">{t("cashflow")}</h2>
          <p className="text-[13px] text-muted-foreground">
            {t("opening", { amount: fmt.money(f.cash.balance), date: fmt.date(f.cash.on) })}
          </p>
        </div>
        {f.canManage && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            <Pencil /> {t("editCash")}
          </Button>
        )}
      </div>
      {firstShort >= 0 ? (
        <p className="mt-3 flex gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t("shortfall", { week: fmt.dayMonth(f.forecast[firstShort].start), amount: fmt.money(-f.forecast[firstShort].balance) })}
        </p>
      ) : (
        <p className="mt-3 text-[13px] text-success">{t("noShortfall")}</p>
      )}
      <EChart option={option} height={260} onPick={setWeek} label={t("cashflow")} />
      {w ? (
        <div className="mt-2 grid gap-1 rounded-xl bg-surface-sunken/60 p-3 text-[13px]">
          <p className="font-bold">{t("weekOf", { date: fmt.dayMonth(w.start) })}</p>
          {w.items.length === 0 && <p className="text-muted-foreground">{t("nothingThisWeek")}</p>}
          {w.items.map((x, i) => (
            <p key={i} className="flex justify-between gap-2">
              <span>{x.kind === "client" ? x.label : t(`out_${x.kind}` as "out_payroll", { label: x.label })}</span>
              <span className={cn("font-latin tabular-nums", x.kind === "client" ? "text-success" : "")}>{(x.kind === "client" ? "+ " : "− ") + fmt.money(x.amount)}</span>
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-[12px] text-subtle-foreground">{t("tapWeek")}</p>
      )}
      {editing && <CashDialog f={f} onClose={() => setEditing(false)} save={actions?.saveCash} />}
    </motion.section>
  );
}

function CashDialog({ f, onClose, save }: { f: OwnerFinance; onClose: () => void; save?: FinanceActions["saveCash"] }) {
  const t = useTranslations("finance");
  const { run, pending } = useActionRunner();
  const [balance, setBalance] = React.useState(String(f.cash.balance));
  const [on, setOn] = React.useState(f.today);
  const [payday, setPayday] = React.useState(String(f.cash.payday));
  const num = (v: string) => (typeof toNumber(v) === "number" ? (toNumber(v) as number) : 0);
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t("editCash")}
      description={t("editCashHint")}
      pending={pending}
      onSubmit={() => run(save && (() => save({ cash_balance: num(balance), cash_balance_on: on, payday: Math.min(28, Math.max(1, Math.round(num(payday)))) })), { onSuccess: onClose })}
    >
      <Field id="cash-b" label={t("bankBalance")}>
        <NumberInput value={balance} onChange={(e) => setBalance(e.target.value)} />
      </Field>
      <Field id="cash-d" label={t("balanceDate")}>
        <Input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
      </Field>
      <Field id="cash-p" label={t("payday")} hint={t("paydayHint")}>
        <NumberInput value={payday} onChange={(e) => setPayday(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

function Approvals({ f, decide, base }: { f: OwnerFinance; decide?: FinanceActions["decide"]; base: string }) {
  const t = useTranslations("finance");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  return (
    <motion.section variants={item} className="flex flex-col gap-3 rounded-2xl bg-ink p-5 text-ink-foreground sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[19px] font-extrabold text-gypsum">{t("approvals")}</h2>
        <span className="num flex size-7 items-center justify-center rounded-full bg-clay text-[13px] font-bold text-gypsum">{fmt.number(f.approvals.length)}</span>
      </div>
      {f.approvals.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl bg-ink-2 px-4 py-10 text-center">
          <CheckCircle2 className="size-8 text-clay" strokeWidth={1.5} />
          <p className="text-sm">{t("noApprovals")}</p>
        </div>
      ) : (
        <ul className="grid gap-2">
          {f.approvals.map((a) => {
            const d = a.details as { number?: string; total?: number; title?: string; margin?: number; discountPercent?: number };
            return (
              <li key={a.id} className="grid gap-2 rounded-2xl bg-ink-2 p-3">
                <p className="text-[14px] font-bold text-gypsum">{t(`ap_${a.kind}` as "ap_purchase_limit")}</p>
                <p className="text-[12px] text-ink-muted">
                  {d.number && <DocNo>{d.number}</DocNo>}
                  {d.title && ` · ${d.title}`}
                  {typeof d.total === "number" && ` · ${fmt.money(d.total)}`}
                  {a.kind === "quote_margin" && typeof d.margin === "number" && ` · ${t("marginIs", { n: fmt.number(d.margin, 1) })}`}
                  {a.kind === "quote_discount" && typeof d.discountPercent === "number" && ` · ${t("discountIs", { n: fmt.number(d.discountPercent, 1) })}`}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {f.canDecide && decide && (
                    <>
                      <Button size="sm" loading={pending} onClick={() => run(() => decide({ approval_id: a.id, decision: "approved" }))}>
                        <Check /> {t("approve")}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-ink-foreground hover:bg-ink-3 hover:text-gypsum" disabled={pending} onClick={() => run(() => decide({ approval_id: a.id, decision: "rejected" }))}>
                        <X /> {t("reject")}
                      </Button>
                    </>
                  )}
                  {a.link && (
                    <Link href={`${base}${a.link}`} className="ms-auto text-[12px] text-ink-muted underline hover:text-gypsum">
                      {t("details")}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </motion.section>
  );
}

function Profit({ f, base }: { f: OwnerFinance; base: string }) {
  const t = useTranslations("finance");
  const tp = useTranslations("pricing");
  const { fmt } = useFormatter();
  const rows = f.profits.slice(0, 10);
  const option = React.useMemo<EChartOption>(() => {
    const c = chartColours();
    return {
      grid: { left: 8, right: 8, top: 30, bottom: 24, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => fmt.money(v) },
      legend: { top: 0, textStyle: { color: c.muted }, data: [t("expectedProfit"), t("actualProfit")] },
      xAxis: { type: "category", inverse: true, data: rows.map((r) => r.client), axisLabel: { color: c.muted, interval: 0, overflow: "truncate", width: 70 }, axisLine: { lineStyle: { color: c.border } } },
      yAxis: { type: "value", position: "right", axisLabel: { color: c.muted, formatter: (v: number) => fmt.compactMoney(v) }, splitLine: { lineStyle: { color: c.border } } },
      series: [
        { name: t("expectedProfit"), type: "bar", data: rows.map((r) => r.expected ?? 0), itemStyle: { color: c.sand, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 18 },
        { name: t("actualProfit"), type: "bar", data: rows.map((r) => ({ value: r.actual, itemStyle: { color: r.losing ? c.danger : c.clay } })), itemStyle: { color: c.clay, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 18 },
      ],
    };
  }, [rows, fmt, t]);
  const byService = ["gypsum", "interior", "exterior"]
    .map((s) => {
      const rs = f.profits.filter((r) => r.service === s);
      return { s, revenue: rs.reduce((a, r) => a + r.revenue, 0), expected: rs.reduce((a, r) => a + (r.expected ?? 0), 0), actual: rs.reduce((a, r) => a + r.actual, 0) };
    })
    .filter((x) => x.revenue > 0);
  const [picked, setPicked] = React.useState<number | null>(null);
  const p = picked == null ? null : rows[picked];
  return (
    <motion.section variants={item} className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <h2 className="text-[19px] font-extrabold">{t("profit")}</h2>
      <p className="text-[13px] text-muted-foreground">{t("profitHint")}</p>
      {rows.length === 0 ? (
        <p className="mt-6 text-[13px] text-muted-foreground">{t("noProjects")}</p>
      ) : (
        <>
          <EChart option={option} height={240} onPick={setPicked} label={t("profit")} />
          {p && (
            <Link href={`${base}/contracts/${p.number}`} className="mt-1 flex flex-wrap justify-between gap-2 rounded-xl bg-surface-sunken/60 p-3 text-[13px] hover:bg-surface-sunken">
              <span className="font-bold">
                {p.client} · <DocNo>{p.number}</DocNo>
              </span>
              <span>
                {t("revenue")}: {fmt.money(p.revenue)} · {t("actualProfit")}: {fmt.money(p.actual)}
                {p.actualMargin != null && ` (${fmt.number(p.actualMargin, 1)}%)`}
              </span>
            </Link>
          )}
          {f.profits.some((r) => r.losing) && (
            <p className="mt-2 flex gap-2 text-[13px] text-danger">
              <TrendingDown className="size-4 shrink-0" /> {t("losing", { list: f.profits.filter((r) => r.losing).map((r) => r.client).join("، ") })}
            </p>
          )}
          {byService.length > 0 && (
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {byService.map((x) => (
                <div key={x.s} className="rounded-xl bg-surface-sunken/60 p-3 text-[13px]">
                  <p className="font-bold">{tp(`kind_${x.s}`)}</p>
                  <p className="text-muted-foreground">
                    {t("expectedProfit")}: <span className="font-latin tabular-nums">{fmt.money(x.expected)}</span>
                  </p>
                  <p>
                    {t("actualProfit")}: <span className="font-latin font-bold tabular-nums">{fmt.money(x.actual)}</span>
                  </p>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-subtle-foreground">{t("profitNote")}</p>
        </>
      )}
    </motion.section>
  );
}

const BUCKETS: AgeBucket[] = ["0_30", "31_60", "61_90", "90_plus"];

function Receivables({ f, base }: { f: OwnerFinance; base: string }) {
  const t = useTranslations("finance");
  const { fmt } = useFormatter();
  const max = Math.max(1, ...BUCKETS.map((b) => f.ageing[b]));
  return (
    <motion.section variants={item} className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-extrabold">{t("receivables")}</h2>
        <Link href={`${base}/reports`} className="text-[12px] text-primary underline">
          {t("collect")}
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-4 items-end gap-2" style={{ height: 80 }}>
        {BUCKETS.map((b) => (
          <div key={b} className="flex h-full flex-col justify-end gap-1 text-center">
            <div className={cn("rounded-t-md", b === "0_30" ? "bg-sand" : b === "31_60" ? "bg-clay/60" : "bg-clay")} style={{ height: `${Math.max(4, (f.ageing[b] / max) * 60)}px` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-4 gap-2 text-center text-[11px]">
        {BUCKETS.map((b) => (
          <div key={b}>
            <p className="text-muted-foreground">{t(`age_${b}`)}</p>
            <p className="font-latin font-bold tabular-nums">{fmt.compactMoney(f.ageing[b])}</p>
          </div>
        ))}
      </div>
      <ul className="mt-3 grid gap-1 text-[13px]">
        {f.receivables.slice(0, 5).map((r) => (
          <li key={r.client} className="flex justify-between gap-2 border-t border-border/60 pt-1">
            <span className="truncate">{r.client}</span>
            <span className="font-latin font-bold tabular-nums">{fmt.money(r.outstanding)}</span>
          </li>
        ))}
        {f.receivables.length === 0 && <li className="text-muted-foreground">{t("noReceivables")}</li>}
      </ul>
    </motion.section>
  );
}

/** Our team's fixed monthly cost not charged to any project this month (covered by the overhead %). Totals only. */
function TeamCost({ f, base }: { f: OwnerFinance; base: string }) {
  const t = useTranslations("finance");
  const { fmt } = useFormatter();
  if (!f.teamCost) return null;
  return (
    <motion.section variants={item} className="grid gap-1 rounded-2xl border border-border bg-surface p-5 text-[13px]">
      <Link href={`${base}/schedule`} className="text-[14px] font-bold hover:text-primary">
        {t("teamIdleTitle")}
      </Link>
      <p className="num text-[22px] font-extrabold tabular-nums">{fmt.money(f.teamCost.unabsorbed)}</p>
      <p className="text-muted-foreground">{t("teamIdleOf", { allocated: fmt.money(f.teamCost.allocated), monthly: fmt.money(f.teamCost.toDate) })}</p>
      <p className="text-[12px] text-subtle-foreground">{t("teamIdleHint")}</p>
    </motion.section>
  );
}

function Attention({ f, base }: { f: OwnerFinance; base: string }) {
  const t = useTranslations("finance");
  const { fmt } = useFormatter();
  if (!f.delayed.length && !f.overBudget.length) return null;
  return (
    <motion.section variants={item} className="grid gap-2 rounded-2xl border border-warning/40 bg-warning-soft/50 p-5 text-[13px]">
      {f.delayed.map((d) => (
        <Link key={d.number} href={`${base}/projects/${d.number}`} className="flex items-center gap-2 hover:underline">
          <Clock className="size-4 shrink-0" /> {t("delayed", { client: d.client, days: d.days, progress: d.progress })} <ArrowUpLeft className="ms-auto size-3.5 ltr:-scale-x-100" />
        </Link>
      ))}
      {f.overBudget.map((o) => (
        <Link key={o.number} href={`${base}/purchases/costs`} className="flex items-center gap-2 hover:underline">
          <AlertTriangle className="size-4 shrink-0" /> {t("overBudget", { client: o.client, n: fmt.number((o.ratio - 1) * 100, 0) })} <ArrowUpLeft className="ms-auto size-3.5 ltr:-scale-x-100" />
        </Link>
      ))}
    </motion.section>
  );
}
