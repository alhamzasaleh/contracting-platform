"use client";
import { AlertTriangle, CalendarClock, CalendarDays, Check, Copy, FileSignature, Link2, MessageCircle, Pencil, Plus, Trash2, XCircle } from "lucide-react";
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
import { capPercent, firstPaymentWarning, percentSum, scheduleAmounts, type DueEvent } from "@/lib/contracts";
import type { ContractDetail, ContractDraft, ContractListItem } from "@/lib/data/contracts";
import type { ContractStatus } from "@/lib/supabase/database.types";
import { toNumber } from "@/lib/validation/numbers";
import { anyTeamFree, spanOf, suggestStart, type Entry, type TeamInfo } from "@/lib/schedule";
import { cn } from "@/lib/utils";
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
                <span className="font-latin">{c.number}</span> · {t("startsOn", { date: fmt.date(c.start_date) })}
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
      free: anyTeamFree(busy.teams, busy.entries, draft.quote.service, spanOf(start, days), exclude),
      suggestion: suggestStart(busy.teams, busy.entries, draft.quote.service, today, days, exclude),
    };
  }, [busy, start, days, today, draft.contract, draft.quote.service]);
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
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="grid content-start gap-5">
        <section className="grid gap-4 rounded-3xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[15px] font-bold">
              {draft.client.name} · {tp(`kind_${draft.quote.service}`)}
            </p>
            <Badge>{tp(`pt_${draft.quote.projectType}`)}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field id="ct-start" label={t("start")}>
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

        <section className="grid gap-3 rounded-3xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-bold">{t("payments")}</p>
            <span className={cn("font-latin text-[13px] font-bold", Math.abs(sum - 100) < 0.01 ? "text-success" : "text-danger")}>{t("sum", { n: fmt.number(sum, 2) })}</span>
          </div>
          <ul className="grid gap-2">
            {rows.map((r, i) => (
              <li key={i} className="grid grid-cols-[1fr_96px_auto] items-end gap-2 rounded-2xl bg-surface-sunken/50 p-3 sm:grid-cols-[1fr_160px_96px_auto]">
                <Field id={`pl-${i}`} label={t("payment")}>
                  <Input value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} />
                </Field>
                <Field id={`pe-${i}`} label={t("when")} className="hidden sm:grid">
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
                <Button variant="ghost" size="icon-sm" aria-label={t("removePayment")} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} disabled={rows.length === 1}>
                  <Trash2 />
                </Button>
                <p className="col-span-full text-end font-latin text-[12px] text-muted-foreground tabular-nums">{fmt.money(amounts[i] ?? 0)}</p>
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

      <aside className="grid content-start gap-3 rounded-3xl border-2 border-primary/30 bg-surface p-5">
        <p className="text-[13px] text-muted-foreground">{t("total")}</p>
        <p className="font-latin text-[26px] font-extrabold tabular-nums">{fmt.money(draft.quote.total)}</p>
        <p className="text-[12px] text-muted-foreground">{t("fromQuote", { number: draft.quote.number, v: draft.quote.version })}</p>
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
  base = "",
}: {
  detail: ContractDetail;
  org: DocOrg & ContractOrg;
  actions?: {
    send: (i: Record<string, unknown>) => Promise<ActionResult<{ url: string }>>;
    revoke: (i: Record<string, unknown>) => Promise<ActionResult>;
    cancel: (i: Record<string, unknown>) => Promise<ActionResult>;
  };
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
  const message = url ? t("waMessage", { name: client.name, org: org.name, url }) : "";

  return (
    <div className="grid gap-6">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border bg-surface p-5">
        <div>
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-latin text-[18px] font-bold">{c.number}</span>
            <Badge tone={TONE[c.status]}>{t(`status_${c.status}`)}</Badge>
            <Badge>{tq(`service_${c.service}`)}</Badge>
          </p>
          <p className="text-[13px] text-muted-foreground">
            <Link href={`${base}/clients/${client.number}`} className="hover:underline">
              {client.name}
            </Link>
            {" · "}
            <Link href={`${base}/quotations/${detail.quote.number}`} className="font-latin hover:underline">
              {detail.quote.number}
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.status !== "cancelled" && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`${base}/schedule?contract=${c.number}`}>
                <CalendarDays /> {ts("bookTeam")}
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
              ? t("linkActive", { date: fmt.date(link.expires_at!), n: link.open_count })
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
            {c.status !== "accepted" || link.active ? (
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
            ) : null}
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

      <ContractTerms
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
