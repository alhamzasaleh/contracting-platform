"use client";
import { Camera, FileText, Pencil, Ruler, Send, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import * as React from "react";
import { DocNo } from "@/components/doc-no";
import { useFormatter } from "@/components/formatter-provider";
import { DeleteButton, FormDialog, NumberInput, useActionRunner } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { WhatsAppButton } from "@/components/whatsapp-button";
import type { ActionResult } from "@/lib/actions";
import { shrinkImage } from "@/lib/client/image";
import { canMeasure, measureDiff, measurableTypes, type MeasureBasis, type Measurement, type MeasurementStatus } from "@/lib/measurements";
import { ltr } from "@/lib/utils";
import { toNumber } from "@/lib/validation/numbers";

export type MeasurementActions = {
  save: (i: Record<string, unknown>) => Promise<ActionResult<{ id: string; number: string }>>;
  send: (i: { id: string }) => Promise<ActionResult>;
  remove: (i: { id: string }) => Promise<ActionResult>;
  uploadPhoto: (fd: FormData) => Promise<ActionResult<{ path: string }>>;
  /** finance.manage: money paid back to the client */
  refund?: (i: Record<string, unknown>) => Promise<ActionResult>;
};

export const MEASURE_TONE: Record<MeasurementStatus, "neutral" | "warning" | "success" | "danger"> = { draft: "neutral", sent: "warning", approved: "success", objected: "danger" };
const riyadhToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });

/** A work type's short name («أسقف», «قواطع»…) in the reader's language. */
export function useWorkTypeName() {
  const te = useTranslations("engine");
  return (w: string) => (te.has(`wt_${w}` as "wt_walls") ? te(`wt_${w}` as "wt_walls") : w);
}

/** The table of one sheet: agreed vs measured m², difference and its value; totals after discount + VAT. */
export function MeasurementTable({ m }: { m: Pick<Measurement, "lines" | "diff_subtotal" | "diff_vat" | "diff_total"> }) {
  const t = useTranslations("measure");
  const { fmt } = useFormatter();
  const name = useWorkTypeName();
  const signed = (v: number, money = false) => `${v > 0 ? "+" : ""}${money ? fmt.money(v) : fmt.number(v, 2)}`;
  return (
    <div className="grid gap-2">
      {/* scrolls sideways on a phone; on paper it sits inside the page (no negative margin) */}
      <div className="-mx-1 overflow-x-auto px-1 print:mx-0 print:overflow-visible print:px-0">
        <table className="w-full min-w-[480px] text-[13px] print:min-w-0">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border text-start">
              <th className="py-1.5 text-start font-normal">{t("workType")}</th>
              <th className="py-1.5 text-end font-normal">{t("agreed")}</th>
              <th className="py-1.5 text-end font-normal">{t("measured")}</th>
              <th className="py-1.5 text-end font-normal">{t("diffArea")}</th>
              <th className="py-1.5 text-end font-normal">{t("pricePerM2")}</th>
              <th className="py-1.5 text-end font-normal">{t("diffAmount")}</th>
            </tr>
          </thead>
          <tbody className="font-latin tabular-nums">
            {m.lines.map((l) => (
              <tr key={l.work_type} className="border-b border-border/60">
                <td className="py-1.5 font-sans font-bold">{name(l.work_type)}</td>
                <td className="py-1.5 text-end">{fmt.number(l.agreed_area, 2)}</td>
                <td className="py-1.5 text-end font-bold">{fmt.number(l.measured_area, 2)}</td>
                <td className={l.diff_area < 0 ? "py-1.5 text-end text-danger" : "py-1.5 text-end"}>{signed(l.diff_area)}</td>
                <td className="py-1.5 text-end">{fmt.money(l.price_per_m2)}</td>
                <td className="py-1.5 text-end">{signed(l.diff_amount, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid gap-1 text-[13px]">
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-muted-foreground">{t("subtotal")}</dt>
          <dd className="font-latin tabular-nums">{signed(m.diff_subtotal, true)}</dd>
        </div>
        {m.diff_vat !== 0 && (
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">{t("vat")}</dt>
            <dd className="font-latin tabular-nums">{signed(m.diff_vat, true)}</dd>
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-2 font-bold">
          <dt>{m.diff_total < 0 ? t("totalLess") : t("totalMore")}</dt>
          <dd className="font-latin tabular-nums">{fmt.money(Math.abs(m.diff_total))}</dd>
        </div>
      </dl>
    </div>
  );
}

/** «كشوف القياس» on the project page (owner, Nov 2026). */
export function MeasurementsCard({
  basis,
  sheets,
  owed,
  contract,
  client,
  orgName,
  canManage,
  canRefund,
  actions,
  base = "",
  focus,
}: {
  basis: MeasureBasis | null;
  sheets: Measurement[];
  owed: number;
  contract: { id: string; number: string };
  client: { name: string; phone: string | null };
  orgName?: string;
  canManage: boolean;
  canRefund?: boolean;
  actions?: MeasurementActions;
  base?: string;
  /** a sheet opened from a notification (?m=MS-…) */
  focus?: string | null;
}) {
  const t = useTranslations("measure");
  const tw = useTranslations("wa");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const [editing, setEditing] = React.useState<Measurement | "new" | null>(null);
  const [refunding, setRefunding] = React.useState<Measurement | null>(null);
  if (!basis) return null;
  const lump = basis.method === "lump";
  const free = measurableTypes(basis, sheets);

  return (
    <section id="measurements" className="grid scroll-mt-4 gap-3 rounded-3xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[15px] font-bold">
          <Ruler className="size-4" /> {t("title")}
        </p>
        {canManage && canMeasure(basis) && free.length > 0 && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Ruler /> {t("new")}
          </Button>
        )}
      </div>
      {lump ? (
        <p className="text-[13px] text-muted-foreground">{t("lumpNote")}</p>
      ) : (
        <p className="text-[13px] text-muted-foreground">{t("intro")}</p>
      )}
      {owed > 0 && (
        <p className="rounded-2xl bg-warning-soft px-4 py-2 text-[13px] font-bold">{t("owedToClient", { amount: fmt.money(owed) })}</p>
      )}
      {sheets.map((m) => (
        <article key={m.id} className={`grid gap-3 rounded-2xl border p-4 ${focus === m.number ? "border-primary" : "border-border"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-bold">
              <DocNo>{m.number}</DocNo>
              <Badge tone={MEASURE_TONE[m.status]}>{t(`st_${m.status}`)}</Badge>
            </p>
            <div className="flex flex-wrap gap-2">
              {m.status !== "draft" && (
                <Button asChild variant="secondary" size="sm">
                  <Link href={`${base}/print/measurements/${m.number}`} target="_blank">
                    <FileText /> {t("print")}
                  </Link>
                </Button>
              )}
              {m.status === "sent" && (
                <WhatsAppButton
                  phone={client.phone}
                  label={tw("btnNotify")}
                  text={tw("measurement", { name: client.name, number: ltr(m.number), contract: ltr(contract.number), org: orgName ?? "" })}
                />
              )}
            </div>
          </div>
          <MeasurementTable m={m} />
          {m.notes && <p className="whitespace-pre-line text-[13px]">{m.notes}</p>}
          {m.photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {m.photos.map((p) =>
                p.url ? (
                  <a key={p.path} href={p.url} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                    <img src={p.url} alt="" className="size-20 rounded-xl object-cover" />
                  </a>
                ) : null,
              )}
            </div>
          )}
          {m.status === "approved" && m.client_decided_at && (
            <p className="text-[12px] text-success">{t("approvedBy", { name: m.client_name ?? "", date: fmt.dateTime(m.client_decided_at) })}</p>
          )}
          {m.status === "objected" && (
            <div className="grid gap-1 rounded-xl bg-danger-soft px-3 py-2 text-[13px]">
              <p className="font-bold">{t("objectedBy", { name: m.client_name ?? "", date: m.client_decided_at ? fmt.dateTime(m.client_decided_at) : "" })}</p>
              {m.client_note && <p className="whitespace-pre-line">{m.client_note}</p>}
            </div>
          )}
          {m.status === "sent" && <p className="text-[12px] text-muted-foreground">{t("waitingClient")}</p>}
          {m.status === "approved" && m.credit_amount > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-[13px]">
              {m.refunded_at ? t("refunded", { amount: fmt.money(m.credit_amount), date: fmt.date(m.refunded_at) }) : t("owedLine", { amount: fmt.money(m.credit_amount) })}
              {!m.refunded_at && canRefund && (
                <Button size="sm" variant="secondary" onClick={() => setRefunding(m)}>
                  <Wallet /> {t("recordRefund")}
                </Button>
              )}
            </p>
          )}
          {canManage && (m.status === "draft" || m.status === "objected") && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" loading={pending} onClick={() => run(actions && (() => actions.send({ id: m.id })))}>
                <Send /> {m.status === "objected" ? t("resend") : t("send")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(m)}>
                <Pencil /> {t("edit")}
              </Button>
              <DeleteButton pending={pending} onConfirm={() => run(actions && (() => actions.remove({ id: m.id })))} />
            </div>
          )}
        </article>
      ))}
      {!lump && sheets.length === 0 && <p className="text-[13px] text-muted-foreground">{t("none")}</p>}
      {editing && (
        <MeasurementDialog
          basis={basis}
          sheets={sheets}
          initial={editing === "new" ? null : editing}
          contractId={contract.id}
          actions={actions}
          onClose={() => setEditing(null)}
        />
      )}
      {refunding && <RefundDialog m={refunding} onClose={() => setRefunding(null)} submit={actions?.refund} />}
    </section>
  );
}

function MeasurementDialog({
  basis,
  sheets,
  initial,
  contractId,
  actions,
  onClose,
}: {
  basis: MeasureBasis;
  sheets: Measurement[];
  initial: Measurement | null;
  contractId: string;
  actions?: MeasurementActions;
  onClose: () => void;
}) {
  const t = useTranslations("measure");
  const name = useWorkTypeName();
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const types = measurableTypes(basis, sheets, initial?.id);
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries((initial?.lines ?? []).map((l) => [l.work_type, String(l.measured_area)])),
  );
  const [notes, setNotes] = React.useState(initial?.notes ?? "");
  const [photos, setPhotos] = React.useState<{ path: string; preview: string | null }[]>(() => (initial?.photos ?? []).map((p) => ({ path: p.path, preview: p.url })));
  const [uploading, setUploading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const camera = React.useRef<HTMLInputElement>(null);
  const entries = types
    .map((w) => ({ workType: w, measured: toNumber(values[w] ?? "") }))
    .filter((e): e is { workType: string; measured: number } => typeof e.measured === "number" && e.measured >= 0);
  const preview = measureDiff(basis, entries);

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setErr(null);
    for (const f of [...files].slice(0, 12 - photos.length)) {
      const small = await shrinkImage(f, 1800);
      if (!actions) {
        setPhotos((p) => [...p, { path: crypto.randomUUID(), preview: URL.createObjectURL(small) }]);
        continue;
      }
      const fd = new FormData();
      fd.set("contract_id", contractId);
      fd.set("kind", "measure");
      fd.set("file", small);
      try {
        const r = await actions.uploadPhoto(fd);
        if (r.ok && r.data) setPhotos((p) => [...p, { path: r.data!.path, preview: URL.createObjectURL(small) }]);
        else setErr(t("photoFailed"));
      } catch {
        setErr(t("photoFailed"));
      }
    }
    setUploading(false);
  };

  return (
    <FormDialog
      open
      wide
      onOpenChange={(v) => !v && onClose()}
      title={initial ? t("editTitle", { number: ltr(initial.number) }) : t("new")}
      description={t("dialogHint")}
      pending={pending || uploading}
      onSubmit={() => {
        if (!entries.length) return setErr(t("pickOne"));
        run(
          actions &&
            (() =>
              actions.save({
                id: initial?.id ?? null,
                contract_id: contractId,
                lines: entries.map((e) => ({ work_type: e.workType, measured_area: e.measured })),
                notes: notes.trim() || null,
                photos: photos.map((p) => p.path),
              })),
          { onSuccess: onClose },
        );
      }}
    >
      <div className="field-row grid gap-4 sm:grid-cols-2">
        {types.map((w) => {
          const agreed = basis.workTypes.find((x) => x.workType === w)?.area ?? 0;
          return (
            <Field key={w} id={`ms-${w}`} label={name(w)} hint={t("agreedHint", { area: fmt.number(agreed, 2) })} optional={t("optional")}>
              <NumberInput suffix="m2" value={values[w] ?? ""} placeholder={fmt.number(agreed, 2)} onChange={(e) => setValues((v) => ({ ...v, [w]: e.target.value }))} />
            </Field>
          );
        })}
      </div>
      {preview.lines.length > 0 && (
        <div className="rounded-2xl bg-surface-sunken/60 p-3">
          <MeasurementTable m={{ lines: preview.lines, diff_subtotal: preview.subtotal, diff_vat: preview.vat, diff_total: preview.total }} />
        </div>
      )}
      <Field id="ms-notes" label={t("notes")} optional={t("optional")}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" loading={uploading} disabled={photos.length >= 12} onClick={() => camera.current?.click()}>
            <Camera /> {t("addPhotos")}
          </Button>
          {photos.length > 0 && <span className="text-[12px] text-muted-foreground">{t("photosCount", { n: photos.length })}</span>}
        </div>
        <input ref={camera} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addPhotos(e.target.files).then(() => { e.target.value = ""; })} />
        {photos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {photos.map((p) => (
              <span key={p.path} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview / short-lived signed URL */}
                {p.preview ? <img src={p.preview} alt="" className="size-16 rounded-xl object-cover" /> : <span className="block size-16 rounded-xl bg-surface-sunken" />}
                <button
                  type="button"
                  aria-label={t("removePhoto")}
                  className="absolute -end-1 -top-1 flex size-6 items-center justify-center rounded-full bg-surface shadow"
                  onClick={() => setPhotos((all) => all.filter((x) => x.path !== p.path))}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      {err && <p className="text-[13px] text-danger">{err}</p>}
    </FormDialog>
  );
}

function RefundDialog({ m, onClose, submit }: { m: Measurement; onClose: () => void; submit?: MeasurementActions["refund"] }) {
  const t = useTranslations("measure");
  const tf = useTranslations("finance");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const today = riyadhToday();
  const [date, setDate] = React.useState(today);
  const [method, setMethod] = React.useState<"transfer" | "cash" | "cheque" | "card">("transfer");
  const [ref, setRef] = React.useState("");
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t("recordRefund")}
      description={t("refundHint", { amount: fmt.money(m.credit_amount), number: ltr(m.number) })}
      pending={pending}
      onSubmit={() => run(submit && (() => submit({ id: m.id, paid_on: date, method, reference: ref.trim() || null })), { onSuccess: onClose })}
    >
      <Field id="rf-d" label={tf("date")}>
        <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Segmented name={tf("method")} value={method} onChange={setMethod} options={(["transfer", "cash", "cheque", "card"] as const).map((x) => ({ value: x, label: tf(`method_${x}`) }))} />
      <Field id="rf-r" label={tf("reference")} optional={tf("optional")}>
        <Input value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
    </FormDialog>
  );
}
