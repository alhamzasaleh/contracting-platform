"use client";
import { CircleAlert, CircleCheck, FileScan, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { useFormatter } from "@/components/formatter-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useListSep } from "@/components/forms/form-kit";
import type { ActionResult } from "@/lib/actions";
import { settle } from "@/lib/client/action";
import { useFailureText } from "@/lib/client/failure-text";
import { markRepeats, planRoomName, roomSize, PLAN_MAX_BYTES, type PlanRoom, type cleanPlanDraft } from "@/lib/survey/plan";
import { cn } from "@/lib/utils";

export type PlanReading = ReturnType<typeof cleanPlanDraft>;
type Row = PlanRoom & { repeated: boolean; pick: boolean; saved?: boolean };
type Floor = { floor: string; page: number; height: number | null; rows: Row[]; conflicts: string[] };
type Found = { page: number; title: string; rooms: number; pick: boolean };
type Step = { kind: "file" } | { kind: "sheets"; found: Found[]; pages: number } | { kind: "review"; floors: Floor[]; failed: number[] };

/**
 * «قراءة من المخطط»: the owner picks the architect's PDF (≤ 60 MB, opened on the device), ticks the
 * floor-plan sheets found in it, the AI reads each sheet's rooms, and he reviews the sizes floor by
 * floor (⚠ open spaces / sizes not found printed / a room repeated on another sheet) before adding them.
 */
export function SurveyPlanImport({
  surveyId,
  readPlan,
  addRoom,
  usualHeight,
  preview,
  sample,
}: {
  surveyId: string;
  readPlan?: (fd: FormData) => Promise<ActionResult<PlanReading>>;
  addRoom?: (room: Record<string, unknown>) => Promise<ActionResult>;
  usualHeight: number | null;
  preview?: boolean;
  /** design preview: the review step with sample sheets */
  sample?: (PlanReading & { page: number })[];
}) {
  const t = useTranslations("survey");
  const tErr = useTranslations("errors");
  const failure = useFailureText();
  const sep = useListSep();
  const { fmt } = useFormatter();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>({ kind: "file" });
  const [busy, setBusy] = React.useState<string | null>(null);
  const doc = React.useRef<{ doc: import("pdfjs-dist").PDFDocumentProxy; sheets: import("@/lib/client/plan-pdf").FoundSheet[] } | null>(null);

  // one open PDF at a time (a 60 MB plan is heavy on an iPad): freed on close, on a new file and on leaving the page
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

  const toFloors = (readings: (PlanReading & { page: number })[]): Floor[] =>
    markRepeats(readings.map((r) => r.rooms)).map((rooms, i) => ({
      floor: readings[i].floor,
      page: readings[i].page,
      height: usualHeight,
      conflicts: readings[i].conflicts,
      rows: rooms.map((r) => ({ ...r, pick: !r.repeated && r.length_m != null && r.width_m != null })),
    }));

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (preview) {
      setStep({ kind: "review", floors: toFloors(sample ?? []), failed: [] });
      return;
    }
    if (file.size > PLAN_MAX_BYTES) return toast.error(t("planTooBig"));
    const { findPlanSheets, looksLikePdf } = await import("@/lib/client/plan-pdf");
    if (!(await looksLikePdf(file))) return toast.error(t("planNotPdf"));
    dropDoc();
    setBusy(t("planOpening", { done: 0, total: "…" }));
    try {
      const found = await findPlanSheets(file, (done, total) => setBusy(t("planOpening", { done, total })));
      doc.current = { doc: found.doc, sheets: found.sheets };
      setStep({ kind: "sheets", pages: found.pages, found: found.sheets.map((s) => ({ page: s.page, title: s.title, rooms: s.rooms, pick: true })) });
    } catch {
      toast.error(t("planOpenFailed"));
    } finally {
      setBusy(null);
    }
  };

  /**
   * Read the given pages one by one. A sheet the AI failed to read is tried once
   * more by itself before it counts as not read; a stop for every sheet (offline, hourly limit, AI
   * off, no access) keeps what was read so far and lists the rest as not read.
   */
  const readPages = async (pages: number[]): Promise<{ readings: (PlanReading & { page: number })[]; failed: number[] }> => {
    const readings: (PlanReading & { page: number })[] = [];
    const failed: number[] = [];
    if (!readPlan || !doc.current) return { readings, failed: pages };
    const { sheetPayload } = await import("@/lib/client/plan-pdf");
    for (const [i, page] of pages.entries()) {
      setBusy(t("planReading", { i: i + 1, n: pages.length, page }));
      if (!doc.current) break; // the dialog was left while reading
      const sheet = doc.current.sheets.find((s) => s.page === page)!;
      let fd: FormData;
      try {
        const { meta, tiles } = await sheetPayload(doc.current.doc, sheet, surveyId);
        fd = new FormData();
        fd.set("meta", JSON.stringify(meta));
        tiles.forEach((b, j) => fd.append("tiles", b, `tile-${j + 1}.jpg`));
      } catch {
        failed.push(page);
        continue;
      }
      let r = await settle(() => readPlan(fd));
      // only a failure the server answered is retried: after a dropped connection the first read
      // may still be running there, and a second one would only double the cost
      if (!r.ok && r.error === "aiFailed") {
        setBusy(t("planRetrying", { page }));
        await new Promise((res) => setTimeout(res, 3000));
        r = await settle(() => readPlan(fd));
      }
      const stop = !r.ok ? failure(r.error) ?? (["rateLimited", "aiNotConfigured"].includes(r.error) ? t(`ai_${r.error}`) : r.error === "noAccess" ? tErr("noAccess") : null) : null;
      if (stop) {
        toast.error(stop);
        failed.push(...pages.slice(i));
        break;
      }
      if (!r.ok || !r.data) {
        failed.push(page);
        continue;
      }
      readings.push({ ...r.data, page });
    }
    setBusy(null);
    return { readings, failed };
  };

  const read = async (found: Found[]) => {
    const { readings, failed } = await readPages(found.filter((f) => f.pick).map((f) => f.page));
    setStep({ kind: "review", floors: toFloors(readings), failed });
  };

  /** Read only the pages that failed; the floors already reviewed (and edited) stay as they are. */
  const retryFailed = async () => {
    if (step.kind !== "review") return;
    const { readings, failed } = await readPages(step.failed);
    setStep((s) => {
      if (s.kind !== "review") return s;
      const seen = new Set(s.floors.flatMap((f) => f.rows.map((r) => r.label)));
      const added = toFloors(readings).map((f) => ({ ...f, rows: f.rows.map((r) => (seen.has(r.label) ? { ...r, repeated: true, pick: false } : r)) }));
      return { ...s, floors: [...s.floors, ...added].sort((a, b) => a.page - b.page), failed };
    });
  };

  const back = () => {
    if (step.kind === "review" && doc.current) {
      // back to the sheets of the same file: the pages not read are ticked to try them again
      const failed = new Set(step.failed);
      const sheets = doc.current.sheets;
      return setStep({ kind: "sheets", pages: doc.current.doc.numPages, found: sheets.map((x) => ({ page: x.page, title: x.title, rooms: x.rooms, pick: failed.size ? failed.has(x.page) : true })) });
    }
    dropDoc();
    setStep({ kind: "file" });
  };

  const floors = step.kind === "review" ? step.floors : [];
  const setFloor = (fi: number, patch: Partial<Floor>) =>
    setStep((s) => (s.kind === "review" ? { ...s, floors: s.floors.map((f, j) => (j === fi ? { ...f, ...patch } : f)) } : s));
  const setRow = (fi: number, ri: number, patch: Partial<Row>) => setFloor(fi, { rows: floors[fi].rows.map((r, j) => (j === ri ? { ...r, ...patch } : r)) });

  const ready = (f: Floor, r: Row) => r.pick && r.length_m != null && r.width_m != null && f.height != null;
  const chosen = floors.flatMap((f) => f.rows.filter((r) => ready(f, r)).map((r) => ({ f, r })));
  const area = (rows: Row[]) => rows.reduce((s, r) => s + (r.pick && r.length_m && r.width_m ? r.length_m * r.width_m : 0), 0);

  const add = async () => {
    if (preview || !addRoom) {
      toast(t("aiAdded", { n: chosen.length }));
      return close();
    }
    setBusy(t("planAdding"));
    let added = 0;
    let lost: string | null = null;
    const saved = new Set<Row>();
    for (const { f, r } of chosen) {
      const res = await settle(() =>
        addRoom({
          survey_id: surveyId, name: planRoomName(r), unit_label: f.floor || null, length_m: String(r.length_m), width_m: String(r.width_m), height_m: String(f.height),
          openings_m2: "0", gypsum_ceiling: false, ceiling_board: "normal", paint_walls: true, paint_ceiling: true, wall_zone: "normal",
        }),
      );
      if (res.ok) {
        added++;
        saved.add(r);
      } else if ((lost = failure(res.error))) break;
    }
    setBusy(null);
    if (added === chosen.length) {
      toast.success(t("aiAdded", { n: added }));
      return close();
    }
    // keep the dialog on what is left: rooms already saved are unticked, so pressing «إضافة» again never adds them twice
    setStep((s) => (s.kind === "review" ? { ...s, floors: s.floors.map((fl) => ({ ...fl, rows: fl.rows.map((x) => (saved.has(x) ? { ...x, pick: false, saved: true } : x)) })) } : s));
    toast.error(lost ? `${t("aiAddedSome", { n: added, total: chosen.length })} ${lost}` : t("aiAddedSome", { n: added, total: chosen.length }));
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          // design preview: straight to the review step with the sample sheets
          if (preview && sample) setStep({ kind: "review", floors: toFloors(sample), failed: [10] }); // a failed page too, so its button is checked
          setOpen(true);
        }}
      >
        <FileScan /> {t("planButton")}
      </Button>
      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : busy ? undefined : close())}>
        <DialogContent className="max-w-3xl" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t("planTitle")}</DialogTitle>
            <DialogDescription>{t("planHint")}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            {busy && <p className="rounded-2xl bg-surface-2 p-3 text-[14px]" role="status">{busy}</p>}
            {step.kind === "file" && !busy && (
              <div className="grid gap-2">
                <Button type="button" variant="secondary" className="justify-self-start" asChild>
                  <label className="cursor-pointer">
                    <Upload /> {t("planPick")}
                    <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} />
                  </label>
                </Button>
                <p className="text-[12px] text-muted-foreground">{t("planPrivacy")}</p>
              </div>
            )}
            {step.kind === "sheets" && !busy && (
              <div className="grid gap-2">
                <p className="text-[14px]">{step.found.length ? t("planFound", { n: step.found.length, total: step.pages }) : t("planNone")}</p>
                <ul className="grid gap-2">
                  {step.found.map((f, i) => (
                    <li key={f.page}>
                      <label className={cn("flex items-center gap-2 rounded-2xl border p-3 text-[14px]", f.pick ? "border-primary/50 bg-primary/5" : "border-border")}>
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--primary)]"
                          checked={f.pick}
                          onChange={() => setStep({ ...step, found: step.found.map((x, j) => (j === i ? { ...x, pick: !x.pick } : x)) })}
                        />
                        <span className="font-semibold" dir="ltr">{f.title}</span>
                        <span className="text-muted-foreground">· {t("planSheetInfo", { page: f.page, rooms: f.rooms })}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {step.kind === "review" && !busy && (
              <div className="grid gap-4">
                {step.failed.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-warning-soft p-3 text-[13px]">
                    <span>{t("planFailedPages", { pages: step.failed.join(sep) })}</span>
                    {(
                      <Button size="sm" variant="secondary" onClick={preview ? () => toast(t("planRetryFailed", { n: step.failed.length })) : retryFailed}>
                        <FileScan /> {t("planRetryFailed", { n: step.failed.length })}
                      </Button>
                    )}
                  </div>
                )}
                {floors.length === 0 && <p className="text-sm text-muted-foreground">{t("aiNoRooms")}</p>}
                {floors.map((f, fi) => (
                  <section key={`${f.page}-${fi}`} className="grid gap-2 rounded-2xl border border-border p-3">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div className="grid gap-1">
                        <Input aria-label={t("planFloorName")} value={f.floor} maxLength={60} onChange={(e) => setFloor(fi, { floor: e.target.value })} className="h-9 max-w-64 font-bold" />
                        <span className="text-[12px] text-muted-foreground">{t("planFloorArea", { area: fmt.number(area(f.rows), 1), page: f.page })}</span>
                      </div>
                      <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                        {t("planHeight")}
                        <Input
                          inputMode="decimal"
                          dir="ltr"
                          className={cn("h-9 w-24 font-latin", f.height == null && "border-warning")}
                          defaultValue={f.height ?? ""}
                          onChange={(e) => setFloor(fi, { height: roomSize(e.target.value, 30) })}
                        />
                      </label>
                    </div>
                    <ul className="grid gap-1.5">
                      {f.rows.map((r, ri) => (
                        <li key={ri} className={cn("grid gap-2 rounded-xl border p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", r.pick ? "border-primary/40 bg-primary/5" : "border-border")}>
                          <div className="grid gap-1">
                            <label className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
                              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={r.pick} disabled={r.saved} onChange={() => setRow(fi, ri, { pick: !r.pick })} />
                              {r.name}
                              <bdi dir="ltr" className="font-latin text-[12px] font-normal text-muted-foreground">{r.label}</bdi>
                              {r.saved ? (
                                <Badge tone="success"><CircleCheck className="size-3.5" /> {t("planSaved")}</Badge>
                              ) : r.repeated ? (
                                <Badge tone="warning">{t("planRepeated")}</Badge>
                              ) : r.open_space ? (
                                <Badge tone="warning"><CircleAlert className="size-3.5" /> {t("planOpen")}</Badge>
                              ) : r.confirmed ? (
                                <Badge tone="success"><CircleCheck className="size-3.5" /> {t("planConfirmed")}</Badge>
                              ) : (
                                <Badge tone="warning"><CircleAlert className="size-3.5" /> {t("planCheck")}</Badge>
                              )}
                            </label>
                            {r.notes.length > 0 && <p className="text-[12px] text-muted-foreground">{r.notes.join(" · ")}</p>}
                          </div>
                          <div className="grid grid-cols-[5rem_5rem_auto] items-center gap-x-2 gap-y-0.5">
                            {(["length_m", "width_m"] as const).map((k) => (
                              <span key={`l-${k}`} className="text-[11px] font-semibold text-muted-foreground">{t(`ai_${k}`)}</span>
                            ))}
                            <span />
                            {(["length_m", "width_m"] as const).map((k) => (
                              <Input
                                key={k}
                                inputMode="decimal"
                                dir="ltr"
                                aria-label={`${r.name} — ${t(`ai_${k}`)}`}
                                placeholder={t(`ai_${k}`)}
                                defaultValue={r[k] ?? ""}
                                onChange={(e) => setRow(fi, ri, { [k]: roomSize(e.target.value, 200) })}
                                className={cn("h-9 font-latin", r[k] == null && "border-warning")}
                              />
                            ))}
                            <span className="text-[12px] tabular-nums text-muted-foreground">
                              {r.length_m && r.width_m ? t("planArea", { area: fmt.number(r.length_m * r.width_m, 1) }) : "—"}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {f.conflicts.length > 0 && (
                      <ul className="grid list-disc gap-1 rounded-xl bg-warning-soft px-6 py-2 text-[12px]">
                        {f.conflicts.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    )}
                  </section>
                ))}
                {floors.length > 0 && (
                  <p className="text-[14px] font-bold">{t("planTotal", { area: fmt.number(floors.reduce((s, f) => s + area(f.rows), 0), 1) })}</p>
                )}
                <p className="text-[12px] text-muted-foreground">{t("planReview")}</p>
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            {step.kind === "sheets" && (
              <Button onClick={() => read(step.found)} loading={!!busy} disabled={!step.found.some((f) => f.pick)}>
                <FileScan /> {t("planRead", { n: step.found.filter((f) => f.pick).length })}
              </Button>
            )}
            {step.kind === "review" && (
              <Button onClick={add} loading={!!busy} disabled={chosen.length === 0}>
                {t("aiAdd", { n: chosen.length })}
              </Button>
            )}
            {step.kind !== "file" && (
              <Button variant="ghost" onClick={back} disabled={!!busy}>
                {t("aiBack")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
