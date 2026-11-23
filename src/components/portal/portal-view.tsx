"use client";
import { Check, Eraser, PenLine, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { ContractTerms } from "@/components/contracts/contract-terms";
import { useFormatter } from "@/components/formatter-provider";
import { QuoteDocument } from "@/components/quotes/quote-document";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import type { PortalData } from "@/lib/portal";
import { cn } from "@/lib/utils";

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
}: {
  data: PortalData;
  logoUrl: string | null;
  number: string;
  token: string;
  onAccept?: (i: Record<string, unknown>) => Promise<ActionResult>;
}) {
  const t = useTranslations("portal");
  const tp = useTranslations("pricing");
  const { fmt } = useFormatter();
  const router = useRouter();
  const [name, setName] = React.useState(data.client.name);
  const [agree, setAgree] = React.useState(false);
  const [signature, setSignature] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const { contract: c, org } = data;
  const accepted = done || c.status === "accepted";
  const current = accepted ? 2 : 1;

  const accept = () =>
    start(async () => {
      setError(null);
      if (!onAccept) return setDone(true);
      const r = await onAccept({ number, token, name: name.trim(), agree, signature });
      if (r.ok) {
        setDone(true);
        router.refresh();
      } else setError(r.error === "rateLimited" ? t("errRate") : r.error === "invalid" ? t("errInvalid") : t("errGeneric"));
    });

  return (
    <div className="min-h-dvh bg-background">
      {/* Hero with the arch motif */}
      <header className="relative overflow-hidden bg-ink text-ink-foreground">
        <div className="mx-auto grid max-w-[880px] gap-6 px-5 pt-10 pb-14 sm:grid-cols-[auto_1fr] sm:items-end [&>*]:min-w-0">
          <div className="flex size-24 items-end justify-center overflow-hidden rounded-t-full border-2 border-white/20 bg-white/10 p-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="max-h-16 w-auto object-contain" />
            ) : (
              <span className="text-[36px] font-extrabold">{org.name.slice(0, 1)}</span>
            )}
          </div>
          <div className="grid gap-1.5">
            <p className="text-[14px] opacity-75">{org.legal_name ?? org.name}</p>
            <h1 className="text-[28px] leading-tight font-extrabold sm:text-[34px]">{t("hello", { name: data.client.name })}</h1>
            <p className="text-[15px] opacity-85">
              {t("intro", { service: tp(`kind_${c.service}`) })} · <span className="font-latin">{c.number}</span>
            </p>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto -mt-8 grid max-w-[880px] gap-6 px-4 pb-16 [&>*]:min-w-0">
        {/* Timeline */}
        <section className="rounded-3xl border border-border bg-surface p-5 shadow-sm">
          <ol className="grid grid-cols-3 gap-y-4 sm:grid-cols-6">
            {STEPS.map((s, i) => (
              <li key={s} className="flex flex-col items-center gap-1.5 text-center">
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full border-2 text-[13px] font-bold",
                    i < current ? "border-primary bg-primary text-primary-foreground" : i === current ? "border-primary text-primary" : "border-border text-subtle-foreground",
                  )}
                >
                  {i < current ? <Check className="size-4" /> : i + 1}
                </span>
                <span className={cn("text-[12px]", i <= current ? "font-bold" : "text-muted-foreground")}>{t(`step_${s}`)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-3 rounded-3xl border border-border bg-surface p-5 sm:grid-cols-3">
          <Kpi label={t("total")} value={fmt.money(c.total)} strong />
          <Kpi label={t("start")} value={fmt.date(c.start_date)} />
          <Kpi label={t("duration")} value={t("days", { n: c.duration_days })} />
        </section>

        {accepted ? (
          <section className="grid gap-2 rounded-3xl border border-success/40 bg-success-soft/50 p-6 text-center">
            <ShieldCheck className="mx-auto size-10 text-success" />
            <p className="text-[18px] font-bold">{t("thanks")}</p>
            <p className="text-[14px] text-muted-foreground">{t("thanksBody", { org: org.name })}</p>
          </section>
        ) : (
          c.status === "sent" && (
            <section className="grid gap-4 rounded-3xl border-2 border-primary/40 bg-surface p-5">
              <p className="flex items-center gap-2 text-[17px] font-bold">
                <PenLine className="size-5 text-primary" /> {t("acceptTitle")}
              </p>
              <p className="text-[13px] text-muted-foreground">{t("acceptHint")}</p>
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
              <Button size="lg" loading={pending} disabled={!agree || name.trim().length < 2} onClick={accept}>
                <Check /> {t("acceptButton")}
              </Button>
            </section>
          )
        )}

        <ContractTerms
          orgName={org.legal_name ?? org.name}
          clientName={data.client.name}
          data={{
            number: c.number, service: c.service, project_type: c.project_type, start_date: c.start_date, duration_days: c.duration_days,
            warranty_months: c.warranty_months, total: c.total, notes: c.notes, method: data.quote.client_view?.method ?? "unit",
            payments: data.payments, accepted: c.accepted_at ? { at: c.accepted_at, name: c.accepted_name ?? "" } : null,
          }}
        />
        <QuoteDocument
          org={{ name: org.name, legal_name: org.legal_name, cr_number: org.cr_number, vat_number: org.vat_number, phone: org.phone, city: org.city, logoUrl }}
          number={data.quote.number}
          version={data.quote.version}
          date={data.quote.date}
          validUntil={data.quote.valid_until}
          client={data.client}
          view={data.quote.client_view}
          notes={data.quote.notes}
          warrantyMonths={c.warranty_months}
        />
        <p className="text-center text-[12px] text-subtle-foreground">{t("footer", { date: fmt.date(data.expires_at) })}</p>
      </main>
    </div>
  );
}

function Kpi({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={cn("font-latin tabular-nums", strong ? "text-[22px] font-extrabold" : "text-[16px] font-bold")}>{value}</p>
    </div>
  );
}
