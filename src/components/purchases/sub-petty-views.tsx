"use client";
import { phoneForInput } from "@/lib/validation/client-phone";
import { AlertTriangle, Banknote, Camera, HardHat, Plus, Receipt, Sparkles, Trash2, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { FormDialog, NumberInput, useActionRunner, useListSep } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import type { ActionResult } from "@/lib/actions";
import { shrinkImage } from "@/lib/client/image";
import type { PettyCashData, SubAgreementView, SubcontractorsData } from "@/lib/data/subcontractors";
import type { ServiceKind } from "@/lib/pricing";
import type { InvoiceDraft, InvoiceFlag } from "@/lib/purchases";
import { pettyBalance, subSummary, workAmount, workRemaining } from "@/lib/subcontractors";
import { toNumber } from "@/lib/validation/numbers";
import { cn, ltr } from "@/lib/utils";
import { settle } from "@/lib/client/action";

type Act<T = undefined> = (i: Record<string, unknown>) => Promise<ActionResult<T>>;
const num = (v: string) => (typeof toNumber(v) === "number" ? (toNumber(v) as number) : 0);
const today = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

// --- Subcontractors -----------------------------------------------------------------

export type SubActions = { saveSub: Act<{ id: string }>; saveAgreement: Act; addWork: Act; deleteWork: (i: { id: string }) => Promise<ActionResult>; addPayment: Act };

export function SubcontractorsView({ data, actions }: { data: SubcontractorsData; actions?: SubActions }) {
  const sep = useListSep();
  const t = useTranslations("subs");
  const tp = useTranslations("pricing");
  const { fmt } = useFormatter();
  const [subDialog, setSubDialog] = React.useState<Partial<SubcontractorsData["subs"][number]> | null>(null);
  const [agreementFor, setAgreementFor] = React.useState<string | null>(null);
  const [editAgreement, setEditAgreement] = React.useState<SubAgreementView | null>(null);
  const [workFor, setWorkFor] = React.useState<SubAgreementView | null>(null);
  const [payFor, setPayFor] = React.useState<SubAgreementView | null>(null);
  const project = new Map(data.projects.map((p) => [p.id, p]));
  const [today0] = React.useState(today);

  return (
    <div className="grid gap-4 [&>*]:min-w-0">
      {data.canManage && (
        <Button className="justify-self-start" onClick={() => setSubDialog({ services: [], is_active: true })}>
          <Plus /> {t("newSub")}
        </Button>
      )}
      {data.subs.length === 0 ? (
        <EmptyState icon={<HardHat />} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        data.subs.map((s) => {
          const own = data.agreements.filter((g) => g.subcontractor_id === s.id);
          const due = own.reduce((x, g) => x + subSummary(g, g.work.reduce((a, w) => a + w.amount, 0), g.payments.reduce((a, p) => a + p.amount, 0)).due, 0);
          return (
            <section key={s.id} className={cn("grid gap-3 rounded-3xl border border-border bg-surface p-5", !s.is_active && "opacity-60")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[16px] font-bold">{s.name}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {[s.services.map((x) => tp(`kind_${x}`)).join(sep), s.phone && phoneForInput(s.phone)].filter(Boolean).join(" · ")}
                  </p>
                  {(data.rates ?? []).some((r) => r.subcontractor_id === s.id) && (
                    <p className="text-[12px] text-muted-foreground">
                      {t("pricingRates")}:{" "}
                      {(data.rates ?? [])
                        .filter((r) => r.subcontractor_id === s.id)
                        .map((r) => (r.basis === "external_per_unit" ? t("ratePerM2", { rate: fmt.money(r.rate) }) : t("rateLump", { rate: fmt.money(r.rate) })))
                        .join(" · ")}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {due > 0 && <Badge tone="warning">{t("dueNow", { amount: fmt.money(due) })}</Badge>}
                  {data.canManage && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setSubDialog(s)}>
                        {t("edit")}
                      </Button>
                      <Button size="sm" variant="soft" disabled={!data.projects.length} onClick={() => setAgreementFor(s.id)}>
                        <Plus /> {t("newAgreement")}
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {own.length === 0 && <p className="text-[13px] text-muted-foreground">{t("noAgreements")}</p>}
              {own.map((g) => {
                const earned = g.work.reduce((a, w) => a + w.amount, 0);
                const paid = g.payments.reduce((a, p) => a + p.amount, 0);
                const sum = subSummary(g, earned, paid);
                const p = project.get(g.contract_id);
                return (
                  <div key={g.id} className="grid gap-3 rounded-2xl bg-surface-sunken/50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-bold">
                        {p ? `${p.client} · ${ltr(p.number)}` : "—"} — {g.scope}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge>{g.basis === "per_m2" ? t("perM2", { rate: fmt.money(g.rate) }) : t("lump")}</Badge>
                        <Badge tone="info">{t(`sched_${g.schedule}`)}</Badge>
                        {g.schedule === "progress" && g.auto_progress && g.status === "active" && <Badge tone="primary">{t("autoFollows")}</Badge>}
                        {g.status === "closed" && <Badge tone="neutral">{t("closed")}</Badge>}
                        {g.review && g.status === "active" && <Badge tone="warning">{t("reviewAddendum", { number: ltr(g.review) })}</Badge>}
                        {data.canManage && (
                          <Button size="sm" variant="ghost" onClick={() => setEditAgreement(g)}>
                            {t("edit")}
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
                      <Stat label={t("agreed")} value={fmt.money(sum.total)} />
                      <Stat label={t("earned")} value={fmt.money(sum.earned)} />
                      <Stat label={t("paid")} value={fmt.money(sum.paid)} />
                      <Stat label={t("due")} value={fmt.money(sum.due)} strong />
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={sum.progress} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full bg-primary" style={{ width: `${sum.progress}%` }} />
                    </div>
                    {sum.overpaid && (
                      <p className="flex gap-2 text-[12px] text-danger">
                        <AlertTriangle className="size-3.5" /> {t("overpaid")}
                      </p>
                    )}
                    {sum.overEarned && (
                      <p className="flex gap-2 text-[12px] text-warning-foreground">
                        <AlertTriangle className="size-3.5" /> {t("overEarned")}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {data.canManage && g.status === "active" && (
                        <Button size="sm" variant="secondary" onClick={() => setWorkFor(g)}>
                          <Plus /> {t("addWork")}
                        </Button>
                      )}
                      {data.canPay && (
                        <Button size="sm" variant="soft" onClick={() => setPayFor(g)}>
                          <Banknote /> {t("addPayment")}
                        </Button>
                      )}
                    </div>
                    {(g.work.length > 0 || g.payments.length > 0) && (
                      <ul className="grid gap-1 text-[12px]">
                        {[...g.work.map((w) => ({ ...w, type: "work" as const, date: w.work_date })), ...g.payments.map((x) => ({ ...x, type: "pay" as const, date: x.paid_on }))]
                          .sort((a, b) => (a.date < b.date ? 1 : -1))
                          .slice(0, 8)
                          .map((e) => (
                            <li key={e.id} className="flex items-center justify-between gap-2 border-t border-border/60 pt-1">
                              <span>
                                {fmt.date(e.date)} ·{" "}
                                {e.type === "work"
                                  ? e.quantity_m2 != null
                                    ? t("workM2", { n: fmt.number(e.quantity_m2, 1) })
                                    : t("workPct", { n: fmt.number(e.percent ?? 0, 0) })
                                  : t(`method_${e.method}` as "method_cash")}
                                {e.type === "work" && e.auto && (
                                  <span className="ms-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{t("autoEntry")}</span>
                                )}
                              </span>
                              <span className="flex items-center gap-1">
                                <span className={cn("font-latin tabular-nums", e.type === "pay" && "text-success")}>
                                  {e.type === "pay" ? "− " : "+ "}
                                  {fmt.money(e.amount)}
                                </span>
                                {e.type === "work" && data.canManage && actions && (
                                  <DeleteWork id={e.id} del={actions.deleteWork} />
                                )}
                              </span>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })
      )}
      {subDialog && <SubDialog initial={subDialog} onClose={() => setSubDialog(null)} save={actions?.saveSub} />}
      {agreementFor && (
        <AgreementDialog
          subId={agreementFor}
          projects={data.projects}
          rate={(data.rates ?? []).find((r) => r.subcontractor_id === agreementFor)}
          onClose={() => setAgreementFor(null)}
          save={actions?.saveAgreement}
        />
      )}
      {editAgreement && (
        <AgreementDialog subId={editAgreement.subcontractor_id} projects={data.projects} initial={editAgreement} onClose={() => setEditAgreement(null)} save={actions?.saveAgreement} />
      )}
      {workFor && <WorkDialog agreement={workFor} today={today0} onClose={() => setWorkFor(null)} save={actions?.addWork} />}
      {payFor && <PayDialog agreement={payFor} today={today0} onClose={() => setPayFor(null)} save={actions?.addPayment} />}
    </div>
  );
}

function DeleteWork({ id, del }: { id: string; del: (i: { id: string }) => Promise<ActionResult> }) {
  const t = useTranslations("subs");
  const { run, pending } = useActionRunner();
  return (
    <Button size="icon-sm" variant="ghost" aria-label={t("deleteWork")} loading={pending} onClick={() => run(() => del({ id }))}>
      <Trash2 />
    </Button>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={cn("font-latin tabular-nums", strong ? "text-[15px] font-extrabold" : "font-bold")}>{value}</p>
    </div>
  );
}

function SubDialog({ initial, onClose, save }: { initial: Partial<SubcontractorsData["subs"][number]>; onClose: () => void; save?: Act<{ id: string }> }) {
  const t = useTranslations("subs");
  const tp = useTranslations("pricing");
  const { run, pending, fieldText } = useActionRunner();
  const [name, setName] = React.useState(initial.name ?? "");
  const [phone, setPhone] = React.useState(phoneForInput(initial.phone));
  const [services, setServices] = React.useState<ServiceKind[]>(initial.services ?? []);
  const [vat, setVat] = React.useState(initial.vat_number ?? "");
  const [iban, setIban] = React.useState(initial.iban ?? "");
  const [notes, setNotes] = React.useState(initial.notes ?? "");
  const [active, setActive] = React.useState(initial.is_active ?? true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={initial.id ? t("edit") : t("newSub")}
      pending={pending}
      onSubmit={() =>
        run(save && (() => save({ ...(initial.id ? { id: initial.id } : {}), name, phone, services, vat_number: vat, iban, notes, is_active: active })), { onFieldErrors: setErrors, onSuccess: onClose })
      }
    >
      <Field id="sb-name" label={t("name")} error={fieldText(errors.name)}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field id="sb-phone" label={t("phone")} optional={t("optional")} error={errors.phone ? t("phoneInvalid") : undefined}>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" className="font-latin rtl:text-right" placeholder="05xxxxxxxx" />
      </Field>
      <div className="flex flex-wrap gap-2">
        {(["gypsum", "interior", "exterior"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={services.includes(s)}
            onClick={() => setServices(services.includes(s) ? services.filter((x) => x !== s) : [...services, s])}
            className={cn("h-10 rounded-full px-4 text-[14px] ring-1", services.includes(s) ? "bg-primary text-primary-foreground ring-primary" : "bg-surface ring-border")}
          >
            {tp(`kind_${s}`)}
          </button>
        ))}
      </div>
      <div className="field-row grid gap-4 sm:grid-cols-2">
        <Field id="sb-vat" label={t("vat")} optional={t("optional")} error={errors.vat_number ? t("vatInvalid") : undefined}>
          <Input value={vat} onChange={(e) => setVat(e.target.value)} inputMode="numeric" dir="ltr" className="font-latin rtl:text-right" />
        </Field>
        <Field id="sb-iban" label={t("iban")} optional={t("optional")} error={errors.iban ? t("ibanInvalid") : undefined}>
          <Input value={iban} onChange={(e) => setIban(e.target.value)} dir="ltr" className="font-latin rtl:text-right" placeholder="SA…" />
        </Field>
      </div>
      <Field id="sb-notes" label={t("notes")} optional={t("optional")}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
      <label className="flex items-center justify-between gap-3 text-[14px]">
        <span>{t("active")}</span>
        <Switch checked={active} onCheckedChange={setActive} aria-label={t("active")} />
      </label>
    </FormDialog>
  );
}

function AgreementDialog({
  subId,
  projects,
  initial,
  rate: known,
  onClose,
  save,
}: {
  subId: string;
  projects: SubcontractorsData["projects"];
  /** editing an existing agreement */
  initial?: SubAgreementView;
  /** his saved price (pricing «العمالة والمصاريف») pre-fills a new agreement */
  rate?: { basis: "external_per_unit" | "external_lump"; rate: number };
  onClose: () => void;
  save?: Act;
}) {
  const t = useTranslations("subs");
  const { fmt } = useFormatter();
  const { run, pending, fieldText } = useActionRunner();
  const firstProject = initial ? projects.find((p) => p.id === initial.contract_id) : projects[0];
  const [contract, setContract] = React.useState(initial?.contract_id ?? projects[0]?.id ?? "");
  const [scope, setScope] = React.useState(initial?.scope ?? (firstProject ? t("scopeDefault", { number: ltr(firstProject.number) }) : ""));
  const [basis, setBasis] = React.useState<"per_m2" | "lump">(initial?.basis ?? (known?.basis === "external_lump" ? "lump" : "per_m2"));
  const [rate, setRate] = React.useState(initial ? String(initial.rate) : known ? String(known.rate) : "");
  const [qty, setQty] = React.useState(initial?.quantity_m2 != null ? String(initial.quantity_m2) : firstProject?.area != null ? String(firstProject.area) : "");
  const [schedule, setSchedule] = React.useState<"weekly" | "progress">(initial?.schedule ?? "progress");
  const [active, setActive] = React.useState(initial ? initial.status === "active" : true);
  const [auto, setAuto] = React.useState(initial ? initial.auto_progress : true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const pickProject = (id: string) => {
    setContract(id);
    const p = projects.find((x) => x.id === id);
    if (!initial && p) {
      setScope(t("scopeDefault", { number: ltr(p.number) }));
      if (p.area != null) setQty(String(p.area));
    }
  };
  const total = basis === "lump" ? num(rate) : num(rate) * num(qty);
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={initial ? t("editAgreement") : t("newAgreement")}
      pending={pending}
      onSubmit={() =>
        run(
          save &&
            (() =>
              save({
                ...(initial ? { id: initial.id } : {}),
                subcontractor_id: subId,
                contract_id: contract,
                scope,
                basis,
                rate: num(rate),
                quantity_m2: basis === "per_m2" ? num(qty) : null,
                schedule,
                status: active ? "active" : "closed",
                auto_progress: schedule === "progress" ? auto : false,
              })),
          {
          onFieldErrors: setErrors,
          onSuccess: onClose,
        })
      }
    >
      <Field id="ag-p" label={t("project")}>
        <NativeSelect value={contract} onChange={(e) => pickProject(e.target.value)} disabled={!!initial}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {ltr(p.number)} · {p.client}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="ag-s" label={t("scope")} error={fieldText(errors.scope)}>
        <Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder={t("scopeHint")} />
      </Field>
      <Segmented name={t("basis")} value={basis} onChange={setBasis} options={[{ value: "per_m2", label: t("basis_per_m2") }, { value: "lump", label: t("basis_lump") }]} />
      <div className="field-row grid gap-4 sm:grid-cols-2">
        <Field id="ag-r" label={basis === "lump" ? t("lumpAmount") : t("rate")}>
          <NumberInput value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        {basis === "per_m2" && (
          <Field id="ag-q" label={t("area")} error={errors.quantity_m2 ? t("required") : undefined}>
            <NumberInput value={qty} onChange={(e) => setQty(e.target.value)} suffix="m²" />
          </Field>
        )}
      </div>
      <Segmented name={t("schedule")} value={schedule} onChange={setSchedule} options={[{ value: "weekly", label: t("sched_weekly") }, { value: "progress", label: t("sched_progress") }]} />
      {schedule === "progress" && (
        <label className="flex items-center justify-between gap-3 text-[14px]">
          <span>
            {t("autoProgress")}
            <span className="block text-[12px] text-muted-foreground">{t("autoProgressHint")}</span>
          </span>
          <Switch checked={auto} onCheckedChange={setAuto} aria-label={t("autoProgress")} />
        </label>
      )}
      {initial && (
        <label className="flex items-center justify-between gap-3 text-[14px]">
          <span>{t("agreementActive")}</span>
          <Switch checked={active} onCheckedChange={setActive} aria-label={t("agreementActive")} />
        </label>
      )}
      <p className="text-[13px]">
        {t("agreed")}: <span className="font-latin font-bold tabular-nums">{fmt.money(total)}</span> · {t("noRetention")}
      </p>
    </FormDialog>
  );
}

function WorkDialog({ agreement: g, today, onClose, save }: { agreement: SubAgreementView; today: string; onClose: () => void; save?: Act }) {
  const t = useTranslations("subs");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const [date, setDate] = React.useState(today);
  const [val, setVal] = React.useState("");
  const [note, setNote] = React.useState("");
  const amount = workAmount(g, g.basis === "per_m2" ? { quantity_m2: num(val) } : { percent: num(val) });
  // the database refuses more than what is left on the agreement (0.01 tolerance)
  const left = workRemaining(g, g.work);
  const over = num(val) > left + 0.01;
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t("addWork")}
      pending={pending}
      onSubmit={() =>
        run(save && (() => save({ agreement_id: g.id, work_date: date, quantity_m2: g.basis === "per_m2" ? num(val) : null, percent: g.basis === "lump" ? num(val) : null, note: note || null })), { onSuccess: onClose })
      }
    >
      <Field id="wk-d" label={t("date")}>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field
        id="wk-v"
        label={g.basis === "per_m2" ? t("areaDone") : t("percentDone")}
        hint={g.basis === "per_m2" ? t("leftArea", { n: fmt.number(left, 2) }) : t("leftPct", { n: fmt.number(left, 2) })}
        error={over ? t("overLeft") : undefined}
      >
        <NumberInput value={val} onChange={(e) => setVal(e.target.value)} suffix={g.basis === "per_m2" ? "m²" : "%"} />
      </Field>
      <p className="text-[13px]">
        {t("earnsNow")}: <span className="font-latin font-bold tabular-nums">{fmt.money(amount)}</span>
      </p>
      <Field id="wk-n" label={t("notes")} optional={t("optional")}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

function PayDialog({ agreement: g, today, onClose, save }: { agreement: SubAgreementView; today: string; onClose: () => void; save?: Act }) {
  const t = useTranslations("subs");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const sum = subSummary(g, g.work.reduce((a, w) => a + w.amount, 0), g.payments.reduce((a, p) => a + p.amount, 0));
  const [date, setDate] = React.useState(today);
  const [amount, setAmount] = React.useState(String(sum.due || ""));
  const [method, setMethod] = React.useState<"transfer" | "cash" | "cheque">("transfer");
  const [ref, setRef] = React.useState("");
  const over = num(amount) > sum.due + 0.005;
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t("addPayment")}
      description={t("dueNow", { amount: fmt.money(sum.due) })}
      pending={pending}
      onSubmit={() => run(save && (() => save({ agreement_id: g.id, paid_on: date, amount: num(amount), method, reference: ref || null, note: null })), { onSuccess: onClose })}
    >
      <div className="field-row grid gap-4 sm:grid-cols-2">
        <Field id="py-d" label={t("date")}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="py-a" label={t("amount")}>
          <NumberInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      {over && (
        <p className="flex gap-2 rounded-2xl bg-warning-soft px-4 py-2 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t("payAhead")}
        </p>
      )}
      <Segmented name={t("method")} value={method} onChange={setMethod} options={(["transfer", "cash", "cheque"] as const).map((m) => ({ value: m, label: t(`method_${m}`) }))} />
      <Field id="py-r" label={t("reference")} optional={t("optional")}>
        <Input value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

// --- Petty cash ---------------------------------------------------------------------

export type PettyActions = {
  createAccount: Act;
  addEntry: Act;
  upload: (fd: FormData) => Promise<ActionResult<{ path: string; draft: InvoiceDraft | null; flags: InvoiceFlag[]; aiError?: string }>>;
};

export function PettyCashView({ data, actions }: { data: PettyCashData; actions?: PettyActions }) {
  const t = useTranslations("petty");
  const { fmt } = useFormatter();
  const [newAccount, setNewAccount] = React.useState(false);
  const [entry, setEntry] = React.useState<{ account: string; kind: "topup" | "expense" | "return" } | null>(null);
  const project = new Map(data.projects.map((p) => [p.id, p]));
  const [today0] = React.useState(today);
  const visible = data.accounts.filter((a) => data.canFinance || data.canManage || a.holder_id === data.userId);
  return (
    <div className="grid gap-4 [&>*]:min-w-0">
      {data.canFinance && (
        <Button className="justify-self-start" variant="secondary" onClick={() => setNewAccount(true)}>
          <Plus /> {t("newAccount")}
        </Button>
      )}
      {visible.length === 0 ? (
        <EmptyState icon={<Wallet />} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        visible.map((a) => {
          const own = data.entries.filter((e) => e.account_id === a.id);
          const balance = pettyBalance(own);
          const mine = a.holder_id === data.userId;
          return (
            <section key={a.id} className="grid gap-3 rounded-3xl border border-border bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[16px] font-bold">{a.name}</p>
                  <p className="text-[13px] text-muted-foreground">{t("holder", { name: a.holder })}</p>
                </div>
                <div className="text-end">
                  <p className="text-[12px] text-muted-foreground">{t("balance")}</p>
                  <p className={cn("font-latin text-[22px] font-extrabold tabular-nums", balance < 0 && "text-danger")}>{fmt.money(balance)}</p>
                </div>
              </div>
              {balance < 0 && <p className="text-[12px] text-danger">{t("negative")}</p>}
              <div className="flex flex-wrap gap-2">
                {(mine || data.canManage) && a.is_active && (
                  <Button onClick={() => setEntry({ account: a.id, kind: "expense" })}>
                    <Camera /> {t("addExpense")}
                  </Button>
                )}
                {data.canFinance && (
                  <>
                    <Button variant="secondary" onClick={() => setEntry({ account: a.id, kind: "topup" })}>
                      <Plus /> {t("topup")}
                    </Button>
                    <Button variant="ghost" onClick={() => setEntry({ account: a.id, kind: "return" })}>
                      {t("return")}
                    </Button>
                  </>
                )}
              </div>
              {own.length > 0 && (
                <ul className="grid gap-1.5 text-[13px]">
                  {own.slice(0, 15).map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-3 border-t border-border/60 pt-1.5">
                      <span className="min-w-0">
                        <span className="block truncate font-bold">
                          {e.description}
                          {e.has_receipt && <Receipt className="ms-1 inline size-3.5 text-muted-foreground" aria-label={t("hasReceipt")} />}
                          {e.ai_extracted && <Sparkles className="ms-1 inline size-3.5 text-primary" aria-label={t("aiRead")} />}
                        </span>
                        <span className="text-[12px] text-muted-foreground">
                          {fmt.date(e.entry_date)} · {t(`kind_${e.kind}`)}
                          {e.contract_id && project.get(e.contract_id) && ` · ${project.get(e.contract_id)!.client}`}
                          {e.supplier_name && ` · ${e.supplier_name}`}
                        </span>
                      </span>
                      <span className={cn("shrink-0 font-latin font-bold tabular-nums", e.kind === "topup" ? "text-success" : "")}>
                        {e.kind === "topup" ? "+ " : "− "}
                        {fmt.money(e.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
      {newAccount && <AccountDialog members={data.members} onClose={() => setNewAccount(false)} save={actions?.createAccount} />}
      {entry && <EntryDialog {...entry} today={today0} data={data} onClose={() => setEntry(null)} actions={actions} />}
    </div>
  );
}

function AccountDialog({ members, onClose, save }: { members: PettyCashData["members"]; onClose: () => void; save?: Act }) {
  const t = useTranslations("petty");
  const { run, pending, fieldText } = useActionRunner();
  const [holder, setHolder] = React.useState(members[0]?.id ?? "");
  const [name, setName] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <FormDialog open onOpenChange={(v) => !v && onClose()} title={t("newAccount")} pending={pending} onSubmit={() => run(save && (() => save({ holder_id: holder, name })), { onFieldErrors: setErrors, onSuccess: onClose })}>
      <Field id="pa-h" label={t("holderLabel")}>
        <NativeSelect value={holder} onChange={(e) => setHolder(e.target.value)}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="pa-n" label={t("accountName")} error={fieldText(errors.name)}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("accountNameHint")} />
      </Field>
    </FormDialog>
  );
}

function EntryDialog({ account, kind, today, data, onClose, actions }: { account: string; kind: "topup" | "expense" | "return"; today: string; data: PettyCashData; onClose: () => void; actions?: PettyActions }) {
  const sep = useListSep();
  const t = useTranslations("petty");
  const { run, pending, errorText } = useActionRunner();
  const [date, setDate] = React.useState(today);
  const [amount, setAmount] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [supplier, setSupplier] = React.useState("");
  const [contract, setContract] = React.useState(data.projects[0]?.id ?? "");
  const [path, setPath] = React.useState<string | null>(null);
  const [ai, setAi] = React.useState(false);
  const [reading, setReading] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const camera = React.useRef<HTMLInputElement>(null);

  const onPhoto = async (file: File | undefined) => {
    if (!file || !actions) return;
    setReading(true);
    setNote(null);
    const fd = new FormData();
    fd.set("file", await shrinkImage(file));
    fd.set("ai", data.aiEnabled ? "1" : "0");
    const r = await settle(() => actions.upload(fd));
    setReading(false);
    if (!r.ok) return setNote(errorText(r.error));
    setPath(r.data!.path);
    const d = r.data!.draft;
    if (!d) return setNote(r.data!.aiError ? t("aiOff") : t("photoAttached"));
    setAi(true);
    if (d.total != null) setAmount(String(d.total));
    if (d.supplier_name) setSupplier(d.supplier_name);
    if (d.invoice_date && /^\d{4}-\d{2}-\d{2}$/.test(d.invoice_date)) setDate(d.invoice_date);
    if (d.lines.length) setDescription(d.lines.map((l) => l.description).join(sep).slice(0, 300));
    setNote(t("aiFilled"));
  };

  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t(`dialog_${kind}`)}
      pending={pending}
      onSubmit={() =>
        run(
          actions &&
            (() =>
              actions.addEntry({
                account_id: account, kind, entry_date: date, amount: num(amount), contract_id: kind === "expense" ? contract || null : null,
                description: description || t(`kind_${kind}`), supplier_name: supplier || null, attachment_path: path, ai_extracted: ai,
              })),
          { onSuccess: onClose },
        )
      }
    >
      {kind === "expense" && (
        <div className="grid gap-2">
          <Button type="button" variant="secondary" loading={reading} onClick={() => camera.current?.click()}>
            <Camera /> {t("photoReceipt")}
          </Button>
          <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
          {note && <p className="text-[13px] text-muted-foreground">{note}</p>}
        </div>
      )}
      <div className="field-row grid gap-4 sm:grid-cols-2">
        <Field id="pe-d" label={t("date")}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="pe-a" label={t("amount")}>
          <NumberInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      {kind === "expense" && (
        <>
          <Field id="pe-p" label={t("project")} hint={t("projectHint")}>
            <NativeSelect value={contract} onChange={(e) => setContract(e.target.value)}>
              <option value="">{t("general")}</option>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {ltr(p.number)} · {p.client}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="pe-s" label={t("supplier")} optional={t("optional")}>
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
        </>
      )}
      <Field id="pe-x" label={t("description")}>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t(`descHint_${kind}`)} />
      </Field>
    </FormDialog>
  );
}
