"use client";
import { DocNo } from "@/components/doc-no";
import { Check, FilePlus2, Pencil, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { FormDialog, NumberInput, useActionRunner } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import type { AddendumView, ContractDetail } from "@/lib/data/contracts";
import type { AddendumStatus } from "@/lib/supabase/database.types";
import { toNumber } from "@/lib/validation/numbers";

const TONE: Record<AddendumStatus, "neutral" | "primary" | "warning" | "success" | "danger"> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "primary",
  sent: "primary",
  accepted: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export type AddendaActions = {
  save: (i: Record<string, unknown>) => Promise<ActionResult<{ status: string }>>;
  send: (i: { id: string }) => Promise<ActionResult>;
  cancel: (i: { id: string }) => Promise<ActionResult>;
  decide: (i: Record<string, unknown>) => Promise<ActionResult>;
  paid: (i: { id: string }) => Promise<ActionResult>;
};

/** Expected delivery after accepted addenda (each adds its days). */
export function deliveryWithAddenda(start: string, days: number, addenda: Pick<AddendumView, "status" | "extra_days">[]) {
  const extra = addenda.filter((a) => a.status === "accepted").reduce((s, a) => s + a.extra_days, 0);
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days + extra);
  return { date: d.toISOString().slice(0, 10), extra };
}

/** §3.8 additional works on a contract: draft → owner approval → client page → accepted. */
export function AddendaSection({ detail, actions }: { detail: ContractDetail; actions?: AddendaActions }) {
  const t = useTranslations("addenda");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const [editing, setEditing] = React.useState<Partial<AddendumView> | null>(null);
  const c = detail.contract;
  if (c.status !== "accepted" && detail.addenda.length === 0) return null;
  const delivery = deliveryWithAddenda(c.start_date, c.duration_days, detail.addenda);

  return (
    <section className="grid gap-3 rounded-3xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[15px] font-bold">{t("title")}</p>
          {delivery.extra > 0 && <p className="text-[13px] text-muted-foreground">{t("newDelivery", { date: fmt.date(delivery.date), n: delivery.extra })}</p>}
        </div>
        {detail.canManage && c.status === "accepted" && (
          <Button size="sm" variant="secondary" onClick={() => setEditing({})}>
            <FilePlus2 /> {t("new")}
          </Button>
        )}
      </div>
      <p className="text-[12px] text-muted-foreground">{t("rule")}</p>
      {detail.addenda.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="grid gap-2">
          {detail.addenda.map((a) => (
            <li key={a.id} className="grid gap-2 rounded-2xl bg-surface-sunken/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  <DocNo>{a.number}</DocNo> {a.title}
                  <Badge tone={TONE[a.status]}>{t(`st_${a.status}`)}</Badge>
                  {a.status === "accepted" && <Badge tone={a.payment_status === "paid" ? "success" : "warning"}>{t(`pay_${a.payment_status}`)}</Badge>}
                </p>
                <p className="font-latin font-bold tabular-nums">{fmt.money(a.total)}</p>
              </div>
              <p className="whitespace-pre-line text-[13px]">{a.description}</p>
              <p className="text-[12px] text-muted-foreground">
                {t("extraDays", { n: a.extra_days })}
                {a.accepted_at && ` · ${t("acceptedBy", { name: a.accepted_name ?? "", date: fmt.dateTime(a.accepted_at) })}`}
              </p>
              <div className="flex flex-wrap gap-2">
                {detail.canManage && ["draft", "rejected"].includes(a.status) && (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
                    <Pencil /> {t("edit")}
                  </Button>
                )}
                {a.status === "pending_approval" && detail.canDecide && a.approval_id && actions && (
                  <>
                    <Button size="sm" loading={pending} onClick={() => run(() => actions.decide({ approval_id: a.approval_id, decision: "approved" }))}>
                      <Check /> {t("approve")}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => actions.decide({ approval_id: a.approval_id, decision: "rejected" }))}>
                      {t("reject")}
                    </Button>
                  </>
                )}
                {a.status === "approved" && detail.canManage && actions && (
                  <Button size="sm" loading={pending} onClick={() => run(() => actions.send({ id: a.id }))}>
                    <Send /> {t("send")}
                  </Button>
                )}
                {a.status === "accepted" && a.payment_status === "requested" && detail.canFinance && actions && (
                  <Button size="sm" variant="soft" loading={pending} onClick={() => run(() => actions.paid({ id: a.id }))}>
                    <Check /> {t("markPaid")}
                  </Button>
                )}
                {detail.canManage && !["accepted", "cancelled"].includes(a.status) && actions && (
                  <Button size="sm" variant="ghost" className="text-danger" disabled={pending} onClick={() => run(() => actions.cancel({ id: a.id }))}>
                    <X /> {t("cancel")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <AddendumDialog contractId={c.id} vatPercent={detail.vatPercent} initial={editing} onClose={() => setEditing(null)} save={actions?.save} />}
    </section>
  );
}

function AddendumDialog({ contractId, vatPercent, initial, onClose, save }: { contractId: string; vatPercent: number; initial: Partial<AddendumView>; onClose: () => void; save?: AddendaActions["save"] }) {
  const t = useTranslations("addenda");
  const { fmt } = useFormatter();
  const { run, pending, fieldText } = useActionRunner();
  const [title, setTitle] = React.useState(initial.title ?? "");
  const [description, setDescription] = React.useState(initial.description ?? "");
  const [amount, setAmount] = React.useState(initial.amount != null ? String(initial.amount) : "");
  const [days, setDays] = React.useState(initial.extra_days != null ? String(initial.extra_days) : "0");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const num = (v: string) => (typeof toNumber(v) === "number" ? (toNumber(v) as number) : 0);
  const vat = Math.round(num(amount) * vatPercent) / 100;
  const submit = (send: boolean) =>
    run(
      save &&
        (() =>
          save({
            ...(initial.id ? { id: initial.id } : {}),
            contract_id: contractId,
            title,
            description,
            amount: num(amount),
            extra_days: Math.round(num(days)),
            submit: send,
          })),
      { onFieldErrors: setErrors, onSuccess: onClose },
    );
  return (
    <FormDialog
      open
      wide
      onOpenChange={(v) => !v && onClose()}
      title={initial.id ? t("edit") : t("new")}
      pending={pending}
      submitLabel={t("submit")}
      onSubmit={() => submit(true)}
      footerExtra={
        <Button type="button" variant="ghost" disabled={pending} onClick={() => submit(false)}>
          {t("saveDraft")}
        </Button>
      }
    >
      <Field id="ad-title" label={t("fieldTitle")} error={fieldText(errors.title)}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("titleHint")} autoFocus />
      </Field>
      <Field id="ad-desc" label={t("fieldScope")} hint={t("scopeHint")} error={fieldText(errors.description)}>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field id="ad-amount" label={t("amount")} hint={vatPercent > 0 ? t("plusVat", { vat: fmt.money(vat) }) : t("noVat")}>
          <NumberInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id="ad-days" label={t("extraDaysLabel")}>
          <NumberInput value={days} onChange={(e) => setDays(e.target.value)} suffix={t("daysUnit")} />
        </Field>
      </div>
      <p className="text-[12px] text-muted-foreground">{t("submitHint")}</p>
    </FormDialog>
  );
}
