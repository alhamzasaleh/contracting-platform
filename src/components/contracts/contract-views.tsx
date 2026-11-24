"use client";
import { DocNo } from "@/components/doc-no";
import { AlertTriangle, CalendarClock, CalendarDays, Check, Copy, FileSignature, HardHat, Link2, MessageCircle, Pencil, Plus, Printer, Send, ShoppingCart, Trash2, Wrench, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { NumberInput, useActionRunner } from "@/components/forms/form-kit";
import { QuoteDocument, type DocOrg } from "@/components/quotes/quote-document";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionResult } from "@/lib/actions";
import { capPercent, firstPaymentWarning, lastValidDay, percentSum, portalLinkState, scheduleAmounts, type DueEvent } from "@/lib/contracts";
import type { ContractDetail, ContractDraft, ContractListItem } from "@/lib/data/contracts";
import type { ContractStatus } from "@/lib/supabase/database.types";
import { toNumber } from "@/lib/validation/numbers";
import { anyTeamFree, spanOf, suggestStart, type Entry, type TeamInfo } from "@/lib/schedule";
import { cn, ltr } from "@/lib/utils";
import { remainingAmount } from "@/lib/finance";
import { ReceiptsList } from "@/components/finance/receipts-list";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { ClausesPanel } from "./clauses-panel";
import type { ContractTermsConfig } from "@/lib/contracts/terms";
import { AddendaSection, type AddendaActions } from "./addenda-section";
import { ContractTerms, type ContractOrg } from "./contract-terms";

const TONE: Record<ContractStatus, "neutral" | "primary" | "success" | "danger"> = { draft: "neutral", sent: "primary", accepted: "success", cancelled: "danger" };
const EVENTS: DueEvent[] = ["signing", "material_supply", "board_closing", "primer_done", "handover", "custom"];

export function ContractsView({ contracts, base = "" }: { contracts: ContractListItem[]; base?: string }) {
  const t = useTranslations("contract");
  const tq = useTranslations("quotes");
  const { fmt } = useFormatter();
  if (!contracts.length) return <EmptyState icon={<FileSignature />} title={t("emptyTitle")} description={t("emptyBody")} />;
  return (
    <ul className="grid gap-2">
      {contracts.map((c) => (
        <li key={c.id}>
          <Link href={`${base}/contracts/${c.number}`} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 hover:border-primary/40">
            <span>
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-bold">{c.client}</span>
                <Badge>{tq(`service_${c.service}`)}</Badge>
                <Badge tone={TONE[c.status]}>{t(`status_${c.status}`)}</Badge>
              </span>
              <span className="text-[12px] text-muted-foreground">
                <DocNo>{c.number}</DocNo> · {t("startsOn", { date: fmt.date(c.start_date) })}
              </span>
            </span>
            <span className="font-latin text-[16px] font-bold tabular-nums">{fmt.money(c.total)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

type Row = { label: string; percent: number | null; due_event: DueEvent; text?: string };

/** Create a contract from an issued quote, or edit a draft/sent one. */
export function ContractEditor({
  draft,
  onSave,
  base = "",
  busy,
}: {
  draft: ContractDraft;
  onSave?: (i: Record<string, unknown>) => Promise<ActionResult<{ number: string }>>;
  base?: string;
  /** teams and bookings, for the earliest-start suggestion (§3.9); null without schedule access */
  busy?: { teams: TeamInfo[]; entries: Entry[] } | null;
}) {
  const t = useTranslations("contract");
  const tp = useTranslations("pricing");
  const ts = useTranslations("schedule");
  const { fmt } = useFormatter();
  const router = useRouter();
  const { run, pending } = useActionRunner();
  // default start: three days from now (computed once, outside render purity rules)
  const [start, setStart] = React.useState(() => draft.contract?.start_date ?? new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  const [days, setDays] = React.useState(draft.contract?.duration_days ?? draft.suggestedDays);
  const [warranty, setWarranty] = React.useState(draft.contract?.warranty_months ?? draft.defaultWarranty);
  const [notes, setNotes] = React.useState(draft.contract?.notes ?? "");
  const [rows, setRows] = React.useState<Row[]>(
    draft.payments.length ? draft.payments : draft.stages.map((e) => ({ label: t(`event_${e}`), percent: null, due_event: e })),
  );
  const percents = rows.map((r) => r.percent ?? 0);
  const sum = percentSum(percents);
  const amounts = scheduleAmounts(draft.quote.total, percents);
  const warn = draft.materialCost != null && rows.length ? firstPaymentWarning(amounts[0] ?? 0, draft.materialCost) : null;
  const [today] = React.useState(() => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10));
  const plan = React.useMemo(() => {
    if (!busy || !busy.teams.length || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
    const exclude = draft.contract ? { contract_id: draft.contract.id } : undefined;
    return {
      // the team priced on the quote, when known (G1)
      free: anyTeamFree(busy.teams, busy.entries, draft.quote.service, spanOf(start, days), exclude, draft.bookTeam),
      suggestion: suggestStart(busy.teams, busy.entries, draft.quote.service, today, days, exclude, draft.bookTeam),
    };
  }, [busy, start, days, today, draft.contract, draft.quote.service, draft.bookTeam]);
  const setRow = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const remaining = Math.max(0, Math.round((100 - sum) * 100) / 100);
  // typing a percentage can never push the total above 100 %
  const setPercent = (i: number, raw: string) => {
    const n = toNumber(raw);
    if (typeof n !== "number") return setRow(i, { percent: null, text: raw });
    const capped = capPercent(n, percents.filter((_, j) => j !== i));
    setRow(i, { percent: capped || null, text: capped === n ? raw : String(capped) });
  };
  // put the remainder on the first empty payment, else on the last one
  const fillRemaining = () => {
    const i = rows.findIndex((r) => !r.percent);
    const at = i >= 0 ? i : rows.length - 1;
    const v = Math.round(((rows[at].percent ?? 0) + remaining) * 100) / 100;
    setRow(at, { percent: v, text: String(v) });
  };

  return (
    <div className="grid gap-6 min-[1150px]:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid content-start gap-5">
        <section className="@container grid gap-4 rounded-3xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[15px] font-bold">
              {draft.client.name} · {tp(`kind_${draft.quote.service}`)}
            </p>
            <Badge>{tp(`pt_${draft.quote.projectType}`)}</Badge>
          </div>
          {/* sized by the card, not the screen: the card is narrow next to the side panel on an iPad */}
          <div className="field-row grid grid-cols-2 items-start gap-4 @lg:grid-cols-3">
            <Field id="ct-start" className="col-span-2 @lg:col-span-1" label={t("start")}>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field id="ct-days" label={t("duration")} hint={t("durationHint", { n: draft.suggestedDays })}>
              <NumberInput defaultValue={days} onChange={(e) => setDays(Math.max(1, Math.round(Number(toNumber(e.target.value)) || 1)))} suffix={t("daysUnit")} />
            </Field>
            <Field id="ct-warranty" label={t("warranty")}>
              <NumberInput defaultValue={warranty} onChange={(e) => setWarranty(Math.max(0, Math.round(Number(toNumber(e.target.value)) || 0)))} suffix={t("monthsUnit")} />
            </Field>
          </div>
          {plan && !plan.free && (
            <p className="flex gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-[13px]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {ts("allBusy", { service: tp(`kind_${draft.quote.service}`) })}
            </p>
          )}
          {plan?.suggestion && plan.suggestion.date !== start && (
            <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              <CalendarClock className="size-4 shrink-0 text-primary" />
              {ts("earliestHint", { date: fmt.date(plan.suggestion.date), team: plan.suggestion.team.name })}
              <Button type="button" size="sm" variant="soft" onClick={() => setStart(plan.suggestion!.date)}>
                {ts("applyDate")}
              </Button>
            </p>
          )}
        </section>

        <section className="@container grid gap-3 rounded-3xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-bold">{t("payments")}</p>
            <span className={cn("font-latin text-[13px] font-bold", Math.abs(sum - 100) < 0.01 ? "text-success" : "text-danger")}>{t("sum", { n: fmt.number(sum, 2) })}</span>
          </div>
          <ul className="grid gap-2">
            {rows.map((r, i) => (
              // narrow card: the payment's name (delete at the end of its label), then "when" + %; wide card: all in one row
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,6.5rem)] items-end gap-2 rounded-2xl bg-surface-sunken/50 p-3 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_6.5rem]">
                <Field
                  id={`pl-${i}`}
                  label={t("payment")}
                  className="col-span-2 @2xl:col-span-1"
                  action={
                    <Button variant="ghost" size="icon-sm" aria-label={t("removePayment")} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} disabled={rows.length === 1}>
                      <Trash2 />
                    </Button>
                  }
                >
                  <Input value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} />
                </Field>
                <Field id={`pe-${i}`} label={t("when")} className="col-span-2 @2xl:col-span-1">
                  <NativeSelect value={r.due_event} onChange={(e) => setRow(i, { due_event: e.target.value as DueEvent })}>
                    {EVENTS.map((e) => (
                      <option key={e} value={e}>
                        {t(`event_${e}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id={`pp-${i}`} label={t("percent")}>
                  <NumberInput value={r.text ?? (r.percent ?? "")} onChange={(e) => setPercent(i, e.target.value)} suffix="%" />
                </Field>
                <p className="self-center text-end font-latin text-[12px] text-muted-foreground tabular-nums @2xl:col-span-full @2xl:self-auto">{fmt.money(amounts[i] ?? 0)}</p>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRows((x) => [...x, { label: "", percent: null, due_event: "custom" }])}>
              <Plus /> {t("addPayment")}
            </Button>
            {remaining > 0 && (
              <>
                <span className="font-latin text-[13px] text-muted-foreground">{t("remaining", { n: fmt.number(remaining, 2) })}</span>
                <Button variant="secondary" size="sm" onClick={fillRemaining}>
                  {t("fillRemaining")}
                </Button>
              </>
            )}
          </div>
          {warn?.warn && (
            <p className="flex gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-[13px]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {t("warn75", { coverage: fmt.number(warn.coverage, 0), materials: fmt.money(draft.materialCost ?? 0) })}
            </p>
          )}
        </section>

        <Field id="ct-notes" label={t("notes")} hint={t("notesHint")}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>
      </div>

      <aside className="grid content-start gap-3 self-start rounded-3xl border-2 border-primary/30 bg-surface p-5 min-[1150px]:sticky min-[1150px]:top-24">
        <p className="text-[13px] text-muted-foreground">{t("total")}</p>
        <p className="font-latin text-[26px] font-extrabold tabular-nums">{fmt.money(draft.quote.total)}</p>
        <p className="text-[12px] text-muted-foreground">{t("fromQuote", { number: ltr(draft.quote.number), v: draft.quote.version })}</p>
        <Button
          loading={pending}
          disabled={Math.abs(sum - 100) >= 0.01 || rows.some((r) => !r.label.trim() || !r.percent)}
          onClick={() =>
            run(
              onSave &&
                (() =>
                  onSave({
                    ...(draft.contract ? { contract_id: draft.contract.id } : { quote_id: draft.quote.id }),
                    start_date: start,
                    duration_days: days,
                    warranty_months: warranty,
                    notes: notes.trim() || null,
                    payments: rows.map((r) => ({ label: r.label.trim(), percent: r.percent ?? 0, due_event: r.due_event })),
                  })),
              { onSuccess: (r) => r.ok && r.data && router.push(`${base}/contracts/${r.data.number}`) },
            )
          }
        >
          {draft.contract ? t("saveChanges") : t("create")}
        </Button>
        {Math.abs(sum - 100) >= 0.01 ? (
          <p className="text-[12px] text-danger">{t("sumMust100")}</p>
        ) : (
          rows.some((r) => !r.label.trim() || !r.percent) && <p className="text-[12px] text-danger">{t("emptyPayment")}</p>
        )}
      </aside>
    </div>
  );
}

/** A contract: terms, payments, the client page link and the client's acceptance. */
export function ContractView({
  detail,
  org,
  actions,
  addendaActions,
  termsSave,
  requestPayment,
  base = "",
}: {
  detail: ContractDetail;
  org: DocOrg & ContractOrg;
  actions?: {
    send: (i: Record<string, unknown>) => Promise<ActionResult<{ url: string }>>;
    revoke: (i: Record<string, unknown>) => Promise<ActionResult>;
    cancel: (i: Record<string, unknown>) => Promise<ActionResult>;
  };
  addendaActions?: AddendaActions;
  termsSave?: (i: { contract_id: string; terms: ContractTermsConfig }) => Promise<ActionResult>;
  /** ask the client for a payment no stage confirmation will request (quotes.manage or finance.manage) */
  requestPayment?: (i: { payment_id: string }) => Promise<ActionResult>;
  base?: string;
}) {
  const ts = useTranslations("schedule");
  const t = useTranslations("contract");
  const tq = useTranslations("quotes");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const [url, setUrl] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const { contract: c, client, link } = detail;
  const editable = detail.canManage && (c.status === "draft" || c.status === "sent");
  const first = detail.payments[0];
  const warn = detail.materialCost != null && first ? firstPaymentWarning(first.amount, detail.materialCost) : null;
  const phone = client.phone;
  const [today] = React.useState(() => detail.today ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }));
  // before acceptance the link carries the quote/contract; after it the client follows the project
  const linkState = portalLinkState(c.status, detail.warrantyEnd ?? null, today);
  const message = url ? t(linkState.message, { name: client.name, org: org.name, url }) : "";

  return (
    <div className="grid gap-6">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border bg-surface p-5">
        <div>
          <p className="flex flex-wrap items-center gap-2">
            <DocNo className="text-[18px] font-bold">{c.number}</DocNo>
            <Badge tone={TONE[c.status]}>{t(`status_${c.status}`)}</Badge>
            <Badge>{tq(`service_${c.service}`)}</Badge>
          </p>
          <p className="text-[13px] text-muted-foreground">
            <Link href={`${base}/clients/${client.number}`} className="hover:underline">
              {client.name}
            </Link>
            {" · "}
            <Link href={`${base}/quotations/${detail.quote.number}`} className="font-latin hover:underline">
              <DocNo>{detail.quote.number}</DocNo>
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href={`${base}/print/contracts/${c.number}`} target="_blank">
              <Printer /> {t("printPdf")}
            </Link>
          </Button>
          {c.status !== "cancelled" && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`${base}/schedule?contract=${c.number}${detail.bookTeam ? `&team=${detail.bookTeam}` : ""}`}>
                <CalendarDays /> {ts("bookTeam")}
              </Link>
            </Button>
          )}
          {c.status === "accepted" && detail.canViewProject && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`${base}/projects/${c.number}`}>
                <HardHat /> {t("openProject")}
              </Link>
            </Button>
          )}
          {c.status === "accepted" && detail.canViewProject && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`${base}/maintenance?contract=${c.number}`}>
                <Wrench /> {t("openMaintenance")}
                {(detail.openMaintenance ?? 0) > 0 && <Badge tone="warning">{detail.openMaintenance}</Badge>}
              </Link>
            </Button>
          )}
          {c.status === "accepted" && detail.canPurchase && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`${base}/purchases/new?project=${c.number}`}>
                <ShoppingCart /> {t("recordPurchase")}
              </Link>
            </Button>
          )}
          {editable && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`${base}/contracts/${c.number}/edit`}>
                <Pencil /> {t("edit")}
              </Link>
            </Button>
          )}
          {editable && (
            <Button variant="ghost" size="sm" loading={pending} onClick={() => run(actions && (() => actions.cancel({ id: c.id })))}>
              <XCircle /> {t("cancel")}
            </Button>
          )}
        </div>
      </section>

      {detail.options && (
        <section className="grid gap-2 rounded-3xl border border-border bg-surface p-5 text-[14px]">
          <p className="font-bold">{c.status === "accepted" ? t("optionChosen", { label: detail.options.find((o) => o.version === detail.quote.version)?.label ?? "" }) : t("optionsWaiting")}</p>
          <ul className="flex flex-wrap gap-2">
            {detail.options.map((o) => (
              <li key={o.version} className={cn("rounded-full border px-3 py-1 text-[13px]", o.version === detail.quote.version && c.status === "accepted" ? "border-primary bg-primary/10 font-bold" : "border-border")}>
                {o.label} · <span className="font-latin tabular-nums">{fmt.money(o.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.status === "accepted" && (
        <section className="grid gap-1 rounded-3xl border border-success/40 bg-success-soft/40 p-5 text-[14px]">
          <p className="flex items-center gap-2 font-bold text-success">
            <Check className="size-5" /> {t("acceptedTitle")}
          </p>
          <p>{t("acceptedBy", { name: c.accepted_name ?? "", date: c.accepted_at ? fmt.dateTime(c.accepted_at) : "" })}</p>
          <p className="text-[12px] text-muted-foreground">
            {t("acceptedEvidence", { ip: c.accepted_ip ?? "—" })} {c.signed && `· ${t("signed")}`}
          </p>
          <p className="truncate text-[11px] text-subtle-foreground" dir="ltr">
            {c.accepted_user_agent}
          </p>
        </section>
      )}

      {detail.canManage && c.status !== "cancelled" && (
        <section className="grid gap-3 rounded-3xl border-2 border-primary/30 bg-surface p-5">
          <p className="flex items-center gap-2 text-[15px] font-bold">
            <Link2 className="size-5" /> {t("clientPage")}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {link.active
              ? t("linkActive", { date: fmt.date(lastValidDay(link.expires_at!)), n: link.open_count })
              : t("linkNone")}
          </p>
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
                {phone && (
                  <Button asChild size="sm">
                    <a href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
                      <MessageCircle /> {t("sendWhatsapp")}
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {/* reissue any time (also after acceptance, e.g. a lost or expired link) — the database keeps it valid until the warranty ends; not once it has ended */}
            {linkState.warrantyEnded && detail.warrantyEnd && (
              <p className="text-[13px] text-muted-foreground" data-testid="link-warranty-ended">
                {t("linkWarrantyEnded", { date: fmt.date(detail.warrantyEnd) })}
              </p>
            )}
            {linkState.canIssue && (
              <Button
                size="sm"
                loading={pending}
                onClick={() =>
                  run(actions && (() => actions.send({ id: c.id })), {
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
                <Link2 /> {link.active ? t("renewLink") : t("createLink")}
              </Button>
            )}
            {link.active && (
              <Button size="sm" variant="ghost" loading={pending} onClick={() => run(actions && (() => actions.revoke({ id: c.id })), { onSuccess: () => setUrl(null) })}>
                <XCircle /> {t("revokeLink")}
              </Button>
            )}
          </div>
        </section>
      )}

      {warn?.warn && c.status !== "accepted" && (
        <p className="flex gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {t("warn75", { coverage: fmt.number(warn.coverage, 0), materials: fmt.money(detail.materialCost ?? 0) })}
        </p>
      )}

      {c.status === "accepted" && <PaymentRequests detail={detail} request={requestPayment} />}
      {(c.status === "accepted" || c.status === "sent") && <ClientMessages detail={detail} orgName={org.name} />}
      <AddendaSection detail={detail} actions={addendaActions} />
      <ReceiptsList items={detail.invoices ?? []} hrefFor={(n) => `${base}/invoices/${encodeURIComponent(n)}`} title={t("invoicesTitle")} hint={t("invoicesHint")} id="invoices-title" />
      <ReceiptsList items={detail.receipts ?? []} hrefFor={(n) => `/print/receipts/${encodeURIComponent(n)}`} newTab />
      {termsSave && detail.canManage && (c.status === "draft" || c.status === "sent") && (
        <ClausesPanel mode="contract" initial={detail.terms ?? {}} template={detail.templateTerms} save={(terms) => termsSave({ contract_id: c.id, terms })} />
      )}
      <ContractTerms
        terms={detail.terms}
        org={org}
        client={client}
        data={{
          number: c.number, date: c.created_at, quoteNumber: detail.quote.number, view: detail.quote.view ?? null, service: c.service, project_type: c.project_type, start_date: c.start_date, duration_days: c.duration_days,
          warranty_months: c.warranty_months, total: c.total, notes: c.notes, method: detail.quote.view?.method ?? "unit",
          payments: detail.payments, accepted: c.accepted_at ? { at: c.accepted_at, name: c.accepted_name ?? "" } : null,
        }}
      />
      {detail.quote.view && (
        <QuoteDocument
          org={org}
          number={detail.quote.number}
          version={detail.quote.version}
          date={detail.quote.date}
          validUntil={detail.quote.valid_until}
          client={client}
          view={detail.quote.view}
          notes={detail.quote.notes}
          warrantyMonths={c.warranty_months}
        />
      )}
    </div>
  );
}

/** Pending payments staff ask for (material supply, custom, or a stage that isn't on the project). */
function PaymentRequests({ detail, request }: { detail: ContractDetail; request?: (i: { payment_id: string }) => Promise<ActionResult> }) {
  const t = useTranslations("contract");
  const tf = useTranslations("finance");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const items = detail.payments.filter((p) => p.requestable && p.id);
  if (!items.length || !(detail.canManage || detail.canFinance)) return null;
  return (
    <section className="grid gap-3 rounded-3xl border border-border bg-surface p-5">
      <div>
        <p className="text-[15px] font-bold">{t("requestTitle")}</p>
        <p className="text-[12px] text-muted-foreground">{t("requestHint")}</p>
      </div>
      <ul className="grid gap-2">
        {items.map((p) => (
          <li key={p.seq} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-[13px]">
            <span className="min-w-0">
              {p.label} · <span className="font-latin tabular-nums">{fmt.money(p.amount)}</span>
            </span>
            <Button size="sm" variant="secondary" loading={pending} onClick={() => run(request && (() => request({ payment_id: p.id! })))}>
              <Send /> {tf("requestPayment")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Ready messages from the owner's own WhatsApp: payment requests, receipts, addenda awaiting acceptance. */
function ClientMessages({ detail, orgName }: { detail: ContractDetail; orgName: string }) {
  const t = useTranslations("wa");
  const { fmt } = useFormatter();
  const { contract: c, client } = detail;
  if (!client.phone) return null;
  const base = { name: client.name, contract: ltr(c.number), org: orgName };
  const items: { key: string; title: string; text: string; label: string }[] = [
    { key: "general", title: t("generalTitle"), text: t("general", { name: client.name, contract: ltr(c.number), org: orgName }), label: t("btnOpen") },
    // only what was asked for, and only what is left of it
    ...detail.payments
      .map((p) => ({ p, left: remainingAmount(p.amount, p.paid_amount) }))
      .filter(({ p, left }) => p.status === "requested" && left > 0)
      .map(({ p, left }) => ({
        key: `p${p.seq}`, title: `${p.label} · ${fmt.money(left)}`, label: t("btnRemind"),
        // late (7+ days since the request): the same reminder as /reports
        text: p.late_days ? t("payLate", { ...base, label: p.label, amount: fmt.money(left), days: p.late_days }) : t("payRequest", { ...base, label: p.label, amount: fmt.money(left) }),
      })),
    ...detail.addenda
      .filter((a) => a.status === "sent")
      .map((a) => ({ key: a.id, title: `${ltr(a.number)} · ${a.title}`, text: t("addendum", { ...base, number: ltr(a.number), title: a.title, amount: fmt.money(a.total) }), label: t("btnSend") })),
    ...detail.addenda
      .map((a) => ({ a, left: remainingAmount(a.total, a.paid_amount) }))
      .filter(({ a, left }) => a.status === "accepted" && a.payment_status === "requested" && left > 0)
      .map(({ a, left }) => {
        const label = `${ltr(a.number)} — ${a.title}`;
        return {
          key: `pay-${a.id}`, title: `${ltr(a.number)} · ${fmt.money(left)}`, label: t("btnRemind"),
          text: a.late_days ? t("payLate", { ...base, label, amount: fmt.money(left), days: a.late_days }) : t("payRequest", { ...base, label, amount: fmt.money(left) }),
        };
      }),
    ...(detail.receipts ?? [])
      .slice(-3)
      .reverse()
      .map((r) => ({ key: r.number, title: `${ltr(r.number)} · ${fmt.money(r.amount)}`, text: t("receipt", { ...base, amount: fmt.money(r.amount), label: r.label, number: ltr(r.number) }), label: t("btnSend") })),
  ];
  return (
    <section className="grid gap-3 rounded-3xl border border-border bg-surface p-5">
      <div>
        <p className="flex items-center gap-2 text-[15px] font-bold">
          <MessageCircle className="size-5" /> {t("sectionTitle")}
        </p>
        <p className="text-[12px] text-muted-foreground">{t("sectionHint")}</p>
      </div>
      <ul className="grid gap-2">
        {items.map((i) => (
          <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-[13px]">
            <span className="min-w-0 truncate">{i.title}</span>
            <WhatsAppButton phone={client.phone} text={i.text} label={i.label} />
          </li>
        ))}
      </ul>
    </section>
  );
}
