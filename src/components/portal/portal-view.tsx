"use client";
import { DocNo } from "@/components/doc-no";
import { ReceiptsList } from "@/components/finance/receipts-list";
import { WarrantySection } from "./warranty-section";
import { Camera, Check, CheckCircle2, Download, Eraser, MessageSquare, PenLine, Send, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { BrandLogo } from "@/components/brand-logo";
import { ContractTerms } from "@/components/contracts/contract-terms";
import { useFormatter } from "@/components/formatter-provider";
import { HandoverCertificate } from "@/components/projects/handover-certificate";
import { QuoteDocument, workItemLabel } from "@/components/quotes/quote-document";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import { shrinkImage } from "@/lib/client/image";
import { lastValidDay } from "@/lib/contracts";
import { portalStep } from "@/lib/execution";
import type { PortalData, PortalOption, PortalStage } from "@/lib/portal";
import { cn } from "@/lib/utils";
import { settle } from "@/lib/client/action";
import { useFailureText } from "@/lib/client/failure-text";

const STEPS = ["quote", "contract", "accepted", "work", "handover", "warranty"] as const;

/** Finger / mouse signature, exported as a small PNG data URL. */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const t = useTranslations("portal");
  const ref = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  const drawn = React.useRef(false);
  const [empty, setEmpty] = React.useState(true);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  return (
    <div className="grid gap-2">
      <canvas
        ref={ref}
        width={600}
        height={200}
        aria-label={t("signHere")}
        className="h-40 w-full touch-none rounded-2xl border-2 border-dashed border-border bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext("2d")!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext("2d")!;
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.strokeStyle = "#1c1917";
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          drawn.current = true;
          setEmpty(false);
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (drawn.current && ref.current) onChange(ref.current.toDataURL("image/png"));
        }}
      />
      <div className="flex items-center justify-between text-[12px] text-muted-foreground">
        <span>{empty ? t("signHint") : t("signed")}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:text-foreground"
          onClick={() => {
            const c = ref.current;
            c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
            drawn.current = false;
            setEmpty(true);
            onChange(null);
          }}
        >
          <Eraser className="size-3.5" /> {t("clear")}
        </button>
      </div>
    </div>
  );
}

export function PortalView({
  data,
  logoUrl,
  number,
  token,
  onAccept,
  onConfirmStage,
  onAddNote,
  onAcceptAddendum,
  onAddMaintenance,
  onConfirmMaintenance,
}: {
  data: PortalData;
  logoUrl: string | null;
  number: string;
  token: string;
  onAccept?: (i: Record<string, unknown>) => Promise<ActionResult>;
  onConfirmStage?: (i: Record<string, unknown>) => Promise<ActionResult>;
  onAddNote?: (fd: FormData) => Promise<ActionResult>;
  onAcceptAddendum?: (i: Record<string, unknown>) => Promise<ActionResult>;
  onAddMaintenance?: (fd: FormData) => Promise<ActionResult>;
  onConfirmMaintenance?: (i: Record<string, unknown>) => Promise<ActionResult>;
}) {
  const t = useTranslations("portal");
  const failure = useFailureText({ clientPage: true });
  const tc = useTranslations("common");
  const tp = useTranslations("pricing");
  const { fmt } = useFormatter();
  const router = useRouter();
  const [name, setName] = React.useState(data.client.name);
  const [agree, setAgree] = React.useState(false);
  const [signature, setSignature] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const { contract: base, org } = data;
  const options = data.options ?? [];
  const [chosen, setChosen] = React.useState<number | null>(null);
  const picked = options.find((o) => o.version === chosen) ?? null;
  // until the client picks, the page shows the first option; once picked, everything follows that option
  const shown = picked ?? options[0] ?? null;
  const c = shown ? { ...base, total: shown.total } : base;
  const payments = shown ? scalePayments(data.payments, shown.total) : data.payments;
  const quoteView = shown ? shown.client_view : data.quote.client_view;
  const accepted = done || c.status === "accepted";
  const ex = data.execution;
  // waiting for the client's signature: the acceptance box goes under the contract (read first, then sign)
  const awaitingAccept = !(ex && ex.stages.length > 0) && !accepted && c.status === "sent";
  const current = ex ? portalStep("accepted", ex.stages) : accepted ? 2 : 1;
  const finalStage = ex?.stages.find((x) => x.is_final && x.status === "confirmed");

  const accept = () =>
    start(async () => {
      setError(null);
      if (!onAccept) return setDone(true);
      if (options.length && !picked) return setError(t("errChooseOption"));
      const r = await settle(() => onAccept({ number, token, name: name.trim(), agree, signature, ...(picked ? { version: picked.version } : {}) }));
      if (r.ok) {
        setDone(true);
        router.refresh();
      } else setError(failure(r.error) ?? (r.error === "rateLimited" ? t("errRate") : r.error === "chooseOption" ? t("errChooseOption") : r.error === "invalid" ? t("errInvalid") : t("errGeneric")));
    });

  return (
    <div className="min-h-dvh bg-background">
      <PortalHero org={org} logoUrl={logoUrl} clientName={data.client.name} intro={t("intro", { service: tp(`kind_${c.service}`) })} number={c.number} />

      <main className="relative z-10 mx-auto -mt-8 grid max-w-[880px] gap-6 px-4 pb-16 [&>*]:min-w-0">
        <PortalTimeline current={current} />

        <section className="grid gap-3 rounded-3xl border border-border bg-surface p-5 sm:grid-cols-3">
          <Kpi label={t("total")} value={fmt.money(c.total)} strong />
          <Kpi label={t("start")} value={fmt.date(c.start_date)} />
          <Kpi label={t("duration")} value={t("days", { n: c.duration_days })} />
        </section>

        {finalStage && (
          <a href={`/p/${encodeURIComponent(c.number)}/${token}/pdf/handover`} className="flex items-center justify-center gap-2 text-[14px] font-semibold text-primary hover:underline print:hidden">
            <Download className="size-4" /> {t("handoverPdf")}
          </a>
        )}
        {finalStage && (
          <HandoverCertificate
            data={{
              org: { name: org.name, legal_name: org.legal_name, cr_number: org.cr_number, logoUrl },
              client: { name: data.client.name, id_number: data.client.id_number },
              contract: { number: c.number, service: c.service, warranty_months: c.warranty_months },
              final: { confirmed_at: finalStage.confirmed_at!, confirmed_name: finalStage.confirmed_name },
            }}
          />
        )}
        {(data.addenda ?? []).length > 0 && <Addenda list={data.addenda!} clientName={data.client.name} number={number} token={token} onAccept={onAcceptAddendum} />}
        {ex && ex.stages.length > 0 && <WorkProgress stages={ex.stages} clientName={data.client.name} number={number} token={token} onConfirm={onConfirmStage} />}
        {ex && <ClientNotes data={data} number={number} token={token} onAdd={onAddNote} />}

        {ex && ex.stages.length > 0 ? null : accepted ? (
          <section className="grid gap-2 rounded-3xl border border-success/40 bg-success-soft/50 p-6 text-center">
            <ShieldCheck className="mx-auto size-10 text-success" />
            <p className="text-[18px] font-bold">{t("thanks")}</p>
            <p className="text-[14px] text-muted-foreground">{t("thanksBody", { org: org.name })}</p>
          </section>
        ) : (
          c.status === "sent" && (
            <>
            {/* the option first: the contract text, payments and annex below follow it */}
            {options.length > 0 && <OptionsPicker options={options} chosen={chosen} onChoose={(v) => { setChosen(v); setError(null); }} />}
            {/* read first, sign after: the acceptance sits under the contract; this jumps there */}
            <a href="#accept" className="justify-self-center rounded-full border border-primary/40 bg-surface px-4 py-2 text-[14px] font-semibold text-primary hover:bg-primary/5 print:hidden">
              {t("jumpToAccept")}
            </a>
            </>
          )
        )}

        {data.warranty && <WarrantySection w={data.warranty} number={number} token={token} onAdd={onAddMaintenance} onConfirm={onConfirmMaintenance} />}

        <ReceiptsList items={data.receipts ?? []} hrefFor={(rv) => `/p/${encodeURIComponent(number)}/${token}/receipt/${encodeURIComponent(rv)}`} newTab />

        {!!data.invoiceDocs?.length && (
          <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="invoices-title">
            <h2 id="invoices-title" className="text-[18px] font-bold">{t("invoicesTitle")}</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">{t("invoicesHint")}</p>
            <ul className="mt-4 grid gap-2">
              {data.invoiceDocs.map((i) => (
                <li key={i.number} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-border px-4 py-3 text-[14px]">
                  <a href={`/p/${encodeURIComponent(number)}/${token}/bill/${encodeURIComponent(i.number)}`} target="_blank" rel="noopener noreferrer" className="min-w-0 hover:underline">
                    <DocNo>{i.number}</DocNo> <span className="text-muted-foreground">· {i.description}</span>
                  </a>
                  <span className="flex items-center gap-3">
                    <span className="font-bold">{fmt.money(i.total)}</span>
                    {i.has_official && (
                      <a href={`/p/${encodeURIComponent(number)}/${token}/invoice/${encodeURIComponent(i.official)}`} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-primary hover:underline">
                        {t("invoiceOfficial")}
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <a href={`/p/${encodeURIComponent(c.number)}/${token}/pdf/contract`} className="flex items-center justify-center gap-2 text-[14px] font-semibold text-primary hover:underline print:hidden">
          <Download className="size-4" /> {t("contractPdf")}
        </a>
        <ContractTerms
          terms={data.terms}
          org={org}
          client={data.client}
          data={{
            number: c.number, date: c.created_at ?? data.quote.date, quoteNumber: data.quote.number, view: quoteView ?? null, service: c.service, project_type: c.project_type, start_date: c.start_date, duration_days: c.duration_days,
            warranty_months: c.warranty_months, total: c.total, notes: c.notes, method: quoteView?.method ?? "unit",
            payments, accepted: c.accepted_at ? { at: c.accepted_at, name: c.accepted_name ?? "" } : null,
          }}
        />
        <QuoteDocument
          org={{ name: org.name, legal_name: org.legal_name, cr_number: org.cr_number, vat_number: org.vat_number, phone: org.phone, city: org.city, logoUrl }}
          number={data.quote.number}
          version={shown?.version ?? data.quote.version}
          date={shown?.date ?? data.quote.date}
          validUntil={data.quote.valid_until}
          client={data.client}
          view={quoteView}
          notes={shown ? shown.notes : data.quote.notes}
          warrantyMonths={c.warranty_months}
        />
        {awaitingAccept && (
          <div id="accept" className="grid scroll-mt-4 gap-6">

            <section className="grid gap-4 rounded-3xl border-2 border-primary/40 bg-surface p-5">
              <p className="flex items-center gap-2 text-[17px] font-bold">
                <PenLine className="size-5 text-primary" /> {t("acceptTitle")}
              </p>
              <p className="text-[13px] text-muted-foreground">{t("acceptHint")}</p>
              {options.length > 0 &&
                (picked ? (
                  <p className="text-[13px] font-bold">{t("chosenOption", { label: picked.label })}</p>
                ) : (
                  // the options are above the contract (they change it): a link back up to them
                  <a href="#options-title" className="text-[13px] font-bold text-primary underline">
                    {t("chooseOption")}
                  </a>
                ))}
              {data.quote.client_accepted_at && <p className="text-[13px] text-success">{t("quoteAcceptedOn", { date: fmt.dateTime(data.quote.client_accepted_at) })}</p>}
              <Field id="pa-name" label={t("yourName")}>
                <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </Field>
              <div className="grid gap-1.5">
                <p className="text-[13px] font-bold">
                  {t("signature")} <span className="font-normal text-muted-foreground">({t("optional")})</span>
                </p>
                <SignaturePad onChange={setSignature} />
              </div>
              <label className="flex items-start gap-3 text-[14px]">
                <input type="checkbox" className="mt-1 size-5 accent-[var(--primary)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>{t("agree")}</span>
              </label>
              {error && <p className="text-[13px] text-danger">{error}</p>}
              <Button size="lg" loading={pending} disabled={!agree || name.trim().length < 2 || (options.length > 0 && !picked)} onClick={accept}>
                <Check /> {picked ? t("acceptOption", { label: picked.label }) : t("acceptButton")}
              </Button>
            </section>
                      </div>
        )}
        <p className="text-center text-[12px] text-subtle-foreground">{t("footer", { date: fmt.date(lastValidDay(data.expires_at)) })}</p>
        <p className="text-center text-[12px] text-subtle-foreground">{tc("rights", { year: new Date().getFullYear(), name: org.legal_name ?? org.name })}</p>
      </main>
    </div>
  );
}

/** The page's header: logo, company, greeting, and what this page is about (quote or contract number). */
export function PortalHero({ org, logoUrl, clientName, intro, number }: { org: PortalData["org"]; logoUrl: string | null; clientName: string; intro: string; number: string }) {
  const t = useTranslations("portal");
  return (
    <header className="relative overflow-hidden bg-ink text-ink-foreground">
      <div className="mx-auto grid max-w-[880px] gap-6 px-5 pt-10 pb-14 text-gypsum sm:grid-cols-[auto_1fr] sm:items-end [&>*]:min-w-0">
        {logoUrl && <BrandLogo src={logoUrl} label={org.name} className="text-gypsum" fit="h-auto w-[min(160px,45vw)] max-h-20 sm:max-h-24" />}
        <div className="grid gap-1.5">
          <p className="text-[14px] opacity-75">{org.legal_name ?? org.name}</p>
          <h1 className="text-[28px] leading-tight font-extrabold sm:text-[34px]">{t("hello", { name: clientName })}</h1>
          <p className="text-[15px] opacity-85">
            {intro} · <DocNo>{number}</DocNo>
          </p>
        </div>
      </div>
    </header>
  );
}

/** Quote → contract → accepted → work → handover → warranty, with the current step highlighted. */
export function PortalTimeline({ current }: { current: number }) {
  const t = useTranslations("portal");
  return (
    <section className="rounded-3xl border border-border bg-surface p-5 shadow-sm">
      <ol className="grid grid-cols-3 gap-y-4 sm:grid-cols-6">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-col items-center gap-1.5 text-center">
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-full border-2 text-[13px] font-bold",
                i < current ? "border-clay bg-clay text-gypsum" : i === current ? "border-clay text-primary" : "border-border text-subtle-foreground",
              )}
            >
              {i < current ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={cn("text-[12px]", i <= current ? "font-bold" : "text-muted-foreground")}>{t(`step_${s}`)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Kpi({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={cn("font-latin tabular-nums", strong ? "text-[22px] font-extrabold" : "text-[16px] font-bold")}>{value}</p>
    </div>
  );
}

function StageBar({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
    </div>
  );
}

/** Stages as they progress; the client confirms each stage it was sent (final = signature). */
function WorkProgress({ stages, clientName, number, token, onConfirm }: { stages: PortalStage[]; clientName: string; number: string; token: string; onConfirm?: (i: Record<string, unknown>) => Promise<ActionResult> }) {
  const t = useTranslations("portal");
  const { fmt } = useFormatter();
  return (
    <section className="grid gap-3 rounded-3xl border border-border bg-surface p-5">
      <p className="text-[17px] font-bold">{t("workTitle")}</p>
      <ol className="grid gap-3">
        {stages.map((s) => (
          <li key={s.id} className={cn("grid gap-2 rounded-2xl p-4", s.status === "awaiting_client" ? "border-2 border-primary/50" : "bg-surface-sunken/50")}>
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 font-bold">
                {s.status === "confirmed" ? <CheckCircle2 className="size-5 text-success" /> : <span className="flex size-6 items-center justify-center rounded-full bg-surface text-[12px]">{s.seq}</span>}
                {s.name}
              </p>
              <span className="font-latin text-[13px] font-bold tabular-nums">{s.status === "confirmed" ? 100 : s.progress}%</span>
            </div>
            <StageBar value={s.status === "confirmed" ? 100 : s.progress} />
            {s.report && <p className="whitespace-pre-line text-[14px] leading-7">{s.report}</p>}
            {s.photos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {s.photos.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" className="size-20 rounded-xl object-cover" />
                  </a>
                ))}
              </div>
            )}
            {s.status === "confirmed" && s.confirmed_at && <p className="text-[12px] text-success">{t("stageConfirmed", { name: s.confirmed_name ?? "", date: fmt.dateTime(s.confirmed_at) })}</p>}
            {s.status === "awaiting_client" && <ConfirmStage stage={s} clientName={clientName} number={number} token={token} onConfirm={onConfirm} />}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ConfirmStage({ stage, clientName, number, token, onConfirm }: { stage: PortalStage; clientName: string; number: string; token: string; onConfirm?: (i: Record<string, unknown>) => Promise<ActionResult> }) {
  const t = useTranslations("portal");
  const failure = useFailureText({ clientPage: true });
  const router = useRouter();
  const [name, setName] = React.useState(clientName);
  const [signature, setSignature] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const needSig = stage.is_final;
  return (
    <div className="grid gap-3 border-t border-border pt-3">
      <p className="text-[13px] text-muted-foreground">{needSig ? t("finalHint") : t("confirmHint")}</p>
      <Field id={`cs-${stage.id}`} label={t("yourName")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </Field>
      {needSig && <SignaturePad onChange={setSignature} />}
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <Button
        loading={pending}
        disabled={name.trim().length < 2 || (needSig && !signature)}
        onClick={() =>
          start(async () => {
            setError(null);
            if (!onConfirm) return;
            const r = await settle(() => onConfirm({ number, token, stage_id: stage.id, name: name.trim(), signature: needSig ? signature : null }));
            if (r.ok) router.refresh();
            else setError(failure(r.error) ?? (r.error === "rateLimited" ? t("errRate") : t("errGeneric")));
          })
        }
      >
        <Check /> {needSig ? t("signHandover") : t("confirmStage")}
      </Button>
    </div>
  );
}

/** The client's notes (with photos) during the work; the team's reply appears under each. */
function ClientNotes({ data, number, token, onAdd }: { data: PortalData; number: string; token: string; onAdd?: (fd: FormData) => Promise<ActionResult> }) {
  const t = useTranslations("portal");
  const failure = useFailureText({ clientPage: true });
  const { fmt } = useFormatter();
  const router = useRouter();
  const ex = data.execution!;
  const [body, setBody] = React.useState("");
  const [stage, setStage] = React.useState("");
  const [files, setFiles] = React.useState<{ file: File; preview: string }[]>([]);
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const picker = React.useRef<HTMLInputElement>(null);
  const add = async (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of [...list].slice(0, 6 - files.length)) {
      const small = await shrinkImage(f, 1600);
      if (small.type === "image/jpeg") next.push({ file: small, preview: URL.createObjectURL(small) });
    }
    setFiles(next);
  };
  return (
    <section className="grid gap-3 rounded-3xl border border-border bg-surface p-5">
      <p className="flex items-center gap-2 text-[17px] font-bold">
        <MessageSquare className="size-5 text-primary" /> {t("notesTitle")}
      </p>
      <p className="text-[13px] text-muted-foreground">{t("notesHint")}</p>
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} aria-label={t("notesTitle")} />
      {ex.stages.length > 0 && (
        <select value={stage} onChange={(e) => setStage(e.target.value)} className="h-11 rounded-xl border border-border bg-surface px-3 text-[14px]" aria-label={t("noteStage")}>
          <option value="">{t("noteGeneral")}</option>
          {ex.stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={files.length >= 6} onClick={() => picker.current?.click()}>
          <Camera /> {t("addPhoto")}
        </Button>
        <input ref={picker} type="file" accept="image/*" multiple className="hidden" onChange={(e) => add(e.target.files)} />
        {files.map((f, i) => (
          <span key={f.preview} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.preview} alt="" className="size-14 rounded-xl object-cover" />
            <button type="button" aria-label={t("removePhoto")} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} className="absolute -end-1 -top-1 rounded-full bg-ink p-0.5 text-ink-foreground">
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      {msg && <p className={cn("text-[13px]", msg.ok ? "text-success" : "text-danger")}>{msg.text}</p>}
      <Button
        className="justify-self-start"
        loading={pending}
        disabled={!body.trim()}
        onClick={() =>
          start(async () => {
            setMsg(null);
            if (!onAdd) return;
            const fd = new FormData();
            fd.set("number", number);
            fd.set("token", token);
            fd.set("body", body.trim());
            if (stage) fd.set("stage_id", stage);
            files.forEach((f) => fd.append("photos", f.file));
            const r = await settle(() => onAdd(fd));
            if (r.ok) {
              setBody("");
              setFiles([]);
              setMsg({ ok: true, text: t("noteSent") });
              router.refresh();
            } else setMsg({ ok: false, text: failure(r.error) ?? (r.error === "rateLimited" ? t("errRate") : t("errGeneric")) });
          })
        }
      >
        <Send /> {t("sendNote")}
      </Button>
      {ex.notes.length > 0 && (
        <ul className="grid gap-2 border-t border-border pt-3">
          {ex.notes.map((n) => (
            <li key={n.id} className="grid gap-1.5 rounded-2xl bg-surface-sunken/50 p-3 text-[13px]">
              <p className="text-[12px] text-muted-foreground">{fmt.dateTime(n.created_at)}</p>
              <p className="whitespace-pre-line">{n.body}</p>
              {n.photos.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {n.photos.map((u) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={u} src={u} alt="" className="size-14 rounded-xl object-cover" />
                  ))}
                </div>
              )}
              {n.reply && <p className="rounded-xl bg-surface px-3 py-2">↳ {n.reply}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** §3.8 additional works: each addendum is accepted separately (with its own payment and extra days). */
function Addenda({ list, clientName, number, token, onAccept }: { list: NonNullable<PortalData["addenda"]>; clientName: string; number: string; token: string; onAccept?: (i: Record<string, unknown>) => Promise<ActionResult> }) {
  const t = useTranslations("portal");
  const { fmt } = useFormatter();
  return (
    <section className="grid gap-3 rounded-3xl border border-border bg-surface p-5">
      <p className="text-[17px] font-bold">{t("addendaTitle")}</p>
      {list.map((a) => (
        <article key={a.id} className={cn("grid gap-2 rounded-2xl p-4", a.status === "sent" ? "border-2 border-primary/50" : "bg-surface-sunken/50")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold">
              <DocNo>{a.number}</DocNo> · {a.title}
            </p>
            <p className="font-latin font-extrabold tabular-nums">{fmt.money(a.total)}</p>
          </div>
          <p className="whitespace-pre-line text-[14px] leading-7">{a.description}</p>
          <p className="text-[13px] text-muted-foreground">
            {a.vat > 0 ? t("addendumVat", { amount: fmt.money(a.amount), vat: fmt.money(a.vat) }) : t("addendumNoVat")} · {t("addendumDays", { n: a.extra_days })}
          </p>
          {a.status === "accepted" ? (
            <p className="text-[12px] text-success">{t("addendumAccepted", { name: a.accepted_name ?? "", date: fmt.dateTime(a.accepted_at!) })}</p>
          ) : (
            <AcceptAddendum id={a.id} clientName={clientName} number={number} token={token} onAccept={onAccept} />
          )}
        </article>
      ))}
    </section>
  );
}

function AcceptAddendum({ id, clientName, number, token, onAccept }: { id: string; clientName: string; number: string; token: string; onAccept?: (i: Record<string, unknown>) => Promise<ActionResult> }) {
  const t = useTranslations("portal");
  const failure = useFailureText({ clientPage: true });
  const router = useRouter();
  const [name, setName] = React.useState(clientName);
  const [agree, setAgree] = React.useState(false);
  const [signature, setSignature] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="grid gap-3 border-t border-border pt-3">
      <p className="text-[13px] text-muted-foreground">{t("addendumHint")}</p>
      <Field id={`ad-${id}`} label={t("yourName")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </Field>
      <SignaturePad onChange={setSignature} />
      <label className="flex items-start gap-3 text-[14px]">
        <input type="checkbox" className="mt-1 size-5 accent-[var(--primary)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>{t("addendumAgree")}</span>
      </label>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <Button
        loading={pending}
        disabled={!agree || name.trim().length < 2}
        onClick={() =>
          start(async () => {
            setError(null);
            if (!onAccept) return;
            const r = await settle(() => onAccept({ number, token, addendum_id: id, name: name.trim(), agree, signature }));
            if (r.ok) router.refresh();
            else setError(failure(r.error) ?? (r.error === "rateLimited" ? t("errRate") : t("errGeneric")));
          })
        }
      >
        <Check /> {t("acceptAddendum")}
      </Button>
    </div>
  );
}

/** The agreed percentages applied to the chosen option's total (the last payment absorbs rounding) — the database does the same on acceptance. */
function scalePayments(list: PortalData["payments"], total: number): PortalData["payments"] {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const last = list.length ? Math.max(...list.map((p) => p.seq)) : 0;
  const others = list.filter((p) => p.seq !== last).reduce((s, p) => s + r2((total * p.percent) / 100), 0);
  return list.map((p) => ({ ...p, amount: p.seq === last ? r2(total - others) : r2((total * p.percent) / 100) }));
}

/** 2–3 options side by side; the client taps one, then accepts. */
export function OptionsPicker({ options, chosen, onChoose }: { options: PortalOption[]; chosen: number | null; onChoose: (v: number) => void }) {
  const t = useTranslations("portal");
  const td = useTranslations("doc");
  const { fmt } = useFormatter();
  const cheapest = Math.min(...options.map((o) => o.total));
  return (
    <section className="grid gap-4 rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="options-title">
      <div>
        <h2 id="options-title" className="text-[18px] font-bold">{t("optionsTitle")}</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">{t("optionsHint")}</p>
      </div>
      <div role="radiogroup" aria-labelledby="options-title" className={cn("grid gap-3", options.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {options.map((o) => {
          const on = chosen === o.version;
          const brands = [...new Set(o.client_view.included.map((i) => i.brand).filter(Boolean))] as string[];
          return (
            <button
              key={o.version}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChoose(o.version)}
              className={cn(
                "grid min-h-32 content-start gap-2 rounded-2xl border-2 p-4 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[17px] font-bold">{o.label}</span>
                <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border-2", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                  {on && <Check className="size-4" />}
                </span>
              </span>
              <span className="font-latin text-[22px] font-extrabold tabular-nums">{fmt.money(o.total)}</span>
              {o.vat > 0 && <span className="text-[12px] text-muted-foreground">{t("optionVatIncluded")}</span>}
              {o.total === cheapest && options.length > 1 && <span className="w-fit rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] font-semibold">{t("optionLowest")}</span>}
              {brands.length > 0 && <span className="text-[13px] text-muted-foreground">{brands.join(" · ")}</span>}
              {o.client_view.method === "unit" && o.client_view.workTypes.length > 0 && (
                <span className="grid gap-0.5 text-[12px] text-muted-foreground">
                  {o.client_view.workTypes.map((w) => (
                    <span key={w.workType} className="flex justify-between gap-2">
                      <span>{workItemLabel(td, o.client_view.service, w.workType)}</span>
                      <span className="font-latin tabular-nums">{t("perM2", { price: fmt.money(w.pricePerM2) })}</span>
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
