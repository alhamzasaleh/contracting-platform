"use client";
import { Check, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { DocNo } from "@/components/doc-no";
import { useFormatter } from "@/components/formatter-provider";
import { SignaturePad } from "@/components/portal/portal-view";
import { MeasurementTable } from "@/components/projects/measurements";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import { settle } from "@/lib/client/action";
import { useFailureText } from "@/lib/client/failure-text";
import type { PortalMeasurement } from "@/lib/portal";
import { cn } from "@/lib/utils";

/** Measurement sheets on the client page: read the quantities first, then sign — or send a comment. */
export function PortalMeasurements({
  list,
  clientName,
  number,
  token,
  onAnswer,
}: {
  list: PortalMeasurement[];
  clientName: string;
  number: string;
  token: string;
  onAnswer?: (i: Record<string, unknown>) => Promise<ActionResult>;
}) {
  const t = useTranslations("measure");
  const { fmt } = useFormatter();
  if (!list.length) return null;
  return (
    <section id="measurements" className="grid scroll-mt-4 gap-3 rounded-3xl border border-border bg-surface p-5" aria-labelledby="measure-title">
      <h2 id="measure-title" className="text-[17px] font-bold">
        {t("portalTitle")}
      </h2>
      <p className="text-[13px] text-muted-foreground">{t("portalIntro")}</p>
      {list.map((m) => (
        <article key={m.id} className={cn("grid gap-3 rounded-2xl p-4", m.status === "sent" ? "border-2 border-primary/50" : "bg-surface-sunken/50")}>
          <p className="font-bold">
            <DocNo>{m.number}</DocNo>
          </p>
          <MeasurementTable m={m} />
          {m.notes && <p className="whitespace-pre-line text-[14px] leading-7">{m.notes}</p>}
          {m.photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {m.photos.map((u) => (
                <a key={u} href={u} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                  <img src={u} alt="" className="size-20 rounded-xl object-cover" />
                </a>
              ))}
            </div>
          )}
          {m.status === "approved" && m.client_decided_at && <p className="text-[13px] text-success">{t("portalApproved", { date: fmt.dateTime(m.client_decided_at) })}</p>}
          {m.status === "approved" && m.credit_amount > 0 && (
            <p className="rounded-xl bg-warning-soft px-3 py-2 text-[13px] font-bold">
              {m.refunded_at ? t("refundedClient", { amount: fmt.money(m.credit_amount), date: fmt.date(m.refunded_at) }) : t("owedClient", { amount: fmt.money(m.credit_amount) })}
            </p>
          )}
          {m.status === "objected" && m.client_decided_at && (
            <div className="grid gap-1 text-[13px]">
              <p className="text-muted-foreground">{t("portalObjected", { date: fmt.dateTime(m.client_decided_at) })}</p>
              {m.client_note && <p className="whitespace-pre-line">{m.client_note}</p>}
            </div>
          )}
          {m.status === "sent" && <Answer id={m.id} clientName={clientName} number={number} token={token} onAnswer={onAnswer} />}
        </article>
      ))}
    </section>
  );
}

function Answer({ id, clientName, number, token, onAnswer }: { id: string; clientName: string; number: string; token: string; onAnswer?: (i: Record<string, unknown>) => Promise<ActionResult> }) {
  const t = useTranslations("measure");
  const tp = useTranslations("portal");
  const failure = useFailureText({ clientPage: true });
  const router = useRouter();
  const [mode, setMode] = React.useState<"sign" | "note">("sign");
  const [name, setName] = React.useState(clientName);
  const [note, setNote] = React.useState("");
  const [signature, setSignature] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const send = (approve: boolean) =>
    start(async () => {
      setError(null);
      if (!onAnswer) return;
      const r = await settle(() => onAnswer({ number, token, measurement_id: id, approve, name: name.trim(), note: approve ? null : note.trim(), signature: approve ? signature : null }));
      if (r.ok) router.refresh();
      else setError(failure(r.error) ?? (r.error === "rateLimited" ? tp("errRate") : r.error === "invalid" ? tp("errInvalid") : tp("errGeneric")));
    });
  return (
    <div className="grid gap-3 border-t border-border pt-3">
      <Field id={`ms-name-${id}`} label={tp("yourName")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </Field>
      {mode === "sign" ? (
        <>
          <p className="text-[13px] text-muted-foreground">{t("portalSignHint")}</p>
          <SignaturePad onChange={setSignature} />
          {error && <p className="text-[13px] text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button loading={pending} disabled={name.trim().length < 2 || !signature} onClick={() => send(true)}>
              <Check /> {t("portalApprove")}
            </Button>
            <Button variant="secondary" onClick={() => setMode("note")}>
              <MessageSquare /> {t("portalObject")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Field id={`ms-note-${id}`} label={t("portalNote")}>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </Field>
          {error && <p className="text-[13px] text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button loading={pending} disabled={name.trim().length < 2 || note.trim().length < 3} onClick={() => send(false)}>
              <MessageSquare /> {t("portalSendNote")}
            </Button>
            <Button variant="secondary" onClick={() => setMode("sign")}>
              <Check /> {t("portalApprove")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
