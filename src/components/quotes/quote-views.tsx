"use client";
import { DocNo } from "@/components/doc-no";
import { CheckCircle2, ClipboardList, Copy, FileSignature, FileText, Pencil, Printer, Send, ShieldAlert, XCircle } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { LinesTable } from "@/components/pricing/results";
import { useBuyText } from "./buy-text";
import { itemParts, needsFromLines } from "@/lib/quotes/materials";
import { QuoteDocument, type DocOrg } from "./quote-document";
import { QuoteOptionsPanel } from "./quote-options";
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
  };
  base?: string;
}) {
  const t = useTranslations("quotes");
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
              <Button asChild size="sm">
                <Link href={`${base}/contracts/new?quote=${quote.number}`}>
                  <FileSignature /> {t("createContract")}
                </Link>
              </Button>
            )
          )}
          {detail.canManage && quote.status !== "accepted" && !detail.contract && (
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
          {detail.canManage && (quote.status === "draft" || quote.status === "issued") && current && (
            <Button size="sm" loading={pending} onClick={() => run(actions && (() => actions.issue({ id: quote.id })))}>
              <Send /> {quote.status === "issued" ? t("reissue") : t("issue")}
            </Button>
          )}
        </div>
      </section>

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
