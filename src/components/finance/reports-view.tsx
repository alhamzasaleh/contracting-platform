"use client";
import { AlertTriangle, Banknote, Send } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import * as React from "react";
import { DocNo } from "@/components/doc-no";
import { useFormatter } from "@/components/formatter-provider";
import { FormDialog, NumberInput, useActionRunner } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import type { ActionResult } from "@/lib/actions";
import type { OwnerFinance, PaymentRow } from "@/lib/data/finance";
import { toNumber } from "@/lib/validation/numbers";
import { cn, ltr } from "@/lib/utils";
import { WhatsAppButton } from "@/components/whatsapp-button";

export type ReportActions = {
  record: (i: Record<string, unknown>) => Promise<ActionResult>;
  expected: (i: Record<string, unknown>) => Promise<ActionResult>;
  /** ask the client for a material-supply / custom payment */
  request?: (i: Record<string, unknown>) => Promise<ActionResult>;
};

/** §3.7 collections (due, received, outstanding per client) and §3.16 profit detail. */
export function ReportsView({ f, actions, base = "" }: { f: OwnerFinance; actions?: ReportActions; base?: string }) {
  const t = useTranslations("finance");
  const [tab, setTab] = React.useState<"collect" | "profit">("collect");
  return (
    <div className="grid min-w-0 gap-5 [&>*]:min-w-0">
      <Segmented name={t("view")} value={tab} onChange={setTab} options={[{ value: "collect", label: t("tabCollect") }, { value: "profit", label: t("tabProfit") }]} className="justify-self-start" />
      {tab === "collect" ? <Collections f={f} actions={actions} base={base} /> : <ProfitTable f={f} base={base} />}
    </div>
  );
}

function Collections({ f, actions, base }: { f: OwnerFinance; actions?: ReportActions; base: string }) {
  const t = useTranslations("finance");
  const tw = useTranslations("wa");
  const { fmt } = useFormatter();
  const [paying, setPaying] = React.useState<PaymentRow | null>(null);
  const { run, pending } = useActionRunner();
  const [show, setShow] = React.useState<"open" | "all">("open");
  const rows = f.payments.filter((p) => (show === "open" ? p.outstanding > 0 : true));
  const groups = [...new Set(rows.map((r) => r.contract))].map((contract) => ({ contract, rows: rows.filter((r) => r.contract === contract) }));
  if (!f.payments.length) return <EmptyState icon={<Banknote />} title={t("noPaymentsTitle")} description={t("noPaymentsBody")} />;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px]">
          {t("outstanding")}: <span className="font-latin font-bold tabular-nums">{fmt.money(f.kpis.outstanding)}</span>
        </p>
        <Segmented name={t("show")} value={show} onChange={setShow} options={[{ value: "open", label: t("showOpen") }, { value: "all", label: t("showAll") }]} />
      </div>
      {groups.map((g) => (
        <section key={g.contract} className="grid gap-2 rounded-3xl border border-border bg-surface p-5">
          <Link href={`${base}/contracts/${g.contract}`} className="font-bold hover:text-primary">
            {g.rows[0].client} · <DocNo>{g.contract}</DocNo>
          </Link>
          <ul className="grid gap-2">
            {g.rows.map((p) => (
              <li key={p.id} className={cn("grid gap-2 rounded-2xl p-3 sm:grid-cols-[1fr_auto]", p.late ? "bg-danger-soft/60" : "bg-surface-sunken/50")}>
                <div className="grid gap-0.5 text-[13px]">
                  <p className="flex flex-wrap items-center gap-2 font-bold">
                    {p.label}
                    <Badge tone={p.status === "paid" ? "success" : p.status === "requested" ? "warning" : "neutral"}>{t(`pay_${p.status}`)}</Badge>
                    {p.late && (
                      <Badge tone="danger">
                        <AlertTriangle className="size-3" /> {t("late")}
                      </Badge>
                    )}
                  </p>
                  <p className="text-muted-foreground">
                    {fmt.money(p.amount)}
                    {p.paid > 0 && ` · ${t("received")} ${fmt.money(p.paid)}`}
                    {p.outstanding > 0 && ` · ${t("left")} ${fmt.money(p.outstanding)}`}
                    {p.paid_at && ` · ${fmt.date(p.paid_at)}`}
                  </p>
                  {p.outstanding > 0 && (
                    <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                      {t("expectedOn")}
                      {f.canManage && actions && !p.id.startsWith("ad:") ? (
                        <ExpectedDate id={p.id} value={p.expected} save={actions.expected} />
                      ) : (
                        <span className="font-latin">{fmt.date(p.expected)}</span>
                      )}
                    </label>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 self-center">
                  {p.status === "requested" && p.outstanding > 0 && (
                    <WhatsAppButton
                      phone={p.client_phone}
                      label={tw("btnRemind")}
                      text={
                        p.late && p.requested_at
                          ? tw("payLate", { name: p.client, label: p.label, contract: ltr(p.contract), amount: fmt.money(p.outstanding), days: Math.max(1, Math.round((Date.parse(f.today) - Date.parse(p.requested_at.slice(0, 10))) / 86_400_000)), org: f.orgName ?? "" })
                          : tw("payRequest", { name: p.client, label: p.label, contract: ltr(p.contract), amount: fmt.money(p.outstanding), org: f.orgName ?? "" })
                      }
                    />
                  )}
                  {f.canManage && actions?.request && p.status === "pending" && (p.due_event === "material_supply" || p.due_event === "custom") && (
                    <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => actions.request!({ payment_id: p.id }))}>
                      <Send /> {t("requestPayment")}
                    </Button>
                  )}
                  {f.canManage && p.outstanding > 0 && (
                    <Button size="sm" onClick={() => setPaying(p)}>
                      <Banknote /> {t("recordPayment")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {paying && <PayDialog p={paying} today={f.today} onClose={() => setPaying(null)} record={actions?.record} />}
    </div>
  );
}

function ExpectedDate({ id, value, save }: { id: string; value: string; save: ReportActions["expected"] }) {
  const { run } = useActionRunner();
  const [v, setV] = React.useState(value);
  return (
    <Input
      type="date"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && /^\d{4}-\d{2}-\d{2}$/.test(v) && run(() => save({ payment_id: id, date: v }), { silent: true })}
      className="h-9 w-40 text-[12px]"
    />
  );
}

function PayDialog({ p, today, onClose, record }: { p: PaymentRow; today: string; onClose: () => void; record?: ReportActions["record"] }) {
  return (
    <RecordPaymentDialog
      description={`${p.client} · ${p.label}`}
      outstanding={p.outstanding}
      today={today}
      onClose={onClose}
      submit={record && ((v) => record({ payment_id: p.id, ...v }))}
    />
  );
}

/** Money received (full or partial): amount, date, method and reference. Shared by collections and addenda. */
export function RecordPaymentDialog({
  description,
  outstanding,
  today,
  onClose,
  submit,
}: {
  description: string;
  outstanding: number;
  today: string;
  onClose: () => void;
  submit?: (v: { paid_on: string; amount: number; method: "transfer" | "cash" | "cheque" | "card"; reference: string | null }) => Promise<ActionResult>;
}) {
  const t = useTranslations("finance");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const [amount, setAmount] = React.useState(String(outstanding));
  const [date, setDate] = React.useState(today);
  const [method, setMethod] = React.useState<"transfer" | "cash" | "cheque" | "card">("transfer");
  const [ref, setRef] = React.useState("");
  const num = (v: string) => (typeof toNumber(v) === "number" ? (toNumber(v) as number) : 0);
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t("recordPayment")}
      description={`${description} — ${t("left")} ${fmt.money(outstanding)}`}
      pending={pending}
      onSubmit={() => run(submit && (() => submit({ paid_on: date, amount: num(amount), method, reference: ref || null })), { onSuccess: onClose })}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field id="rp-a" label={t("amount")} hint={num(amount) < outstanding ? t("partialHint") : undefined}>
          <NumberInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id="rp-d" label={t("date")}>
          <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Segmented name={t("method")} value={method} onChange={setMethod} options={(["transfer", "cash", "cheque", "card"] as const).map((m) => ({ value: m, label: t(`method_${m}`) }))} />
      <Field id="rp-r" label={t("reference")} optional={t("optional")}>
        <Input value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

function ProfitTable({ f, base }: { f: OwnerFinance; base: string }) {
  const t = useTranslations("finance");
  const tp = useTranslations("pricing");
  const { fmt } = useFormatter();
  const months = [...new Set(f.profits.map((p) => p.month))].sort().reverse();
  if (!f.profits.length) return <EmptyState icon={<Banknote />} title={t("noProjects")} />;
  return (
    <div className="grid gap-4">
      <section className="rounded-3xl border border-border bg-surface p-5">
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="text-[12px] text-muted-foreground">
                <th className="px-2 py-2 text-start font-normal">{t("project")}</th>
                <th className="px-2 py-2 text-end font-normal">{t("revenue")}</th>
                <th className="px-2 py-2 text-end font-normal">{t("estCost")}</th>
                <th className="px-2 py-2 text-end font-normal">{t("actCost")}</th>
                <th className="px-2 py-2 text-end font-normal">{t("expectedProfit")}</th>
                <th className="px-2 py-2 text-end font-normal">{t("actualProfit")}</th>
              </tr>
            </thead>
            <tbody className="font-latin tabular-nums">
              {f.profits.map((p) => (
                <tr key={p.id} className={cn("border-t border-border", p.losing && "bg-danger-soft/40")}>
                  <td className="px-2 py-2 font-sans">
                    <Link href={`${base}/contracts/${p.number}`} className="font-bold hover:text-primary">
                      {p.client}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">
                      {tp(`kind_${p.service}`)} · <DocNo>{p.number}</DocNo> · {p.progress}%
                    </p>
                  </td>
                  <td className="px-2 py-2 text-end">{fmt.money(p.revenue)}</td>
                  <td className="px-2 py-2 text-end">{p.estimatedCost == null ? "—" : fmt.money(p.estimatedCost)}</td>
                  <td className="px-2 py-2 text-end">{fmt.money(p.actualCost)}</td>
                  <td className="px-2 py-2 text-end">
                    {p.expected == null ? "—" : fmt.money(p.expected)}
                    {p.expectedMargin != null && <span className="block text-[11px] text-muted-foreground">{fmt.number(p.expectedMargin, 1)}%</span>}
                  </td>
                  <td className={cn("px-2 py-2 text-end font-bold", p.actual < 0 && "text-danger")}>
                    {fmt.money(p.actual)}
                    {p.actualMargin != null && <span className="block text-[11px] font-normal text-muted-foreground">{fmt.number(p.actualMargin, 1)}%</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-subtle-foreground">{t("profitNote")}</p>
      </section>
      <section className="grid gap-2 rounded-3xl border border-border bg-surface p-5">
        <p className="font-bold">{t("byMonth")}</p>
        {months.map((m) => {
          const rs = f.profits.filter((p) => p.month === m);
          return (
            <p key={m} className="flex flex-wrap justify-between gap-2 border-t border-border/60 pt-1 text-[13px]">
              <span>{fmt.monthYear(`${m}-01T12:00:00Z`)}</span>
              <span className="font-latin tabular-nums">
                {t("revenue")} {fmt.money(rs.reduce((a, r) => a + r.revenue, 0))} · {t("expectedProfit")} {fmt.money(rs.reduce((a, r) => a + (r.expected ?? 0), 0))} · {t("actualProfit")}{" "}
                {fmt.money(rs.reduce((a, r) => a + r.actual, 0))}
              </span>
            </p>
          );
        })}
      </section>
    </div>
  );
}
