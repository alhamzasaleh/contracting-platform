"use client";
import { Building2, Plus, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { useFormatter } from "@/components/formatter-provider";
import { NumberInput, useListSep, useUnitText } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionResult } from "@/lib/actions";
import { settle } from "@/lib/client/action";
import { useFailureText } from "@/lib/client/failure-text";
import { MATERIALS, facadeArea, facadesTotal, mergeFacades, missingSizes, rowId, type Facade, type FacadeOpening, type FacadePart } from "@/lib/survey/facade";
import { PLAN_MAX_BYTES, roomSize } from "@/lib/survey/plan";
import { cn } from "@/lib/utils";

type Found = { key: string; page: number; code: string; name: string; pick: boolean; dup: boolean };
type Step = { kind: "file" } | { kind: "pick"; found: Found[] } | { kind: "review"; facades: Facade[]; failed: string[] };

const KINDS = ["window", "door", "opening"] as const;

/**
 * «قراءة الواجهات من المخطط» (owner, Nov 2026): the architect's PDF opens on the device, its titled
 * elevations are listed, the AI reads each one into parts by finish (paint / stone / glass / GRC) and
 * the openings in the painted parts; the owner reviews every row — the paint area is computed from
 * them — and «اعتماد» makes it the survey's façade area (the rows are kept for «مراجعة الواجهات»).
 */
export function SurveyFacadeImport({
  surveyId,
  readFacade,
  save,
  saved,
  onSaved,
  preview,
  sample,
}: {
  surveyId: string;
  readFacade?: (fd: FormData) => Promise<ActionResult<Facade>>;
  save?: (input: { id: string; facades: Facade[] | null }) => Promise<ActionResult<{ facade: number }>>;
  /** façades reviewed before (reopened without reading again) */
  saved: Facade[] | null;
  /** approved (area + rows) or removed (null: the typed area stays) */
  onSaved?: (facade: number | null, facades: Facade[] | null) => void;
  preview?: boolean;
  /** design preview: the review step with sample façades */
  sample?: Facade[];
}) {
  const t = useTranslations("survey");
  const failure = useFailureText();
  const { fmt } = useFormatter();
  const facadeName = useFacadeName();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>({ kind: "file" });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const doc = React.useRef<{ doc: import("pdfjs-dist").PDFDocumentProxy; elevations: import("@/lib/client/plan-pdf").FoundElevation[] } | null>(null);

  // one open PDF at a time: freed on close, on a new file and on leaving the page
  const dropDoc = () => {
    void doc.current?.doc.loadingTask.destroy();
    doc.current = null;
  };
  React.useEffect(() => dropDoc, []);
  const close = () => {
    setOpen(false);
    setStep({ kind: "file" });
    dropDoc();
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (preview) return setStep({ kind: "review", facades: sample ?? [], failed: [] });
    if (file.size > PLAN_MAX_BYTES) return toast.error(t("planTooBig"));
    const { findElevations, looksLikePdf } = await import("@/lib/client/plan-pdf");
    if (!(await looksLikePdf(file))) return toast.error(t("planNotPdf"));
    dropDoc();
    setBusy(t("planOpening", { done: 0, total: "…" }));
    try {
      const found = await findElevations(file, (done, total) => setBusy(t("planOpening", { done, total })));
      doc.current = { doc: found.doc, elevations: found.elevations };
      // the same elevation on two sheets (a sheet and a combined one) starts unticked: never counted twice
      const seen = new Set<string>();
      setStep({
        kind: "pick",
        found: found.elevations.map((e) => {
          const dup = seen.has(e.code);
          seen.add(e.code);
          return { key: `${e.page}:${e.code}`, page: e.page, code: e.code, name: facadeName({ code: e.code, dir: e.dir }), pick: !dup, dup };
        }),
      });
    } catch {
      toast.error(t("planOpenFailed"));
    } finally {
      setBusy(null);
    }
  };

  /** Read the ticked elevations one by one (an AI failure is tried once more; a stop keeps what was read). */
  const read = async (found: Found[]) => {
    if (!readFacade || !doc.current) return;
    const { elevationPayload } = await import("@/lib/client/plan-pdf");
    const facades: Facade[] = [];
    const failed: string[] = [];
    const picked = found.filter((f) => f.pick);
    for (const [i, f] of picked.entries()) {
      if (!doc.current) break;
      setBusy(t("facadeReading", { i: i + 1, n: picked.length, name: f.name }));
      const el = doc.current.elevations.find((e) => `${e.page}:${e.code}` === f.key)!;
      let fd: FormData;
      try {
        const { meta, tiles } = await elevationPayload(doc.current.doc, el, surveyId);
        fd = new FormData();
        fd.set("meta", JSON.stringify(meta));
        tiles.forEach((b, j) => fd.append("tiles", b, `tile-${j + 1}.jpg`));
      } catch {
        failed.push(f.name);
        continue;
      }
      let r = await settle(() => readFacade(fd));
      if (!r.ok && r.error === "aiFailed") {
        await new Promise((res) => setTimeout(res, 3000));
        r = await settle(() => readFacade(fd));
      }
      const stop = !r.ok ? failure(r.error) ?? (["rateLimited", "aiNotConfigured"].includes(r.error) ? t(`ai_${r.error}`) : null) : null;
      if (stop) {
        toast.error(stop);
        failed.push(...picked.slice(i).map((x) => x.name));
        break;
      }
      if (!r.ok || !r.data) failed.push(f.name);
      else facades.push(r.data);
    }
    setBusy(null);
    // a new reading joins the façades approved before (the same code is replaced, the others kept)
    setStep({ kind: "review", facades: mergeFacades(saved, facades), failed });
  };

  const approve = async (facades: Facade[]) => {
    if (!save) return close();
    setSaving(true);
    const r = await settle(() => save({ id: surveyId, facades }));
    setSaving(false);
    if (!r.ok) return toast.error(failure(r.error) ?? t("facadeSaveFailed"));
    toast.success(t("facadeSaved"));
    onSaved?.(r.data?.facade ?? facadesTotal(facades), facades);
    close();
  };

  /** «إزالة قراءة الواجهات»: the rows go, the typed façade area stays. */
  const remove = async () => {
    if (!save) return close();
    setSaving(true);
    const r = await settle(() => save({ id: surveyId, facades: null }));
    setSaving(false);
    if (!r.ok) return toast.error(failure(r.error) ?? t("facadeSaveFailed"));
    toast.success(t("facadeRemoved"));
    onSaved?.(null, null);
    close();
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => (setStep({ kind: "file" }), setOpen(true))}>
          <Building2 /> {t("facadeRead")}
        </Button>
        {!!saved?.length && (
          <Button type="button" size="sm" variant="ghost" onClick={() => (setStep({ kind: "review", facades: saved, failed: [] }), setOpen(true))}>
            {t("facadeReview")}
          </Button>
        )}
      </div>
      <Dialog open={open} onOpenChange={(v) => !v && !busy && !saving && close()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("facadeTitle")}</DialogTitle>
            <DialogDescription>{t("facadeHint")}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            {busy && <p className="rounded-xl bg-surface-sunken px-3 py-2 text-[13px]">{busy}</p>}
            {step.kind === "file" && !busy && (
              <label className="grid cursor-pointer place-items-center gap-2 rounded-2xl border border-dashed border-border p-8 text-center text-[14px] hover:border-primary/40">
                <Upload className="size-6 text-muted-foreground" />
                {t("facadePickPdf")}
                <input type="file" accept="application/pdf" className="sr-only" onChange={(e) => void pickFile(e.target.files?.[0])} />
              </label>
            )}
            {step.kind === "pick" && !busy && (
              step.found.length === 0 ? (
                <p className="text-[14px] text-muted-foreground">{t("facadeNone")}</p>
              ) : (
                <ul className="grid gap-2">
                  {step.found.map((f, i) => (
                    <li key={f.key}>
                      <label className="flex items-center gap-3 rounded-2xl border border-border px-4 py-3 text-[14px]">
                        <input type="checkbox" checked={f.pick} onChange={(e) => setStep({ ...step, found: step.found.map((x, j) => (j === i ? { ...x, pick: e.target.checked } : x)) })} />
                        <span className="font-bold">{f.name}</span>
                        <span className="font-latin text-[12px] text-muted-foreground" dir="ltr">
                          {f.code}
                        </span>
                        <span className="text-[12px] text-muted-foreground">{t("facadeSheet", { page: f.page })}</span>
                        {f.dup && <span className="text-[12px] text-warning">{t("facadeDuplicate")}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              )
            )}
            {step.kind === "review" && !busy && (
              <Review facades={step.facades} failed={step.failed} onChange={(facades) => setStep({ ...step, facades })} />
            )}
          </DialogBody>
          <DialogFooter>
            {step.kind === "pick" && !busy && step.found.some((f) => f.pick) && <Button onClick={() => void read(step.found)}>{t("facadeReadPicked")}</Button>}
            {step.kind === "review" && !busy && missingSizes(step.facades) > 0 && (
              <p className="me-auto self-center text-[12px] text-warning">{t("facadeMissing", { n: missingSizes(step.facades) })}</p>
            )}
            {step.kind === "review" && !busy && (
              <Button loading={saving} disabled={!step.facades.some((f) => f.include)} onClick={() => void approve(step.facades)}>
                {t("facadeApprove", { area: fmt.number(facadesTotal(step.facades), 2) })}
              </Button>
            )}
            {step.kind === "review" && !busy && !!saved?.length && (
              <Button variant="secondary" disabled={saving} onClick={() => void remove()}>
                {t("facadeRemoveReading")}
              </Button>
            )}
            <Button variant="ghost" disabled={!!busy || saving} onClick={close}>
              {t("facadeClose")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The façades for review: every part and opening editable; the paint area follows. */
function Review({ facades, failed, onChange }: { facades: Facade[]; failed: string[]; onChange: (f: Facade[]) => void }) {
  const t = useTranslations("survey");
  const { fmt } = useFormatter();
  const unitText = useUnitText();
  const sep = useListSep();
  const facadeName = useFacadeName();
  const set = (i: number, patch: Partial<Facade>) => onChange(facades.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  if (!facades.length) return <p className="text-[14px] text-muted-foreground">{failed.length ? t("facadeAllFailed") : t("facadeNone")}</p>;
  return (
    <div className="grid gap-4">
      {failed.length > 0 && <p className="rounded-xl bg-warning-soft px-3 py-2 text-[13px]">{t("facadeFailed", { names: failed.join(sep) })}</p>}
      {facades.map((f, i) => {
        const a = facadeArea(f);
        const setPart = (k: number, patch: Partial<FacadePart>) => set(i, { parts: f.parts.map((p, j) => (j === k ? { ...p, ...patch } : p)) });
        const setOpening = (k: number, patch: Partial<FacadeOpening>) => set(i, { openings: f.openings.map((o, j) => (j === k ? { ...o, ...patch } : o)) });
        return (
          <section key={`${f.code}-${i}`} className={cn("grid gap-3 rounded-2xl border p-4", f.include ? "border-border" : "border-dashed border-border opacity-70")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-[15px] font-bold">
                <input type="checkbox" checked={f.include} onChange={(e) => set(i, { include: e.target.checked })} aria-label={t("facadeInclude")} />
                {facadeName(f)}
                <span className="font-latin text-[12px] font-normal text-muted-foreground" dir="ltr">{f.code}</span>
              </label>
              <Badge tone={f.include ? "success" : "neutral"}>
                {t("facadePaint")}: {fmt.number(a.paint, 2)} {unitText("m2")}
              </Badge>
            </div>

            <p className="text-[13px] font-semibold">{t("facadeParts")}</p>
            {f.parts.map((p, k) => (
              <div key={p.id} className="grid gap-2 rounded-xl bg-surface-sunken/60 p-3">
                <Field
                  id={`fp-${i}-${k}-name`}
                  label={t("facadePartName")}
                  action={
                    <span className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-[12px]">
                        <input type="checkbox" checked={p.include} onChange={(e) => setPart(k, { include: e.target.checked })} />
                        {t("facadeCounted")}
                      </label>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("facadeRemove")} onClick={() => set(i, { parts: f.parts.filter((_, j) => j !== k), openings: f.openings.filter((o) => o.part !== p.id) })}>
                        <Trash2 />
                      </Button>
                    </span>
                  }
                >
                  <Input value={p.name} onChange={(e) => setPart(k, { name: e.target.value })} />
                </Field>
                <div className="field-row grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Field id={`fp-${i}-${k}-mat`} label={t("facadeMaterial")}>
                    <NativeSelect value={p.material} onChange={(e) => setPart(k, { material: e.target.value as FacadePart["material"] })}>
                      {MATERIALS.map((m) => (
                        <option key={m} value={m}>
                          {t(`facadeMat_${m}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <SizeField id={`fp-${i}-${k}-w`} label={t("facadeWidth")} value={p.width_m} max={80} onChange={(v) => setPart(k, { width_m: v })} />
                  <SizeField id={`fp-${i}-${k}-h`} label={t("facadeHeight")} value={p.height_m} max={40} onChange={(v) => setPart(k, { height_m: v })} />
                  <CountField id={`fp-${i}-${k}-n`} label={t("facadeCount")} value={p.count} onChange={(v) => setPart(k, { count: v })} />
                </div>
              </div>
            ))}
            <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => set(i, { parts: [...f.parts, { id: rowId("p"), name: t("facadeNewPart"), material: "paint", width_m: null, height_m: null, count: 1, include: true }] })}>
              <Plus /> {t("facadeAddPart")}
            </Button>

            <p className="text-[13px] font-semibold">{t("facadeOpenings")}</p>
            {f.openings.map((o, k) => (
              <div key={o.id} className="field-row grid grid-cols-2 gap-2 rounded-xl bg-surface-sunken/60 p-3 sm:grid-cols-5">
                <Field id={`fo-${i}-${k}-part`} label={t("facadeOpeningPart")}>
                  <NativeSelect value={o.part ?? ""} onChange={(e) => setOpening(k, { part: e.target.value || null })}>
                    <option value="">{t("facadeOpeningPartNone")}</option>
                    {f.parts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field
                  id={`fo-${i}-${k}-kind`}
                  label={t("facadeOpeningKind")}
                  action={
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t("facadeRemove")} onClick={() => set(i, { openings: f.openings.filter((_, j) => j !== k) })}>
                      <Trash2 />
                    </Button>
                  }
                >
                  <NativeSelect value={o.kind} onChange={(e) => setOpening(k, { kind: e.target.value as FacadeOpening["kind"] })}>
                    {KINDS.map((m) => (
                      <option key={m} value={m}>
                        {t(`facadeKind_${m}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <SizeField id={`fo-${i}-${k}-w`} label={t("facadeWidth")} value={o.width_m} max={12} onChange={(v) => setOpening(k, { width_m: v })} />
                <SizeField id={`fo-${i}-${k}-h`} label={t("facadeHeight")} value={o.height_m} max={12} onChange={(v) => setOpening(k, { height_m: v })} />
                <CountField id={`fo-${i}-${k}-n`} label={t("facadeCount")} value={o.count} onChange={(v) => setOpening(k, { count: v })} />
              </div>
            ))}
            <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => set(i, { openings: [...f.openings, { id: rowId("o"), part: f.parts.find((p) => p.include && p.material === "paint")?.id ?? null, kind: "window", width_m: null, height_m: null, count: 1 }] })}>
              <Plus /> {t("facadeAddOpening")}
            </Button>

            <p className="text-[13px] text-muted-foreground">
              {t("facadeSum", { gross: fmt.number(a.gross, 2), openings: fmt.number(a.openings, 2), paint: fmt.number(a.paint, 2) })}
              {a.other.stone + a.other.glass + a.other.grc + a.other.other > 0 &&
                ` · ${t("facadeOther", { stone: fmt.number(a.other.stone, 2), glass: fmt.number(a.other.glass, 2), grc: fmt.number(a.other.grc + a.other.other, 2) })}`}
            </p>
            {f.notes.length > 0 && (
              <ul className="grid gap-1 rounded-xl bg-warning-soft px-3 py-2 text-[12px]">
                {f.notes.map((n, k) => (
                  <li key={k}>{n}</li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** A size in metres typed freely (Arabic digits, comma); empty / out of range = not set. */
function SizeField({ id, label, value, max, onChange }: { id: string; label: string; value: number | null; max: number; onChange: (v: number | null) => void }) {
  const [text, setText] = React.useState(value == null ? "" : String(value));
  return (
    <Field id={id} label={label}>
      <NumberInput
        inputMode="decimal"
        suffix="m"
        value={text}
        aria-invalid={value == null}
        onChange={(e) => {
          setText(e.target.value);
          onChange(roomSize(e.target.value, max));
        }}
      />
    </Field>
  );
}

function CountField({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (v: number) => void }) {
  const [text, setText] = React.useState(String(value));
  return (
    <Field id={id} label={label}>
      <NumberInput
        inputMode="numeric"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = roomSize(e.target.value, 100);
          if (n != null) onChange(Math.max(1, Math.round(n)));
        }}
      />
    </Field>
  );
}

/** A façade's name on screen: its direction («الواجهة الشرقية»), else its code. */
export function useFacadeName() {
  const t = useTranslations("survey");
  return (f: Pick<Facade, "code" | "dir">) => (f.dir ? t(`facadeDir_${f.dir}`) : t("facadeCode", { code: f.code }));
}
