"use client";
import { Check, Clock, Download, FileSignature, MessageSquare, PenLine, Printer, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { QuoteDocument } from "@/components/quotes/quote-document";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import { settle } from "@/lib/client/action";
import { useFailureText } from "@/lib/client/failure-text";
import { lastValidDay } from "@/lib/contracts";
import type { PortalQuoteData } from "@/lib/portal";
import { acceptInput, quoteStageState } from "@/lib/portal-flow";
import { Kpi, OptionsPicker, PortalHero, PortalTimeline } from "./portal-view";

type Act = (i: Record<string, unknown>) => Promise<ActionResult>;

/**
 * The client page on the quote (one link for every stage): the offer, and the client's answer —
 * accept (name, and the option when several are offered), ask for changes (a note), or decline
 * (optional reason). After acceptance we prepare the contract and it arrives on this same link.
 */
export function QuoteStageView({
  data,
  logoUrl,
  number,
  token,
  today: todayProp,
  onAccept,
  onRequestChanges,
  onReject,
}: {
  data: PortalQuoteData;
  logoUrl: string | null;
  number: string;
  token: string;
  /** Riyadh day (tests / preview); defaults to today */
  today?: string;
  onAccept?: Act;
  onRequestChanges?: Act;
  onReject?: Act;
}) {
  const t = useTranslations("portal");
  const tc = useTranslations("common");
  const tp = useTranslations("pricing");
  const { fmt } = useFormatter();
  const { org, quote: q } = data;
  const [today] = React.useState(() => todayProp ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }));
  const st = quoteStageState({ status: q.status, decision: q.decision, contract: data.contract, validUntil: q.valid_until, today });
  const options = data.options ?? [];
  const [chosen, setChosen] = React.useState<number | null>(null);
  const decided = options.find((o) => o.version === q.chosen_version) ?? null;
  const picked = options.find((o) => o.version === chosen) ?? null;
  // the page shows the chosen (or accepted) option; until the client picks, the first one
  const shown = picked ?? decided ?? options[0] ?? null;
  const view = shown ? shown.client_view : q.client_view;
  const total = shown ? shown.total : q.total;
  const current = st.state === "accepted" || st.state === "contract_draft" ? 1 : 0;

  return (
    <div className="min-h-dvh bg-background">
      <PortalHero org={org} logoUrl={logoUrl} clientName={data.client.name} intro={t("introQuote", { service: tp(`kind_${q.service}`) })} number={q.number} />
      <main className="relative z-10 mx-auto -mt-8 grid max-w-[880px] gap-6 px-4 pb-16 [&>*]:min-w-0">
        <PortalTimeline current={current} />

        {view && (
          <section className="grid gap-3 rounded-3xl border border-border bg-surface p-5 sm:grid-cols-3">
            <Kpi label={t("quoteTotal")} value={total == null ? "—" : fmt.money(total)} strong />
            <Kpi label={t("quoteValidUntil")} value={q.valid_until ? fmt.date(q.valid_until) : "—"} />
            <Kpi label={t("quoteVersion")} value={String(shown?.version ?? q.version ?? "—")} />
          </section>
        )}

        <StatusCard data={data} state={st.state} optionLabel={decided?.label ?? null} />

        {view && options.length > 0 && (st.canAccept || decided) && (
          <OptionsPicker options={options} chosen={st.canAccept ? chosen : (decided?.version ?? null)} onChoose={(v) => st.canAccept && setChosen(v)} />
        )}

        {st.canAnswer && view && (
          // read first, answer after: the reply sits under the quote; this jumps there
          <a href="#answer" className="justify-self-center rounded-full border border-primary/40 bg-surface px-4 py-2 text-[14px] font-semibold text-primary hover:bg-primary/5 print:hidden">
            {t("jumpToAnswer")}
          </a>
        )}


        {view && (shown?.version ?? q.version) != null && (
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[14px] font-semibold text-primary print:hidden">
            <a href={`/p/${encodeURIComponent(number)}/${token}/pdf/quote-${shown?.version ?? q.version}`} className="flex items-center gap-2 hover:underline">
              <Download className="size-4" /> {t("quotePdf")}
            </a>
            <a href={`/p/${encodeURIComponent(number)}/${token}/quote?v=${shown?.version ?? q.version}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:underline">
              <Printer className="size-4" /> {t("quotePrint")}
            </a>
          </div>
        )}
        {view && (
          <QuoteDocument
            org={{ name: org.name, legal_name: org.legal_name, cr_number: org.cr_number, vat_number: org.vat_number, phone: org.phone, city: org.city, logoUrl }}
            number={q.number}
            version={shown?.version ?? q.version ?? 0}
            date={shown?.date ?? q.date ?? ""}
            validUntil={q.valid_until}
            client={data.client}
            view={view}
            notes={shown ? shown.notes : q.notes}
            warrantyMonths={q.warranty_months}
          />
        )}
        {st.canAnswer && (
          <div id="answer" className="scroll-mt-4">
          <Answer
            data={data}
            number={number}
            token={token}
            canAccept={st.canAccept}
            picked={picked}
            shownVersion={shown?.version ?? q.version}
            needsOption={options.length > 0}
            onAccept={onAccept}
            onRequestChanges={onRequestChanges}
            onReject={onReject}
          />
          </div>
        )}
        <p className="text-center text-[12px] text-subtle-foreground">{t("footer", { date: fmt.date(lastValidDay(data.expires_at)) })}</p>
        <p className="text-center text-[12px] text-subtle-foreground">{tc("rights", { year: new Date().getFullYear(), name: org.legal_name ?? org.name })}</p>
      </main>
    </div>
  );
}

function StatusCard({ data, state, optionLabel }: { data: PortalQuoteData; state: ReturnType<typeof quoteStageState>["state"]; optionLabel: string | null }) {
  const t = useTranslations("portal");
  const { fmt } = useFormatter();
  const q = data.quote;
  if (state === "accepted" || state === "contract_draft") {
    return (
      <section className="grid gap-2 rounded-3xl border border-success/40 bg-success-soft/50 p-6 text-center">
        <FileSignature className="mx-auto size-10 text-success" />
        {q.decision === "accepted" && q.decided_at ? (
          <>
            <p className="text-[18px] font-bold">{t("quoteAcceptedTitle")}</p>
            <p className="text-[14px] text-muted-foreground">{t("quoteAcceptedBody", { name: q.decided_name ?? "", date: fmt.dateTime(q.decided_at) })}</p>
          </>
        ) : (
          <p className="text-[18px] font-bold">{t("quoteContractDraft")}</p>
        )}
        {optionLabel && <p className="text-[14px] font-bold">{t("quoteAcceptedOption", { label: optionLabel })}</p>}
      </section>
    );
  }
  if (state === "rejected") {
    return (
      <section className="grid gap-2 rounded-3xl border border-border bg-surface p-6 text-center">
        <X className="mx-auto size-10 text-muted-foreground" />
        <p className="text-[18px] font-bold">{t("quoteRejectedTitle")}</p>
        {q.decision_note && <p className="whitespace-pre-line text-[14px]">{t("quoteRejectedReason", { reason: q.decision_note })}</p>}
        <p className="text-[14px] text-muted-foreground">{t("quoteRejectedBody")}</p>
      </section>
    );
  }
  if (state === "revising") {
    return (
      <section className="flex items-start gap-3 rounded-3xl border border-border bg-surface p-5 text-[14px]">
        <Clock className="mt-0.5 size-5 shrink-0 text-primary" /> <p>{t("quoteRevising")}</p>
      </section>
    );
  }
  return (
    <>
      {q.decision === "changes_requested" && q.decided_at && (
        <section className="grid gap-2 rounded-3xl border border-warning/40 bg-warning-soft/40 p-5 text-[14px]">
          <p className="flex items-center gap-2 font-bold">
            <MessageSquare className="size-5" /> {t("quoteChangesTitle", { date: fmt.dateTime(q.decided_at) })}
          </p>
          {q.decision_note && <p className="whitespace-pre-line">{q.decision_note}</p>}
          <p className="text-muted-foreground">{t("quoteChangesWait")}</p>
        </section>
      )}
      {state === "expired" && (
        <section className="flex items-start gap-3 rounded-3xl border border-warning/40 bg-warning-soft/40 p-5 text-[14px]">
          <Clock className="mt-0.5 size-5 shrink-0" /> <p>{t("quoteExpired")}</p>
        </section>
      )}
    </>
  );
}

function Answer({
  data,
  number,
  token,
  canAccept,
  picked,
  shownVersion,
  needsOption,
  onAccept,
  onRequestChanges,
  onReject,
}: {
  data: PortalQuoteData;
  number: string;
  token: string;
  canAccept: boolean;
  picked: { version: number; label: string } | null;
  /** the version on screen — the one accepted (the database refuses it if the offer changed) */
  shownVersion: number | null;
  needsOption: boolean;
  onAccept?: Act;
  onRequestChanges?: Act;
  onReject?: Act;
}) {
  const t = useTranslations("portal");
  const failure = useFailureText({ clientPage: true });
  const router = useRouter();
  const [name, setName] = React.useState(data.client.name);
  const [agree, setAgree] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [panel, setPanel] = React.useState<"changes" | "reject" | null>(null);

  const message = (e?: string) =>
    failure(e ?? "") ??
    (e === "rateLimited" ? t("errRate")
      : e === "chooseOption" ? t("errChooseOption")
      : e === "quoteChanged" ? t("errQuoteChanged")
      : e === "quoteExpired" ? t("errQuoteExpired")
      : e === "alreadyDecided" ? t("errAlreadyDecided")
      : e === "quoteNotOpen" ? t("errQuoteNotOpen")
      : e === "invalid" ? t("errInvalid")
      : t("errGeneric"));

  const send = (act: Act | undefined, input: Record<string, unknown>) =>
    start(async () => {
      setError(null);
      if (!act) return setDone(true);
      const r = await settle(() => act({ number, token, ...input }));
      if (r.ok) {
        setDone(true);
        router.refresh();
      } else setError(message(r.error));
    });

  if (done) {
    return (
      <section className="grid gap-2 rounded-3xl border border-success/40 bg-success-soft/50 p-6 text-center">
        <Check className="mx-auto size-10 text-success" />
        <p className="text-[18px] font-bold">{t("quoteDone")}</p>
      </section>
    );
  }

  return (
    <section className="grid gap-4 rounded-3xl border-2 border-primary/40 bg-surface p-5">
      <div>
        <p className="flex items-center gap-2 text-[17px] font-bold">
          <PenLine className="size-5 text-primary" /> {t("quoteAnswerTitle")}
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">{t("quoteAnswerHint")}</p>
      </div>

      {canAccept && (
        <div className="grid gap-3">
          <p className="text-[13px] text-muted-foreground">{t("quoteAcceptHint")}</p>
          {needsOption &&
            (picked ? (
              <p className="text-[13px] font-bold">{t("chosenOption", { label: picked.label })}</p>
            ) : (
              // the options are above the quote (they change it): a link back up to them
              <a href="#options-title" className="text-[13px] font-bold text-primary underline">
                {t("chooseOption")}
              </a>
            ))}
          <Field id="qa-name" label={t("yourName")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          <label className="flex items-start gap-3 text-[14px]">
            <input type="checkbox" className="mt-1 size-5 accent-[var(--primary)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>{t("quoteAgree")}</span>
          </label>
          <Button
            size="lg"
            loading={pending}
            disabled={!agree || name.trim().length < 2 || (needsOption && !picked)}
            onClick={() => (needsOption && !picked ? setError(t("errChooseOption")) : send(onAccept, acceptInput({ name, shown: picked, quoteVersion: shownVersion })))}
          >
            <Check /> {picked ? t("quoteAcceptOption", { label: picked.label }) : t("quoteAcceptButton")}
          </Button>
        </div>
      )}

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button variant={panel === "changes" ? "soft" : "secondary"} aria-expanded={panel === "changes"} onClick={() => setPanel(panel === "changes" ? null : "changes")}>
          <MessageSquare /> {t("quoteChangesButton")}
        </Button>
        <Button variant="ghost" aria-expanded={panel === "reject"} onClick={() => setPanel(panel === "reject" ? null : "reject")}>
          <X /> {t("quoteRejectButton")}
        </Button>
      </div>

      {panel === "changes" && (
        <div className="grid gap-3 rounded-2xl border border-border p-4">
          <p className="text-[13px] text-muted-foreground">{t("quoteChangesHint")}</p>
          <Field id="qa-note" label={t("quoteChangesNote")}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={4} />
          </Field>
          <Button loading={pending} disabled={note.trim().length < 1} onClick={() => send(onRequestChanges, { note: note.trim() })}>
            <MessageSquare /> {t("quoteChangesSend")}
          </Button>
        </div>
      )}

      {panel === "reject" && (
        <div className="grid gap-3 rounded-2xl border border-border p-4">
          <Field id="qa-reason" label={`${t("quoteRejectReason")} (${t("optional")})`}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} rows={3} />
          </Field>
          <Button variant="secondary" loading={pending} onClick={() => send(onReject, { reason: reason.trim() || null })}>
            <X /> {t("quoteRejectSend")}
          </Button>
        </div>
      )}
    </section>
  );
}
