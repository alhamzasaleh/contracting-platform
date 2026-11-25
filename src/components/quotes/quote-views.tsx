"use client";
import { DocNo } from "@/components/doc-no";
import { Check, CheckCircle2, ClipboardList, Copy, FileSignature, FileText, Link2, MessageSquare, Pencil, Printer, Send, ShieldAlert, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { NumberInput, useActionRunner, useUnitText } from "@/components/forms/form-kit";
import { PricingView } from "@/components/pricing/pricing-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import type { QuoteDetail, QuoteListItem } from "@/lib/data/quotes";
import type { PricingContext, Quantities, Selection, ServiceKind } from "@/lib/pricing";
import type { QuoteStatus } from "@/lib/supabase/database.types";
import { toNumber } from "@/lib/validation/numbers";
import { cn, ltr } from "@/lib/utils";
import { lastValidDay } from "@/lib/contracts";
import { DECISION_TONE, portalWaKey } from "@/lib/portal-flow";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { LinesTable } from "@/components/pricing/results";
import { useBuyText } from "./buy-text";
import { itemParts, needsFromLines } from "@/lib/quotes/materials";
import { QuoteDocument, type DocOrg } from "./quote-document";
import { QuoteOptionsPanel } from "./quote-options";
import { DeleteRecord } from "@/components/forms/delete-record";
import { quoteDeleteBlock } from "@/lib/deletion";
import type { PastStats } from "@/lib/pricing/history";

const STATUS_TONE: Record<QuoteStatus, "neutral" | "warning" | "primary" | "success" | "danger"> = {
  draft: "neutral",
  pending_approval: "warning",
  issued: "primary",
  accepted: "success",
  rejected: "danger",
  expired: "neutral",
};

export function QuotesView({ quotes, base = "" }: { quotes: QuoteListItem[]; base?: string }) {
  const t = useTranslations("quotes");
  const { fmt } = useFormatter();
  if (!quotes.length) return <EmptyState icon={<FileText />} title={t("emptyTitle")} description={t("emptyBody")} />;
  return (
    <ul className="grid gap-2">
      {quotes.map((q) => (
        <li key={q.id}>
          <Link href={`${base}/quotations/${q.number}`} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 hover:border-primary/40">
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-bold">{q.client}</span>
                <Badge>{t(`service_${q.service}`)}</Badge>
                <Badge tone={STATUS_TONE[q.status]}>{t(`status_${q.status}`)}</Badge>
                {q.clientDecision && <Badge tone={DECISION_TONE[q.clientDecision]}>{t(`decision_${q.clientDecision}`)}</Badge>}
              </span>
              <span className="text-[12px] text-muted-foreground">
                <DocNo>{q.number}</DocNo> · {t("versionN", { n: q.version })} · {fmt.date(q.created_at)}
              </span>
            </span>
            {q.total != null && <span className="font-latin text-[16px] font-bold tabular-nums">{fmt.money(q.total)}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

type SaveVersion = (i: Record<string, unknown>) => Promise<ActionResult<{ number: string; status: string }>>;

/** New quote (or new version) — the pricing screen with the survey's quantities. */
export function QuoteEditorView({
  kind,
  quantities,
  gaps,
  survey,
  client,
  quote,
  initial,
  discount: initialDiscount,
  method: initialMethod,
  notes: initialNotes,
  ctx,
  templates,
  canSeeCrewCost,
  onSave,
  base = "",
  history,
}: {
  /** what past quotes of this service suggest (costs.view) */
  history?: PastStats | null;
  kind: ServiceKind;
  quantities: Quantities;
  gaps: string[];
  survey: { id: string; number: string; title: string | null; mode: "total" | "rooms" };
  client: { number: string; name: string };
  quote: { id: string; number: string } | null;
  initial: Selection | null;
  discount: number;
  method: "unit" | "lump";
  notes: string | null;
  ctx: PricingContext;
  templates: Partial<Record<ServiceKind, Partial<Selection>>>;
  canSeeCrewCost: boolean;
  onSave?: SaveVersion;
  base?: string;
}) {
  const unitText = useUnitText();
  const t = useTranslations("quotes");
  const ts = useTranslations("survey");
  const { fmt } = useFormatter();
  const router = useRouter();
  const { run, pending } = useActionRunner();
  const [discount, setDiscount] = React.useState(initialDiscount);
  const [method, setMethod] = React.useState(initialMethod);
  const [notes, setNotes] = React.useState(initialNotes ?? "");

  const rows: [string, number, string][] =
    kind === "gypsum"
      ? [[ts("board_normal"), quantities.ceilNormal, "m²"], [ts("board_moisture"), quantities.ceilMoisture, "m²"], [ts("board_fire"), quantities.ceilFire, "m²"], [ts("partitions"), quantities.partitions, "m²"], [ts("trough"), quantities.troughM, "m"], [ts("shadow"), quantities.shadowM, "m"]]
      : kind === "interior"
        ? [[ts("walls"), quantities.walls, "m²"], [ts("ceilings"), quantities.ceilings, "m²"], [ts("wet"), quantities.wet, "m²"], [ts("decorative"), quantities.decorative, "m²"], [ts("colours"), quantities.colours, ""]]
        : [[ts("facade"), quantities.facade, "m²"], [ts("colours"), quantities.extColours, ""]];

  const panel = (
    <section className="grid gap-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[14px] font-bold">{t("fromSurvey")}</p>
        <Link href={`${base}/clients/${client.number}/surveys/${survey.number}`} className="font-latin text-[12px] text-primary underline-offset-2 hover:underline">
          <DocNo>{survey.number}</DocNo>
        </Link>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {client.name}
        {survey.title && ` · ${survey.title}`} · {survey.mode === "rooms" ? ts("modeRooms") : ts("modeTotal")}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
        {rows
          .filter(([, v]) => v > 0)
          .map(([label, v, u]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-latin tabular-nums">
                {fmt.number(v, 1)} {unitText(u)}
              </dd>
            </div>
          ))}
      </dl>
      {gaps.length > 0 && <p className="text-[12px] text-danger">{ts(`gap_${gaps[0]}`)}</p>}
      <p className="text-[11px] text-subtle-foreground">{t("editQuantitiesInSurvey")}</p>
    </section>
  );

  return (
    <PricingView
      ctx={ctx}
      templates={templates}
      canManage={false}
      canSeeCrewCost={canSeeCrewCost}
      quote={{
        kind,
        quantities,
        initial,
        quantitiesPanel: panel,
        history: history ?? null,
        renderActions: (sel, outcome) => (
          <section className="grid gap-3 rounded-2xl border-2 border-primary/30 bg-surface p-4">
            <p className="text-[14px] font-bold">{quote ? t("newVersionOf", { number: quote.number }) : t("newQuote")}</p>
            <div className="field-row grid grid-cols-2 gap-3">
              <Field id="q-discount" label={t("discountPercent")} hint={t("discountHint")}>
                <NumberInput
                  id="q-discount"
                  defaultValue={discount || ""}
                  onChange={(e) => {
                    const v = toNumber(e.target.value);
                    setDiscount(typeof v === "number" ? Math.min(100, Math.max(0, v)) : 0);
                  }}
                  suffix="%"
                />
              </Field>
              <Field id="q-method" label={t("method")}>
                <div className="flex gap-1.5">
                  {(["unit", "lump"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={cn("h-11 flex-1 rounded-full border text-[13px]", method === m ? "border-primary bg-primary text-primary-foreground" : "border-border")}
                    >
                      {t(`method_${m}`)}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <Field id="q-notes" label={t("notes")} hint={t("notesHint")}>
              <Textarea id="q-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </Field>
            {outcome.problems.length > 0 && <p className="text-[12px] text-warning">{t("savedAsDraftNote")}</p>}
            <Button
              loading={pending}
              onClick={() =>
                run(
                  onSave &&
                    (() =>
                      onSave({
                        quote_id: quote?.id ?? null,
                        survey_id: survey.id,
                        selection: sel,
                        discount_percent: discount,
                        method,
                        notes: notes.trim() || null,
                      })),
                  { onSuccess: (r) => r.ok && r.data && router.push(`${base}/quotations/${r.data.number}`) },
                )
              }
            >
              {quote ? t("saveVersion") : t("saveQuote")}
            </Button>
          </section>
        ),
      }}
    />
  );
}

/** One quote: the client document, status and actions, and (for costs.view) the internal view. */
export function QuoteView({
  detail,
  org,
  warrantyMonths,
  actions,
  base = "",
}: {
  detail: QuoteDetail;
  org: DocOrg;
  warrantyMonths: number;
  actions?: {
    issue: (i: Record<string, unknown>) => Promise<ActionResult>;
    decide: (i: Record<string, unknown>) => Promise<ActionResult>;
    options?: (i: Record<string, unknown>) => Promise<ActionResult>;
    /** «إرسال للعميل»: the quote's client-page link (shown once) */
    send?: (i: Record<string, unknown>) => Promise<ActionResult<{ url: string }>>;
    revokeLink?: (i: Record<string, unknown>) => Promise<ActionResult>;
    /** owner only (detail.canDelete) */
    deleteQuote?: (i: Record<string, unknown>) => Promise<ActionResult>;
  };
  base?: string;
}) {
  const t = useTranslations("quotes");
  const td = useTranslations("deletion");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const { quote, client, current, internal, approvals } = detail;
  const open = approvals.filter((a) => a.status === "pending" && (a.details.version as number) === quote.version);
  const rejected = approvals.filter((a) => a.status === "rejected" && (a.details.version as number) === quote.version);
  const buyText = useBuyText();
  const needOf = React.useMemo(() => new Map(needsFromLines(internal?.lines ?? []).map((x) => [x.key, x])), [internal]);

  return (
    <div className="grid gap-6">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border bg-surface p-5">
        <div className="grid gap-1">
          <p className="flex flex-wrap items-center gap-2">
            <DocNo className="text-[18px] font-bold">{quote.number}</DocNo>
            <Badge tone={STATUS_TONE[quote.status]}>{t(`status_${quote.status}`)}</Badge>
            <Badge>{t(`service_${quote.service}`)}</Badge>
          </p>
          <p className="text-[13px] text-muted-foreground">
            <Link href={`${base}/clients/${client.number}`} className="hover:underline">
              {client.name}
            </Link>
            {" · "}
            {t("versionN", { n: quote.version })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {detail.contract ? (
            <Button asChild size="sm">
              <Link href={`${base}/contracts/${detail.contract.number}`}>
                <FileSignature /> {t("openContract", { number: detail.contract.number })}
              </Link>
            </Button>
          ) : (
            detail.canManage &&
            quote.status === "issued" && (
              <Button asChild size="sm" variant={detail.clientDecision?.decision === "accepted" ? "primary" : "secondary"}>
                <Link href={`${base}/contracts/new?quote=${quote.number}`}>
                  <FileSignature /> {t("createContract")}
                </Link>
              </Button>
            )
          )}
          {detail.canManage && quote.status !== "accepted" && !detail.contract && detail.clientDecision?.decision !== "accepted" && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`${base}/quotations/${quote.number}/edit`}>
                <Pencil /> {t("editNewVersion")}
              </Link>
            </Button>
          )}
          {current && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/print/quotations/${quote.number}`} target="_blank">
                <Printer /> {t("print")}
              </Link>
            </Button>
          )}
          {current && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`${base}/print/quotations/${quote.number}/materials`} target="_blank">
                <ClipboardList /> {t("materialsTable")}
              </Link>
            </Button>
          )}
          {detail.canManage && (quote.status === "draft" || quote.status === "issued" || quote.status === "rejected") && current && (
            <Button size="sm" loading={pending} onClick={() => run(actions && (() => actions.issue({ id: quote.id })))}>
              <Send /> {quote.status === "issued" || quote.status === "rejected" ? t("reissue") : t("issue")}
            </Button>
          )}
          {detail.canDelete && (
            <DeleteRecord
              label={td("deleteQuote")}
              title={td("quoteTitle", { number: ltr(quote.number) })}
              body={td("quoteBody", { versions: detail.versions.length })}
              block={quoteDeleteBlock({ hasContract: !!detail.anyContract || !!detail.contract, clientDecision: detail.clientDecision?.decision })}
              action={actions?.deleteQuote && (() => actions.deleteQuote!({ id: quote.id }))}
              to={client.number ? `${base}/clients/${client.number}` : `${base}/quotations`}
            />
          )}
        </div>
      </section>

      <ClientDecisionCard detail={detail} />
      {detail.canManage && quote.status === "issued" && !detail.contract && detail.link?.active && detail.clientDecision?.decision !== "accepted" && (
        <p className="flex items-start gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-[13px]" data-testid="contract-without-acceptance">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" /> {t("contractWithoutAcceptance")}
        </p>
      )}
      {detail.contract && detail.link?.onContract && (
        <p className="flex items-center gap-2 rounded-2xl bg-surface-sunken px-4 py-3 text-[13px]">
          <Link2 className="size-4 shrink-0" /> {t("linkOnContract", { number: ltr(detail.contract.number) })}
        </p>
      )}
      {detail.canManage && !detail.contract && <QuoteClientPage detail={detail} orgName={org.name} send={actions?.send} revoke={actions?.revokeLink} />}

      {(open.length > 0 || rejected.length > 0) && (
        <section className="grid gap-3 rounded-3xl border border-warning/40 bg-warning-soft/40 p-5">
          <p className="flex items-center gap-2 text-[15px] font-bold">
            <ShieldAlert className="size-5" /> {t("approvalNeeded")}
          </p>
          {[...open, ...rejected].map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3">
              <p className="text-[14px]">
                {a.kind === "quote_margin"
                  ? t("approvalMargin", { margin: fmt.number(Number(a.details.margin ?? 0), 1), min: fmt.number(Number(a.details.minMargin ?? 0), 0) })
                  : t("approvalDiscount", { percent: fmt.number(Number(a.details.discountPercent ?? 0), 1), amount: fmt.money(Number(a.details.discount ?? 0)) })}
                {a.status === "rejected" && <Badge tone="danger" className="ms-2">{t("rejected")}</Badge>}
              </p>
              {a.status === "pending" && detail.canDecide && (
                <div className="flex gap-2">
                  <Button size="sm" loading={pending} onClick={() => run(actions && (() => actions.decide({ id: a.id, decision: "approved", note: null })))}>
                    <CheckCircle2 /> {t("approve")}
                  </Button>
                  <Button size="sm" variant="secondary" loading={pending} onClick={() => run(actions && (() => actions.decide({ id: a.id, decision: "rejected", note: null })))}>
                    <XCircle /> {t("reject")}
                  </Button>
                </div>
              )}
            </div>
          ))}
          {rejected.length > 0 && <p className="text-[12px] text-muted-foreground">{t("rejectedHint")}</p>}
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div>
          {current ? (
            <QuoteDocument
              org={org}
              number={quote.number}
              version={current.version}
              date={current.created_at}
              validUntil={quote.valid_until}
              client={client}
              view={current.clientView}
              notes={current.notes}
              warrantyMonths={warrantyMonths}
            />
          ) : (
            <EmptyState icon={<FileText />} title={t("noVersion")} />
          )}
        </div>

        <aside className="grid content-start gap-4">
          {internal && (
            <section className="grid gap-2 rounded-2xl border border-border bg-surface p-4">
              <p className="text-[14px] font-bold">{t("internal")}</p>
              <dl className="grid gap-1 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t("cost")}</dt>
                  <dd className="font-latin tabular-nums">{fmt.money(internal.cost)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t("costWithContingency")}</dt>
                  <dd className="font-latin tabular-nums">{fmt.money(internal.costWithContingency)}</dd>
                </div>
                <div className="flex justify-between font-bold">
                  <dt>{t("margin")}</dt>
                  <dd className="font-latin tabular-nums">{fmt.number(internal.marginPercent, 1)}%</dd>
                </div>
              </dl>
            </section>
          )}
          {internal && internal.purchaseList.length > 0 && (
            <section className="grid gap-2 rounded-2xl border border-border bg-surface p-4">
              <p className="flex items-center justify-between gap-2 text-[14px] font-bold">
                {t("purchaseList")}
                {detail.contract?.status === "accepted" && detail.canPurchase ? (
                  <Link href={`${base}/purchases/new?project=${detail.contract.number}`} className="text-[13px] font-medium text-primary hover:underline">
                    {t("createPurchase")}
                  </Link>
                ) : (
                  <Copy className="size-4 text-muted-foreground" />
                )}
              </p>
              <Link href={`${base}/print/quotations/${quote.number}/materials`} target="_blank" className="flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
                <ClipboardList className="size-4" /> {t("materialsTable")}
              </Link>
              <ul className="grid gap-1.5 text-[13px]">
                {internal.purchaseList.map((p) => (
                  <li key={p.key} className="flex justify-between gap-2 border-b border-border pb-1.5 last:border-0">
                    <span className="min-w-0">
                      <span className="block truncate">{p.label}</span>
                      {p.colour && <span className="text-[11px] text-muted-foreground">{p.colour}</span>}
                    </span>
                    <span className="shrink-0 text-end tabular-nums">{buyText(itemParts(p, needOf.get(p.key)))}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <QuoteOptionsPanel detail={detail} save={actions?.options} preview={!actions} />
          <section className="grid gap-2 rounded-2xl border border-border bg-surface p-4">
            <p className="text-[14px] font-bold">{t("versions")}</p>
            <ul className="grid gap-1 text-[13px]">
              {detail.versions.map((v) => (
                <li key={v.version} className={cn("flex items-center justify-between", v.version === quote.version && "font-bold")}>
                  <span>
                    {t("versionN", { n: v.version })}
                    <span className="block text-[11px] font-normal text-muted-foreground">{fmt.date(v.created_at)}</span>
                  </span>
                  <span className="font-latin tabular-nums">{fmt.money(v.total)}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
      {internal && (
        <details className="rounded-2xl border border-border bg-surface p-4">
          <summary className="cursor-pointer text-[14px] font-bold">{t("pricedLines")}</summary>
          <div className="mt-3">
            <LinesTable lines={internal.lines} explain={() => []} />
          </div>
        </details>
      )}
    </div>
  );
}

/** The client's answer on his page: accepted (→ create the contract), changes requested (→ new version), declined. */
function ClientDecisionCard({ detail }: { detail: QuoteDetail }) {
  const t = useTranslations("quotes");
  const { fmt } = useFormatter();
  const d = detail.clientDecision;
  if (!d) return null;
  const label = d.version != null ? detail.options?.find((o) => o.version === d.version)?.label : undefined;
  const tone = d.decision === "accepted" ? "border-success/40 bg-success-soft/40" : d.decision === "rejected" ? "border-danger/40 bg-danger-soft/40" : "border-warning/40 bg-warning-soft/40";
  return (
    <section className={cn("grid gap-1.5 rounded-3xl border p-5 text-[14px]", tone)} data-testid="client-decision">
      <p className="flex items-center gap-2 font-bold">
        {d.decision === "accepted" ? <CheckCircle2 className="size-5 text-success" /> : d.decision === "rejected" ? <XCircle className="size-5 text-danger" /> : <MessageSquare className="size-5" />}
        {d.decision === "accepted"
          ? t("decisionAccepted", { name: d.name ?? "", date: fmt.dateTime(d.at) })
          : d.decision === "rejected"
            ? t("decisionRejected", { date: fmt.dateTime(d.at) })
            : t("decisionChanges", { date: fmt.dateTime(d.at) })}
      </p>
      {label && <p>{t("decisionAcceptedOption", { label })}</p>}
      {d.note && <p className="whitespace-pre-line">{d.decision === "rejected" ? t("decisionReason", { reason: d.note }) : d.note}</p>}
      {d.decision === "accepted" && !detail.contract && <p className="text-[13px] text-muted-foreground">{t("decisionAcceptedNext")}</p>}
      {d.decision === "changes_requested" && <p className="text-[13px] text-muted-foreground">{t("decisionChangesNext")}</p>}
      {d.ip && <p className="text-[12px] text-subtle-foreground">{t("decisionEvidence", { ip: d.ip })}</p>}
    </section>
  );
}

/**
 * «إرسال للعميل»: one client-page link for the quote, then (same link) the contract, project and
 * warranty. The address is shown once; afterwards WhatsApp reminders point to the earlier message.
 */
function QuoteClientPage({
  detail,
  orgName,
  send,
  revoke,
}: {
  detail: QuoteDetail;
  orgName: string;
  send?: (i: Record<string, unknown>) => Promise<ActionResult<{ url: string }>>;
  revoke?: (i: Record<string, unknown>) => Promise<ActionResult>;
}) {
  const t = useTranslations("quotes");
  const tw = useTranslations("wa");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const [url, setUrl] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const { quote, client } = detail;
  const link = detail.link ?? { active: false, expires_at: null, open_count: 0, last_opened_at: null, onContract: false };
  const issued = quote.status === "issued";
  const answered = detail.clientDecision?.decision === "accepted" || detail.clientDecision?.decision === "rejected";
  const text = tw(portalWaKey("quote", !!url), { name: client.name, org: orgName, url: url ?? "", number: ltr(quote.number) });
  return (
    <section className="grid gap-3 rounded-3xl border-2 border-primary/30 bg-surface p-5" data-testid="quote-client-page">
      <p className="flex items-center gap-2 text-[15px] font-bold">
        <Link2 className="size-5" /> {t("clientPageTitle")}
      </p>
      <p className="text-[13px] text-muted-foreground">{t("sendToClientHint")}</p>
      <p className="text-[13px]">{link.active ? t("linkActive", { date: fmt.date(lastValidDay(link.expires_at!)), n: link.open_count }) : t("linkNone")}</p>
      {!issued && !answered && <p className="text-[13px] text-warning">{t("sendNeedsIssue")}</p>}
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
            <WhatsAppButton phone={client.phone} text={text} label={t("sendWhatsapp")} variant="primary" />
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {issued && (
          <Button
            size="sm"
            loading={pending}
            variant={link.active ? "secondary" : "primary"}
            onClick={() =>
              run(send && (() => send({ id: quote.id })), {
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
            <Send /> {link.active ? t("newLink") : t("sendToClient")}
          </Button>
        )}
        {link.active && !url && issued && !answered && <WhatsAppButton phone={client.phone} text={text} label={t("remindWhatsapp")} />}
        {link.active && (
          <Button size="sm" variant="ghost" loading={pending} onClick={() => run(revoke && (() => revoke({ id: quote.id })), { onSuccess: () => setUrl(null) })}>
            <XCircle /> {t("revokeLink")}
          </Button>
        )}
      </div>
    </section>
  );
}
