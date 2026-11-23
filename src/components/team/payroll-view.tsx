"use client";
import { AlertTriangle, Check, Download, FileText, HandCoins, Plus, Printer, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { FormDialog, NumberInput, useActionRunner } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionResult } from "@/lib/actions";
import type { PayrollData, PayrollLineView } from "@/lib/data/payroll";
import { netPay } from "@/lib/hr";
import { toNumber } from "@/lib/validation/numbers";
import { cn } from "@/lib/utils";

type Act = (i: Record<string, unknown>) => Promise<ActionResult>;
export type PayrollActions = { create: Act; update: Act; approve: Act; paid: Act; addAdvance: Act; deleteAdvance: Act };
const num = (v: string) => (typeof toNumber(v) === "number" ? (toNumber(v) as number) : 0);

export function PayrollView({ data, today, actions, base = "" }: { data: PayrollData; today: string; actions?: PayrollActions; base?: string }) {
  const t = useTranslations("payroll");
  const { fmt } = useFormatter();
  const router = useRouter();
  const { run, pending } = useActionRunner();
  const [advance, setAdvance] = React.useState(false);
  const [paying, setPaying] = React.useState(false);
  const draft = data.run?.status === "draft";
  const total = data.lines.reduce((s, l) => s + l.net, 0);
  const monthLabel = fmt.monthYear(`${data.month}-01T12:00:00Z`);

  return (
    <div className="grid min-w-0 gap-5 [&>*]:min-w-0">
      {data.expiring.length > 0 && (
        <section className="grid gap-2 rounded-3xl border border-warning/40 bg-warning-soft/50 p-5">
          <p className="flex items-center gap-2 font-bold">
            <AlertTriangle className="size-4" /> {t("expiringTitle")}
          </p>
          <ul className="grid gap-1 text-[13px]">
            {data.expiring.map((d) => (
              <li key={`${d.employee_id}-${d.kind}`} className="flex flex-wrap justify-between gap-2">
                <span>
                  {d.name} — {t(`doc_${d.kind}`)}
                </span>
                <span className={cn("font-bold", d.level === "expired" || d.level === "7" ? "text-danger" : "")}>
                  {d.days < 0 ? t("expiredAgo", { n: -d.days }) : t("expiresIn", { n: d.days })} · {fmt.date(d.date)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-4 rounded-3xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field id="pr-month" label={t("month")}>
            <Input type="month" value={data.month} onChange={(e) => /^\d{4}-\d{2}$/.test(e.target.value) && router.push(`${base}/team/payroll?month=${e.target.value}`)} className="w-48" />
          </Field>
          {data.run && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={data.run.status === "paid" ? "success" : data.run.status === "approved" ? "primary" : "neutral"}>{t(`st_${data.run.status}`)}</Badge>
              <Button asChild variant="secondary" size="sm">
                <Link href={`/print/payroll/${data.month}`} target="_blank">
                  <Printer /> {t("payslips")}
                </Link>
              </Button>
              <Button asChild variant="secondary" size="sm">
                <a href={`/api/payroll/${data.month}/csv`}>
                  <Download /> {t("bankFile")}
                </a>
              </Button>
            </div>
          )}
        </div>

        {!data.run ? (
          <div className="grid justify-items-start gap-3 rounded-2xl bg-surface-sunken/60 p-5">
            <p className="text-[14px]">{t("noRun", { month: monthLabel })}</p>
            {data.canManage && actions && (
              <Button loading={pending} onClick={() => run(() => actions.create({ month: data.month }))}>
                <Plus /> {t("createRun")}
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[720px] border-collapse text-[13px]">
                <thead>
                  <tr className="text-[12px] text-muted-foreground">
                    <th className="px-2 py-2 text-start font-normal">{t("employee")}</th>
                    <th className="px-2 py-2 text-end font-normal">{t("salary")}</th>
                    <th className="px-2 py-2 text-end font-normal">{t("overtime")}</th>
                    <th className="px-2 py-2 text-end font-normal">{t("deductions")}</th>
                    <th className="px-2 py-2 text-end font-normal">{t("advances")}</th>
                    <th className="px-2 py-2 text-end font-normal">{t("net")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l) => (
                    <Row key={l.id} l={l} editable={draft && data.canManage} save={actions?.update} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <p className="text-[15px]">
                {t("total")}: <span className="font-latin font-extrabold tabular-nums">{fmt.money(total)}</span> · {t("count", { n: data.lines.length })}
              </p>
              <div className="flex flex-wrap gap-2">
                {draft && data.canApprove && actions && (
                  <Button loading={pending} onClick={() => run(() => actions.approve({ run_id: data.run!.id }))}>
                    <Check /> {t("approve")}
                  </Button>
                )}
                {draft && !data.canApprove && <p className="text-[12px] text-muted-foreground">{t("ownerApproves")}</p>}
                {data.run.status === "approved" && data.canPay && actions && (
                  <Button onClick={() => setPaying(true)}>
                    <HandCoins /> {t("markPaid")}
                  </Button>
                )}
                {data.run.status === "paid" && data.run.paid_on && <p className="text-[13px] text-success">{t("paidOn", { date: fmt.date(data.run.paid_on) })}</p>}
              </div>
            </div>
          </>
        )}
      </section>

      <section className="grid gap-3 rounded-3xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-bold">{t("advancesTitle")}</p>
          {data.canManage && (
            <Button size="sm" variant="secondary" onClick={() => setAdvance(true)}>
              <Plus /> {t("newAdvance")}
            </Button>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground">{t("advancesHint")}</p>
        {data.advances.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t("noAdvances")}</p>
        ) : (
          <ul className="grid gap-1 text-[13px]">
            {data.advances.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 border-t border-border/60 pt-1">
                <span>
                  {a.name} · {fmt.date(a.given_on)}
                  {a.note && ` · ${a.note}`}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-latin tabular-nums">{fmt.money(a.amount)}</span>
                  <Badge tone={a.deducted ? "success" : "warning"}>{a.deducted ? t("deducted") : t("open")}</Badge>
                  {!a.deducted && data.canManage && actions && <DeleteAdvance id={a.id} del={actions.deleteAdvance} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.runs.length > 0 && (
        <section className="grid gap-1 rounded-3xl border border-border bg-surface p-5 text-[13px]">
          <p className="mb-1 text-[15px] font-bold">{t("history")}</p>
          {data.runs.map((r) => (
            <Link key={r.month} href={`${base}/team/payroll?month=${r.month}`} className={cn("flex justify-between gap-2 rounded-xl px-2 py-1.5 hover:bg-surface-sunken", r.month === data.month && "bg-surface-sunken")}>
              <span className="flex items-center gap-2">
                <FileText className="size-3.5" /> {fmt.monthYear(`${r.month}-01T12:00:00Z`)} · {t(`st_${r.status}` as "st_draft")}
              </span>
              <span className="font-latin tabular-nums">{fmt.money(r.total)}</span>
            </Link>
          ))}
        </section>
      )}

      {advance && <AdvanceDialog employees={data.employees} today={today} onClose={() => setAdvance(false)} save={actions?.addAdvance} />}
      {paying && data.run && <PaidDialog runId={data.run.id} today={today} onClose={() => setPaying(false)} save={actions?.paid} />}
    </div>
  );
}

function Row({ l, editable, save }: { l: PayrollLineView; editable: boolean; save?: Act }) {
  const { fmt } = useFormatter();
  const { run } = useActionRunner();
  const [overtime, setOvertime] = React.useState(String(l.overtime));
  const [deductions, setDeductions] = React.useState(String(l.deductions));
  const [advances, setAdvances] = React.useState(String(l.advances));
  const salary = l.basic + l.housing + l.transport + l.other;
  const net = netPay({ ...l, overtime: num(overtime), deductions: num(deductions), advances: num(advances) });
  const commit = () => {
    if (num(overtime) === l.overtime && num(deductions) === l.deductions && num(advances) === l.advances) return;
    run(save && (() => save({ id: l.id, overtime: num(overtime), deductions: num(deductions), advances: num(advances), note: l.note })), { silent: true });
  };
  const cell = (v: string, set: (s: string) => void) =>
    editable ? <NumberInput value={v} onChange={(e) => set(e.target.value)} onBlur={commit} className="h-9 w-24 text-[13px]" /> : <span className="font-latin tabular-nums">{fmt.money(num(v))}</span>;
  return (
    <tr className="border-t border-border">
      <td className="px-2 py-2">
        <p className="font-bold">{l.full_name}</p>
        {!l.iban && <NoIban />}
      </td>
      <td className="px-2 py-2 text-end font-latin tabular-nums">{fmt.money(salary)}</td>
      <td className="px-2 py-2 text-end">{cell(overtime, setOvertime)}</td>
      <td className="px-2 py-2 text-end">{cell(deductions, setDeductions)}</td>
      <td className="px-2 py-2 text-end">{cell(advances, setAdvances)}</td>
      <td className={cn("px-2 py-2 text-end font-latin font-bold tabular-nums", net < 0 && "text-danger")}>{fmt.money(net)}</td>
    </tr>
  );
}

function DeleteAdvance({ id, del }: { id: string; del: Act }) {
  const t = useTranslations("payroll");
  const { run, pending } = useActionRunner();
  return (
    <Button size="icon-sm" variant="ghost" aria-label={t("delete")} loading={pending} onClick={() => run(() => del({ id }))}>
      <Trash2 />
    </Button>
  );
}

function AdvanceDialog({ employees, today, onClose, save }: { employees: PayrollData["employees"]; today: string; onClose: () => void; save?: Act }) {
  const t = useTranslations("payroll");
  const { run, pending } = useActionRunner();
  const [emp, setEmp] = React.useState(employees[0]?.id ?? "");
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState(today);
  const [note, setNote] = React.useState("");
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t("newAdvance")}
      pending={pending}
      onSubmit={() => run(save && (() => save({ employee_id: emp, amount: num(amount), given_on: date, note: note || null })), { onSuccess: onClose })}
    >
      <Field id="adv-e" label={t("employee")}>
        <NativeSelect value={emp} onChange={(e) => setEmp(e.target.value)}>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field id="adv-a" label={t("amount")}>
          <NumberInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id="adv-d" label={t("date")}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field id="adv-n" label={t("note")} optional={t("optional")}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

function PaidDialog({ runId, today, onClose, save }: { runId: string; today: string; onClose: () => void; save?: Act }) {
  const t = useTranslations("payroll");
  const { run, pending } = useActionRunner();
  const [date, setDate] = React.useState(today);
  return (
    <FormDialog open onOpenChange={(v) => !v && onClose()} title={t("markPaid")} pending={pending} onSubmit={() => run(save && (() => save({ run_id: runId, paid_on: date })), { onSuccess: onClose })}>
      <Field id="pd-d" label={t("paidDate")}>
        <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

function NoIban() {
  const t = useTranslations("payroll");
  return <p className="text-[11px] text-danger">{t("noIban")}</p>;
}
