"use client";
import { Check, Copy, Handshake, Link2, Plus, Printer, Send, Wallet, XCircle } from "lucide-react";
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
import { Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { displayPhone } from "@/components/clients/clients-view";
import type { ActionResult } from "@/lib/actions";
import type { CommissionView, MarketersData, MarketerView } from "@/lib/data/marketers";
import { projectHref } from "@/lib/finance";
import { commissionTotals, type CommissionStatus } from "@/lib/marketers";
import { toNumber } from "@/lib/validation/numbers";
import { cn } from "@/lib/utils";

type Act<T = undefined> = (i: Record<string, unknown>) => Promise<ActionResult<T>>;
export type MarketersActions = { save: Act<{ number: string }>; issueLink: Act<{ url: string }>; revokeLinks: Act; pay: Act<{ number: string }> };

const TONE: Record<CommissionStatus, "neutral" | "warning" | "success" | "danger"> = { expected: "neutral", due: "warning", paid: "success", cancelled: "danger" };
const todayRiyadh = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

/** «شركاء النجاح»: each partner, his clients and contracts, his reward (expected / due / paid) and his own page link. */
export function MarketersView({ data, actions, base = "", highlight = null }: { data: MarketersData; actions?: MarketersActions; base?: string; /** a reward id from a notification link (/partners?k=<id>) — its card is marked */ highlight?: string | null }) {
  const t = useTranslations("marketers");
  const { fmt } = useFormatter();
  const [edit, setEdit] = React.useState<Partial<MarketerView> | null>(null);
  const [payFor, setPayFor] = React.useState<CommissionView | null>(null);
  const totals = commissionTotals(data.commissions);
  return (
    <div className="grid gap-4 [&>*]:min-w-0">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label={t("kpiExpected")} value={fmt.money(totals.expected)} />
        <Kpi label={t("kpiDue")} value={fmt.money(totals.due)} strong={totals.due > 0} />
        <Kpi label={t("kpiPaid")} value={fmt.money(totals.paid)} />
      </div>
      {data.canManage && (
        <Button className="justify-self-start" onClick={() => setEdit({ is_active: true, commission_percent: 5 })}>
          <Plus /> {t("new")}
        </Button>
      )}
      {data.marketers.length === 0 ? (
        <EmptyState icon={<Handshake />} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <div className="columns-1 gap-4 lg:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {data.marketers.map((m) => (
            <MarketerCard key={m.id} m={m} data={data} actions={actions} onEdit={() => setEdit(m)} onPay={setPayFor} base={base} highlight={highlight} />
          ))}
        </div>
      )}
      {edit && <MarketerDialog initial={edit} onClose={() => setEdit(null)} save={actions?.save} />}
      {payFor && <PayDialog k={payFor} onClose={() => setPayFor(null)} pay={actions?.pay} />}
    </div>
  );
}

function Kpi({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-3xl border border-border bg-surface p-4">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={cn("font-latin text-[18px] font-extrabold tabular-nums", strong && "text-primary")}>{value}</p>
    </div>
  );
}

function MarketerCard({ m, data, actions, onEdit, onPay, base, highlight }: { m: MarketerView; data: MarketersData; actions?: MarketersActions; onEdit: () => void; onPay: (k: CommissionView) => void; base: string; highlight: string | null }) {
  const t = useTranslations("marketers");
  const { fmt } = useFormatter();
  const own = data.commissions.filter((k) => k.marketer_id === m.id);
  const totals = commissionTotals(own);
  const marked = !!highlight && own.some((k) => k.id === highlight);
  const ref = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (marked) ref.current?.scrollIntoView({ block: "center" });
  }, [marked]);
  return (
    <section ref={ref} className={cn("grid gap-3 rounded-3xl border border-border bg-surface p-5", !m.is_active && "opacity-60", marked && "ring-2 ring-primary")} data-testid="marketer-card" data-highlighted={marked || undefined}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[16px] font-bold">{m.name}</p>
          <p className="text-[13px] text-muted-foreground">
            <DocNo>{m.number}</DocNo>
            {m.phone && (
              <>
                {" · "}
                <bdi dir="ltr" className="font-latin">{displayPhone(m.phone)}</bdi>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="primary">{t("percentBadge", { percent: fmt.number(m.commission_percent) })}</Badge>
          {!m.is_active && <Badge>{t("inactive")}</Badge>}
          {data.canManage && (
            <Button size="sm" variant="secondary" onClick={onEdit}>
              {t("edit")}
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 text-[13px]">
        <Stat label={t("kpiExpected")} value={fmt.money(totals.expected)} />
        <Stat label={t("kpiDue")} value={fmt.money(totals.due)} strong />
        <Stat label={t("kpiPaid")} value={fmt.money(totals.paid)} />
      </div>
      {m.clients.length > 0 && (
        <div className="grid gap-1">
          <p className="text-[12px] font-bold text-muted-foreground">{t("clients")}</p>
          <div className="flex flex-wrap gap-1.5">
            {m.clients.map((c) => (
              <Link key={c.number} href={`${base}/clients/${c.number}`} className="rounded-full bg-surface-sunken px-3 py-1 text-[13px] hover:underline">
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      )}
      {own.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("noContracts")}</p>
      ) : (
        <ul className="grid gap-2">
          {own.map((k) => {
            const path = projectHref(k.contract, data.links);
            const href = path ? `${base}${path}` : null;
            return (
              <li key={k.id} className={cn("grid gap-2 rounded-2xl bg-surface-sunken/50 p-3 text-[13px]", k.id === highlight && "ring-2 ring-primary")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 font-bold">
                    {k.client} ·{" "}
                    {href ? (
                      <Link href={href} className="hover:underline">
                        <DocNo>{k.contract}</DocNo>
                      </Link>
                    ) : (
                      <DocNo>{k.contract}</DocNo>
                    )}
                  </p>
                  <Badge tone={TONE[k.status]}>{t(`status_${k.status}`)}</Badge>
                </div>
                <p className="text-muted-foreground">
                  {t("line", { base: fmt.money(k.base), percent: fmt.number(k.percent), amount: fmt.money(k.amount) })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {k.status === "due" && data.canPay && (
                    <Button size="sm" onClick={() => onPay(k)}>
                      <Wallet /> {t("pay")}
                    </Button>
                  )}
                  {k.voucher && data.canSeeVouchers && (
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`${base}/print/payment-vouchers/${k.voucher.number}`}>
                        <Printer /> {t("voucher", { number: k.voucher.number })}
                      </Link>
                    </Button>
                  )}
                  {k.status === "paid" && k.voucher && (
                    <WhatsAppButton
                      phone={m.phone}
                      label={t("waPaidButton")}
                      text={t("waPaid", { name: m.name, amount: fmt.money(k.amount), contract: k.contract, voucher: k.voucher.number, org: data.orgName })}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {data.canManage && m.is_active && <PartnerLink m={m} orgName={data.orgName} actions={actions} />}
    </section>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={cn("font-latin tabular-nums", strong ? "text-[15px] font-extrabold" : "font-bold")}>{value}</p>
    </div>
  );
}

/** His own page: the address is shown once (only its hash is stored); WhatsApp from the owner's number. */
function PartnerLink({ m, orgName, actions }: { m: MarketerView; orgName: string; actions?: MarketersActions }) {
  const t = useTranslations("marketers");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const [url, setUrl] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const text = url ? t("waLink", { name: m.name, org: orgName, url }) : t("waReminder", { name: m.name, org: orgName });
  return (
    <div className="grid gap-2 rounded-2xl border border-border p-3" data-testid="partner-link">
      <p className="flex items-center gap-2 text-[13px] font-bold">
        <Link2 className="size-4" /> {t("pageTitle")}
      </p>
      <p className="text-[12px] text-muted-foreground">{m.link ? t("linkActive", { date: fmt.date(m.link.expires_at.slice(0, 10)) }) : t("linkNone")}</p>
      {url && (
        <div className="grid gap-2 rounded-2xl bg-surface-sunken p-3">
          <p className="text-[12px] text-warning">{t("linkOnce")}</p>
          <p className="break-all font-latin text-[12px]" dir="ltr">
            {url}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? t("copied") : t("copy")}
            </Button>
            <WhatsAppButton phone={m.phone} text={text} label={t("sendWhatsapp")} variant="primary" />
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={pending}
          variant={m.link ? "secondary" : "primary"}
          onClick={() =>
            run(actions && (() => actions.issueLink({ id: m.id })), {
              silent: true,
              onSuccess: (r) => {
                if (r.ok && r.data) {
                  setUrl(r.data.url);
                  setCopied(false);
                }
              },
            })
          }
        >
          <Send /> {m.link ? t("renewLink") : t("issueLink")}
        </Button>
        {m.link && !url && <WhatsAppButton phone={m.phone} text={text} label={t("remindWhatsapp")} />}
        {m.link && (
          <Button size="sm" variant="ghost" loading={pending} onClick={() => run(actions && (() => actions.revokeLinks({ id: m.id })), { onSuccess: () => setUrl(null) })}>
            <XCircle /> {t("revokeLink")}
          </Button>
        )}
      </div>
    </div>
  );
}

function MarketerDialog({ initial, onClose, save }: { initial: Partial<MarketerView>; onClose: () => void; save?: Act<{ number: string }> }) {
  const t = useTranslations("marketers");
  const { run, pending, fieldText } = useActionRunner();
  const [name, setName] = React.useState(initial.name ?? "");
  // a Saudi number (966…) is shown as 05…; anything else exactly as stored — never converted silently
  const [phone, setPhone] = React.useState(initial.phone ? (initial.phone.startsWith("966") ? `0${initial.phone.slice(3)}` : initial.phone) : "");
  const [percent, setPercent] = React.useState(String(initial.commission_percent ?? ""));
  const [iban, setIban] = React.useState(initial.iban ?? "");
  const [notes, setNotes] = React.useState(initial.notes ?? "");
  const [active, setActive] = React.useState(initial.is_active ?? true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const p = toNumber(percent);
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={initial.id ? t("edit") : t("new")}
      description={initial.id ? t("percentChangeHint") : undefined}
      pending={pending}
      onSubmit={() =>
        run(save && (() => save({ ...(initial.id ? { id: initial.id } : {}), name, phone, commission_percent: typeof p === "number" ? p : -1, iban, notes, is_active: active })), {
          onFieldErrors: setErrors,
          onSuccess: onClose,
        })
      }
    >
      <Field id="mk-name" label={t("name")} error={fieldText(errors.name)}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <div className="field-row grid gap-4 sm:grid-cols-2">
        <Field id="mk-phone" label={t("phone")} optional={t("optional")} error={errors.phone ? t("phoneInvalid") : undefined}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" className="font-latin rtl:text-right" placeholder="05xxxxxxxx" />
        </Field>
        <Field id="mk-pct" label={t("percent")} hint={t("percentHint")} error={errors.commission_percent ? t("percentInvalid") : undefined}>
          <NumberInput value={percent} onChange={(e) => setPercent(e.target.value)} suffix="%" />
        </Field>
      </div>
      <Field id="mk-iban" label={t("iban")} optional={t("optional")} error={errors.iban ? t("ibanInvalid") : undefined}>
        <Input value={iban} onChange={(e) => setIban(e.target.value)} dir="ltr" className="font-latin rtl:text-right" placeholder="SA…" />
      </Field>
      <Field id="mk-notes" label={t("notes")} optional={t("optional")}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
      <label className="flex items-center gap-3 text-[14px]">
        <Switch checked={active} onCheckedChange={setActive} /> {t("active")}
      </label>
    </FormDialog>
  );
}

function PayDialog({ k, onClose, pay }: { k: CommissionView; onClose: () => void; pay?: Act<{ number: string }> }) {
  const t = useTranslations("marketers");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const [date, setDate] = React.useState(todayRiyadh);
  const [method, setMethod] = React.useState<"transfer" | "cash" | "cheque">("transfer");
  const [ref, setRef] = React.useState("");
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t("pay")}
      description={t("payHint", { amount: fmt.money(k.amount), contract: k.contract })}
      pending={pending}
      submitLabel={t("payConfirm", { amount: fmt.money(k.amount) })}
      onSubmit={() => run(pay && (() => pay({ id: k.id, paid_on: date, method, reference: ref || null, note: null })), { onSuccess: onClose })}
    >
      <Field id="mkp-d" label={t("date")}>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Segmented name={t("method")} value={method} onChange={setMethod} options={(["transfer", "cash", "cheque"] as const).map((x) => ({ value: x, label: t(`method_${x}`) }))} />
      <Field id="mkp-r" label={t("reference")} optional={t("optional")}>
        <Input value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
    </FormDialog>
  );
}
