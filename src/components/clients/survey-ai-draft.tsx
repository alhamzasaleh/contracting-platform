"use client";
import { Camera, Mic, MicOff, Sparkles, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { useFormatter } from "@/components/formatter-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import { shrinkImage } from "@/lib/client/image";
import type { DraftRoom, cleanDraft } from "@/lib/survey/ai-draft";
import { cn } from "@/lib/utils";
import { useListSep } from "@/components/forms/form-kit";
import { settle } from "@/lib/client/action";
import { useFailureText } from "@/lib/client/failure-text";

type Draft = ReturnType<typeof cleanDraft>;
type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
const noop = () => () => {};
function speechRecognition(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type Row = DraftRoom & { pick: boolean };

/**
 * Speak or write the measurements (or photograph a sketch) → the AI drafts rooms →
 * the supervisor checks the numbers, ticks rows and adds them to the survey.
 */
export function SurveyAiDraft({
  surveyId,
  draft,
  addRoom,
  onTotals,
  preview,
  sample,
}: {
  surveyId: string;
  draft?: (fd: FormData) => Promise<ActionResult<Draft>>;
  addRoom?: (room: Record<string, unknown>) => Promise<ActionResult>;
  /** total-area mode: fill the totals form from what was said */
  onTotals?: (totals: Draft["totals"]) => void;
  preview?: boolean;
  sample?: Draft;
}) {
  const sep = useListSep();
  const t = useTranslations("survey");
  const failure = useFailureText();
  const locale = useLocale();
  const { fmt } = useFormatter();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [photos, setPhotos] = React.useState<File[]>([]);
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [result, setResult] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const canSpeak = React.useSyncExternalStore(noop, () => !!speechRecognition(), () => false);
  const rec = React.useRef<Recognition | null>(null);

  const reset = () => {
    setRows(null);
    setResult(null);
  };

  const toggleMic = () => {
    if (listening) return rec.current?.stop();
    const R = speechRecognition();
    if (!R) return;
    const r = new R();
    r.lang = locale === "en" ? "en-US" : "ar-SA";
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      const said = Array.from(e.results).slice(e.resultIndex).filter((x) => x.isFinal).map((x) => x[0]?.transcript ?? "").join(" ").trim();
      if (said) setText((s) => (s ? `${s}\n${said}` : said));
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const list = await Promise.all(Array.from(files).slice(0, 4).map((f) => shrinkImage(f)));
    setPhotos((p) => [...p, ...list].slice(0, 4));
  };

  const read = async () => {
    rec.current?.stop();
    if (preview) {
      const d = sample ?? { rooms: [], totals: {}, unclear: [] };
      setResult(d);
      setRows(d.rooms.map((r) => ({ ...r, pick: r.missing.every((m) => m === "height") })));
      return;
    }
    if (!draft) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("survey_id", surveyId);
    fd.set("text", text);
    photos.forEach((p) => fd.append("photos", p));
    const r = await settle(() => draft(fd));
    setBusy(false);
    if (!r.ok && failure(r.error)) return toast.error(failure(r.error)!);
    if (!r.ok || !r.data) return toast.error(t.has(`ai_${r.ok ? "aiFailed" : r.error}`) ? t(`ai_${r.ok ? "aiFailed" : r.error}`) : t("ai_aiFailed"));
    setResult(r.data);
    setRows(r.data.rooms.map((x) => ({ ...x, pick: x.missing.every((m) => m === "height") })));
  };

  const ready = (r: Row) => r.length_m != null && r.width_m != null && r.height_m != null;
  const chosen = (rows ?? []).filter((r) => r.pick && ready(r));

  const add = async () => {
    if (preview || !addRoom) {
      toast(t("aiAdded", { n: chosen.length }));
      return setOpen(false);
    }
    setBusy(true);
    let added = 0;
    let lost: string | null = null;
    for (const r of chosen) {
      const res = await settle(() => addRoom({
        survey_id: surveyId, name: r.name, unit_label: r.unit_label, length_m: String(r.length_m), width_m: String(r.width_m), height_m: String(r.height_m),
        openings_m2: String(r.openings_m2), gypsum_ceiling: r.gypsum_ceiling, ceiling_board: r.ceiling_board, paint_walls: r.paint_walls,
        paint_ceiling: r.paint_ceiling, wall_zone: r.wall_zone,
      }));
      if (res.ok) added++;
      else if ((lost = failure(res.error))) break; // the connection is gone: stop and say so
    }
    setBusy(false);
    if (added === chosen.length) toast.success(t("aiAdded", { n: added }));
    else toast.error(lost ? `${t("aiAddedSome", { n: added, total: chosen.length })} ${lost}` : t("aiAddedSome", { n: added, total: chosen.length }));
    if (lost) return; // keep the dialog and its rows to try again
    setOpen(false);
    reset();
    setText("");
    setPhotos([]);
  };

  const setNum = (i: number, k: "length_m" | "width_m" | "height_m") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value.replace(",", "."));
    setRows((xs) => xs!.map((x, j) => (j === i ? { ...x, [k]: Number.isFinite(v) && v > 0 ? v : null } : x)));
  };

  const totals = Object.entries(result?.totals ?? {});

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Sparkles /> {t("aiButton")}
      </Button>
      <Dialog open={open} onOpenChange={(v) => (setOpen(v), v || rec.current?.stop())}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("aiTitle")}</DialogTitle>
            <DialogDescription>{t("aiHint")}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            {!rows ? (
              <>
                <div className="grid gap-2">
                  <Textarea
                    rows={6}
                    value={text}
                    maxLength={6000}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={listening ? t("aiListening") : t("aiPlaceholder")}
                    aria-label={t("aiNotes")}
                  />
                  <div className="flex flex-wrap gap-2">
                    {canSpeak && (
                      <Button type="button" variant={listening ? "danger" : "secondary"} onClick={toggleMic}>
                        {listening ? <MicOff /> : <Mic />} {listening ? t("aiStop") : t("aiSpeak")}
                      </Button>
                    )}
                    <Button type="button" variant="secondary" asChild>
                      <label className="cursor-pointer">
                        <Camera /> {t("aiPhotos")}
                        <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => addPhotos(e.target.files)} disabled={photos.length >= 4} />
                      </label>
                    </Button>
                  </div>
                  {photos.length > 0 && (
                    <ul className="flex flex-wrap gap-2 text-[12px]">
                      {photos.map((p, i) => (
                        <li key={i} className="flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1">
                          {t("aiPhotoN", { n: i + 1 })}
                          <button type="button" aria-label={t("aiRemovePhoto")} onClick={() => setPhotos((xs) => xs.filter((_, j) => j !== i))}>
                            <X className="size-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <p className="text-[12px] text-muted-foreground">{t("aiPrivacy")}</p>
              </>
            ) : (
              <>
                {rows.length === 0 && <p className="text-sm text-muted-foreground">{t("aiNoRooms")}</p>}
                <ul className="grid gap-2">
                  {rows.map((r, i) => (
                    <li key={i} className={cn("grid gap-2 rounded-2xl border p-3", r.pick ? "border-primary/50 bg-primary/5" : "border-border")}>
                      <label className="flex items-center gap-2 text-[14px] font-semibold">
                        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={r.pick} onChange={() => setRows((xs) => xs!.map((x, j) => (j === i ? { ...x, pick: !x.pick } : x)))} />
                        {r.name}
                        {r.unit_label && <span className="font-normal text-muted-foreground">· {r.unit_label}</span>}
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {(["length_m", "width_m", "height_m"] as const).map((k) => (
                          <span key={`l-${k}`} className="text-[11px] font-semibold text-muted-foreground">{t(`ai_${k}`)}</span>
                        ))}
                        {(["length_m", "width_m", "height_m"] as const).map((k) => (
                          <Input
                            key={k}
                            inputMode="decimal"
                            dir="ltr"
                            aria-label={`${r.name} — ${t(`ai_${k}`)}`}
                            placeholder={t(`ai_${k}`)}
                            defaultValue={r[k] ?? ""}
                            onChange={setNum(i, k)}
                            className={cn("font-latin", r[k] == null && "border-warning")}
                          />
                        ))}
                      </div>
                      <p className="text-[12px] text-muted-foreground">
                        {[
                          r.gypsum_ceiling && t("aiGypsum", { board: t(`board_${r.ceiling_board}`) }),
                          r.wall_zone !== "normal" && t(`zone_${r.wall_zone}`),
                          r.openings_m2 > 0 && t("aiOpenings", { m2: fmt.number(r.openings_m2) }),
                          r.missing.length > 0 && t("aiMissing", { what: r.missing.map((m) => t(`ai_miss_${m}`)).join(sep) }),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
                {totals.length > 0 && (
                  <div className="grid gap-2 rounded-2xl bg-surface-2 p-3 text-[13px]">
                    <p className="font-bold">{t("aiTotals")}</p>
                    <p>{totals.map(([k, v]) => `${t.has(`ai_total_${k}`) ? t(`ai_total_${k}`) : k}: ${fmt.number(v as number)}`).join(" · ")}</p>
                    {onTotals && (
                      <Button size="sm" variant="secondary" className="justify-self-start" onClick={() => (onTotals(result!.totals), toast.success(t("aiTotalsFilled")))}>
                        {t("aiFillTotals")}
                      </Button>
                    )}
                  </div>
                )}
                {result && result.unclear.length > 0 && (
                  <ul className="grid list-disc gap-1 rounded-2xl bg-warning-soft px-6 py-3 text-[13px]">
                    {result.unclear.map((u, i) => <li key={i}>{u}</li>)}
                  </ul>
                )}
                <p className="text-[12px] text-muted-foreground">{t("aiReview")}</p>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            {!rows ? (
              <Button onClick={read} loading={busy} disabled={!text.trim() && photos.length === 0}>
                <Sparkles /> {t("aiRead")}
              </Button>
            ) : (
              <>
                <Button onClick={add} loading={busy} disabled={chosen.length === 0}>
                  {t("aiAdd", { n: chosen.length })}
                </Button>
                <Button variant="ghost" onClick={reset} disabled={busy}>
                  {t("aiBack")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
