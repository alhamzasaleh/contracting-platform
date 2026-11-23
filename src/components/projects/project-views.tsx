"use client";
import { DocNo } from "@/components/doc-no";
import { Camera, Check, CheckCircle2, ExternalLink, FileBadge, FileText, HardHat, MapPin, MessageSquare, Phone, Send, ShoppingCart, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import * as React from "react";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { useFormatter } from "@/components/formatter-provider";
import { useActionRunner } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { ActionResult } from "@/lib/actions";
import { shrinkImage } from "@/lib/client/image";
import { isNetworkError, outboxAdd } from "@/lib/client/outbox";
import { toast } from "sonner";
import type { ProjectDetail, ProjectListItem, StageView } from "@/lib/data/projects";
import { coordsFromMapLink, currentStage, distanceMeters, overallProgress } from "@/lib/execution";
import type { StageStatus } from "@/lib/supabase/database.types";
import { cn, ltr } from "@/lib/utils";

const TONE: Record<StageStatus, "neutral" | "primary" | "warning" | "success"> = { pending: "neutral", in_progress: "primary", awaiting_client: "warning", confirmed: "success" };

function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-2.5 overflow-hidden rounded-full bg-surface-sunken", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${value}%` }} />
    </div>
  );
}

// --- List ---------------------------------------------------------------------------

export function ProjectsList({ projects, base = "" }: { projects: ProjectListItem[]; base?: string }) {
  const t = useTranslations("projects");
  const tp = useTranslations("pricing");
  const { fmt } = useFormatter();
  if (!projects.length) return <EmptyState icon={<HardHat />} title={t("emptyTitle")} description={t("emptyBody")} />;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {projects.map((p) => (
        <li key={p.id}>
          <Link href={`${base}/projects/${p.number}`} className="grid gap-3 rounded-3xl border border-border bg-surface p-5 transition-colors hover:border-primary/40">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[16px] font-bold">{p.client}</p>
                <p className="text-[13px] text-muted-foreground">
                  {tp(`kind_${p.service}`)} · <DocNo>{p.number}</DocNo>
                </p>
              </div>
              {p.newNotes > 0 && (
                <Badge tone="warning">
                  <MessageSquare className="size-3" /> {t("newNotes", { n: p.newNotes })}
                </Badge>
              )}
              {p.done && <Badge tone="success">{t("handedOver")}</Badge>}
            </div>
            <div className="grid gap-1.5">
              <div className="flex justify-between text-[13px]">
                <span>{p.stage ?? t("allDone")}</span>
                <span className="font-latin font-bold tabular-nums">{p.progress}%</span>
              </div>
              <Progress value={p.progress} />
            </div>
            <p className="text-[12px] text-muted-foreground">{p.lastVisit ? t("lastVisit", { when: fmt.relative(p.lastVisit) }) : t("noVisits")}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// --- Project (execution) ------------------------------------------------------------

export type ProjectActions = {
  checkIn: (i: Record<string, unknown>) => Promise<ActionResult>;
  uploadPhoto: (fd: FormData) => Promise<ActionResult<{ path: string }>>;
  saveProgress: (i: Record<string, unknown>) => Promise<ActionResult>;
  draftReport: (i: Record<string, unknown>) => Promise<ActionResult<{ text: string }>>;
  sendStage: (i: Record<string, unknown>) => Promise<ActionResult>;
  updateNote: (i: Record<string, unknown>) => Promise<ActionResult>;
};

export function ProjectView({ data, actions, base = "" }: { data: ProjectDetail; actions?: ProjectActions; base?: string }) {
  const tw = useTranslations("wa");
  const t = useTranslations("projects");
  const tp = useTranslations("pricing");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const [locating, setLocating] = React.useState(false);
  const [gpsNote, setGpsNote] = React.useState<string | null>(null);
  const cur = currentStage(data.stages);
  const [open, setOpen] = React.useState<string | null>(cur?.id ?? null);
  const site = coordsFromMapLink(data.client.location_url);
  const progress = overallProgress(data.stages);
  const final = data.stages.find((s) => s.is_final && s.status === "confirmed");
  const newNotes = data.notes.filter((n) => n.status === "new").length;

  const checkIn = () => {
    if (!actions) return;
    setGpsNote(null);
    const send = (pos: GeolocationPosition | null) =>
      run(() =>
        actions.checkIn({
          contract_id: data.contract.id,
          latitude: pos ? pos.coords.latitude : null,
          longitude: pos ? pos.coords.longitude : null,
          accuracy_m: pos ? pos.coords.accuracy : null,
          note: null,
        }),
      );
    if (!("geolocation" in navigator)) {
      setGpsNote(t("gpsUnavailable"));
      return send(null);
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        send(pos);
      },
      () => {
        setLocating(false);
        setGpsNote(t("gpsDenied"));
        send(null);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  return (
    <div className="grid gap-5 [&>*]:min-w-0">
      {/* header */}
      <section className="grid gap-4 rounded-3xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[20px] font-extrabold">{data.client.name}</p>
            <p className="text-[13px] text-muted-foreground">
              {tp(`kind_${data.contract.service}`)} · <DocNo>{data.contract.number}</DocNo>
              {(data.client.city || data.client.district) && ` · ${[data.client.city, data.client.district].filter(Boolean).join(" — ")}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.client.location_url && (
              <Button asChild variant="secondary" size="sm">
                <a href={data.client.location_url} target="_blank" rel="noopener noreferrer">
                  <MapPin /> {t("openMap")}
                </a>
              </Button>
            )}
            {data.client.phone && (
              <Button asChild variant="secondary" size="sm">
                <a href={`tel:+${data.client.phone}`}>
                  <Phone /> {t("call")}
                </a>
              </Button>
            )}
            <WhatsAppButton
              phone={data.client.phone}
              label={tw("btnOpen")}
              text={tw("general", { name: data.client.name, contract: ltr(data.contract.number), org: data.orgName ?? "" })}
            />
            <Button asChild variant="secondary" size="sm">
              <Link href={`${base}/contracts/${data.contract.number}`}>
                <FileText /> {t("openContract")}
              </Link>
            </Button>
            {data.canPurchase && (
              <Button asChild variant="secondary" size="sm">
                <Link href={`${base}/purchases/new?project=${data.contract.number}`}>
                  <ShoppingCart /> {t("recordPurchase")}
                </Link>
              </Button>
            )}
            {final && (
              <Button asChild variant="secondary" size="sm">
                <Link href={`${base}/print/handover/${data.contract.number}`} target="_blank">
                  <FileBadge /> {t("certificate")}
                </Link>
              </Button>
            )}
          </div>
        </div>
        <div className="grid gap-1.5">
          <div className="flex justify-between text-[14px]">
            <span className="font-bold">{t("overall")}</span>
            <span className="font-latin font-bold tabular-nums">{progress}%</span>
          </div>
          <Progress value={progress} />
        </div>
        {data.canManage && (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" loading={locating || pending} onClick={checkIn}>
              <MapPin /> {t("checkIn")}
            </Button>
            <p className="text-[12px] text-muted-foreground">{t("checkInHint")}</p>
          </div>
        )}
        {gpsNote && <p className="rounded-2xl bg-warning-soft px-4 py-2 text-[13px]">{gpsNote}</p>}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px] [&>*]:min-w-0">
        {/* stages */}
        <section className="grid content-start gap-3">
          <p className="text-[15px] font-bold">{t("stages")}</p>
          {data.stages.map((s) => (
            <StageCard key={s.id} stage={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} data={data} actions={actions} />
          ))}
        </section>

        <aside className="grid content-start gap-5">
          {/* client notes */}
          <section className="grid gap-3 rounded-3xl border border-border bg-surface p-5">
            <p className="flex items-center gap-2 text-[15px] font-bold">
              <MessageSquare className="size-4" /> {t("clientNotes")}
              {newNotes > 0 && <Badge tone="warning">{newNotes}</Badge>}
            </p>
            {data.notes.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">{t("noNotes")}</p>
            ) : (
              data.notes.map((n) => <NoteCard key={n.id} note={n} stages={data.stages} canManage={data.canManage} update={actions?.updateNote} />)
            )}
          </section>

          {/* visits */}
          <section className="grid gap-2 rounded-3xl border border-border bg-surface p-5">
            <p className="text-[15px] font-bold">{t("visits")}</p>
            {data.visits.length === 0 && <p className="text-[13px] text-muted-foreground">{t("noVisits")}</p>}
            <ul className="grid gap-2">
              {data.visits.map((v) => {
                const far = site && v.latitude != null && v.longitude != null ? distanceMeters(site, { lat: v.latitude, lng: v.longitude }) : null;
                return (
                  <li key={v.id} className="grid gap-0.5 rounded-2xl bg-surface-sunken/60 px-3 py-2 text-[13px]">
                    <p className="font-bold">
                      {fmt.dateTime(v.checked_in_at)}
                      {v.by && <span className="font-normal text-muted-foreground"> · {v.by}</span>}
                    </p>
                    {v.latitude != null ? (
                      <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
                        <a className="inline-flex items-center gap-1 text-primary underline" href={`https://maps.google.com/?q=${v.latitude},${v.longitude}`} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="size-3" /> {t("onMap")}
                        </a>
                        {v.accuracy_m != null && <span>± {fmt.number(v.accuracy_m, 0)} m</span>}
                        {far != null && <span className={cn(far > 300 && "font-bold text-danger")}>{t("fromSite", { m: fmt.number(far, 0) })}</span>}
                      </p>
                    ) : (
                      <p className="text-danger">{t("noLocation")}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* payments due */}
          {data.payments.length > 0 && (
            <section className="grid gap-2 rounded-3xl border border-border bg-surface p-5">
              <p className="text-[15px] font-bold">{t("payments")}</p>
              {data.payments.map((p) => (
                <p key={p.seq} className="flex items-center justify-between gap-2 text-[13px]">
                  <span>
                    {p.seq}. {p.label}
                  </span>
                  <Badge tone={p.status === "paid" ? "success" : p.status === "requested" ? "warning" : "neutral"}>{t(`pay_${p.status}` as "pay_pending")}</Badge>
                </p>
              ))}
            </section>
          )}
          <Link href={`${base}/contracts/${data.contract.number}`} className="text-[13px] text-primary underline">
            {t("openContract")}
          </Link>
        </aside>
      </div>
    </div>
  );
}

function StageCard({ stage: s, open, onToggle, data, actions }: { stage: StageView; open: boolean; onToggle: () => void; data: ProjectDetail; actions?: ProjectActions }) {
  const tw = useTranslations("wa");
  const t = useTranslations("projects");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const [progress, setProgress] = React.useState(s.progress);
  const [note, setNote] = React.useState("");
  // a photo is either uploaded (path) or, when there's no connection, kept on the device (blob)
  const [photos, setPhotos] = React.useState<{ key: string; path?: string; blob?: Blob; preview: string }[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [visible, setVisible] = React.useState(true);
  const [report, setReport] = React.useState(s.report ?? "");
  const [aiUsed, setAiUsed] = React.useState(s.report_ai);
  const [drafting, setDrafting] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const camera = React.useRef<HTMLInputElement>(null);
  const locked = s.status === "confirmed" || !data.canManage;

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length || !actions) return;
    setUploading(true);
    setErr(null);
    for (const f of [...files].slice(0, 12 - photos.length)) {
      const small = await shrinkImage(f, 1800);
      const local = { key: crypto.randomUUID(), preview: URL.createObjectURL(small) };
      if (!navigator.onLine) {
        setPhotos((p) => [...p, { ...local, blob: small }]);
        continue;
      }
      const fd = new FormData();
      fd.set("contract_id", data.contract.id);
      fd.set("file", small);
      try {
        const r = await actions.uploadPhoto(fd);
        if (r.ok && r.data) setPhotos((p) => [...p, { ...local, path: r.data!.path }]);
        else setErr(t("photoFailed"));
      } catch (e) {
        if (isNetworkError(e)) setPhotos((p) => [...p, { ...local, blob: small }]);
        else setErr(t("photoFailed"));
      }
    }
    setUploading(false);
  };

  return (
    <article className={cn("rounded-3xl border bg-surface", open ? "border-primary/40" : "border-border")}>
      <button type="button" onClick={onToggle} className="grid w-full gap-2 p-5 text-start" aria-expanded={open}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-bold">
            {s.status === "confirmed" ? <CheckCircle2 className="size-5 text-success" /> : <span className="flex size-6 items-center justify-center rounded-full bg-surface-sunken text-[12px]">{s.seq}</span>}
            {s.name}
            {s.is_final && <Badge tone="info">{t("finalStage")}</Badge>}
          </p>
          <Badge tone={TONE[s.status]}>{t(`st_${s.status}`)}</Badge>
        </div>
        <Progress value={s.status === "confirmed" ? 100 : s.progress} />
        {s.status === "confirmed" && s.confirmed_at && (
          <p className="text-[12px] text-success">{t("confirmedBy", { name: s.confirmed_name ?? "", date: fmt.dateTime(s.confirmed_at) })}</p>
        )}
      </button>

      {open && (
        <div className="grid gap-4 border-t border-border p-5">
          {!locked && (
            <div className="grid gap-3 rounded-2xl bg-surface-sunken/50 p-4">
              <p className="text-[14px] font-bold">{t("addUpdate")}</p>
              <label className="grid gap-2 text-[13px]">
                <span className="flex justify-between">
                  {t("progress")} <span className="font-latin font-bold tabular-nums">{progress}%</span>
                </span>
                <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="h-8 accent-[var(--primary)]" />
              </label>
              <Field id={`n-${s.id}`} label={t("note")} optional={t("optional")}>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="secondary" loading={uploading} onClick={() => camera.current?.click()}>
                  <Camera /> {t("addPhotos")}
                </Button>
                <input ref={camera} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
                {photos.map((p) => (
                  <span key={p.key} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.preview} alt="" className="size-16 rounded-xl object-cover" />
                    <button type="button" aria-label={t("removePhoto")} onClick={() => setPhotos((x) => x.filter((y) => y.key !== p.key))} className="absolute -end-1 -top-1 rounded-full bg-ink p-0.5 text-ink-foreground">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              {err && <p className="text-[13px] text-danger">{err}</p>}
              <label className="flex items-center justify-between gap-3 text-[13px]">
                <span>{t("visibleToClient")}</span>
                <Switch checked={visible} onCheckedChange={setVisible} aria-label={t("visibleToClient")} />
              </label>
              <Button
                className="justify-self-start"
                loading={pending}
                disabled={uploading}
                onClick={async () => {
                  const draft = { contractId: data.contract.id, stageId: s.id, label: s.name, progress, note: note.trim() || null, visible, paths: photos.flatMap((p) => (p.path ? [p.path] : [])), blobs: photos.flatMap((p) => (p.blob ? [p.blob] : [])) };
                  const keepOffline = async () => {
                    await outboxAdd(draft);
                    setNote("");
                    setPhotos([]);
                    toast(t("savedOffline"));
                  };
                  if (actions && (!navigator.onLine || draft.blobs.length)) return keepOffline();
                  run(
                    actions &&
                      (() =>
                        actions.saveProgress({ stage_id: s.id, progress, note: draft.note, photos: draft.paths, visible }).catch(async (e: unknown): Promise<ActionResult> => {
                          // the connection dropped while sending: keep it on the device instead of losing it
                          if (!isNetworkError(e)) throw e;
                          await outboxAdd(draft);
                          return { ok: true };
                        })),
                    {
                      onSuccess: () => {
                        setNote("");
                        setPhotos([]);
                      },
                    },
                  );
                }}
              >
                <Check /> {t("saveUpdate")}
              </Button>
            </div>
          )}

          {/* report to the client */}
          {!locked && (
            <div className="grid gap-3 rounded-2xl border border-primary/30 p-4">
              <p className="text-[14px] font-bold">{s.is_final ? t("finalReportTitle") : t("reportTitle")}</p>
              <Textarea value={report} onChange={(e) => setReport(e.target.value)} rows={4} placeholder={t("reportPlaceholder")} />
              <div className="flex flex-wrap gap-2">
                {data.aiEnabled && (
                  <Button
                    type="button"
                    variant="soft"
                    loading={drafting}
                    onClick={async () => {
                      if (!actions) return;
                      setDrafting(true);
                      const r = await actions.draftReport({ stage_id: s.id });
                      setDrafting(false);
                      if (r.ok && r.data) {
                        setReport(r.data.text);
                        setAiUsed(true);
                      } else setErr(t("aiFailed"));
                    }}
                  >
                    <Sparkles /> {t("aiDraft")}
                  </Button>
                )}
                <Button loading={pending} disabled={!report.trim()} onClick={() => run(actions && (() => actions.sendStage({ stage_id: s.id, report: report.trim(), ai: aiUsed })))}>
                  <Send /> {s.status === "awaiting_client" ? t("resend") : t("sendToClient")}
                </Button>
                {s.status === "awaiting_client" && (
                  <WhatsAppButton
                    phone={data.client.phone}
                    label={tw("btnNotify")}
                    text={tw("stage", { name: data.client.name, stage: s.name, contract: ltr(data.contract.number), org: data.orgName ?? "" })}
                  />
                )}
              </div>
              <p className="text-[12px] text-muted-foreground">{s.is_final ? t("finalHint") : t("sendHint")}</p>
            </div>
          )}
          {locked && s.report && <p className="whitespace-pre-line rounded-2xl bg-surface-sunken/60 p-4 text-[14px] leading-7">{s.report}</p>}

          {/* history */}
          {s.updates.length > 0 && (
            <ul className="grid gap-3">
              {s.updates.map((u) => (
                <li key={u.id} className="grid gap-2 border-s-2 border-border ps-3 text-[13px]">
                  <p className="text-muted-foreground">
                    {fmt.dateTime(u.created_at)} · <span className="font-latin font-bold tabular-nums">{u.progress}%</span>
                    {!u.visible && ` · ${t("internal")}`}
                  </p>
                  {u.note && <p>{u.note}</p>}
                  {u.photos.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {u.photos.map((p) =>
                        p.url ? (
                          <a key={p.path} href={p.url} target="_blank" rel="noopener noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.url} alt="" className="size-20 rounded-xl object-cover" />
                          </a>
                        ) : null,
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

function NoteCard({ note: n, stages, canManage, update }: { note: ProjectDetail["notes"][number]; stages: StageView[]; canManage: boolean; update?: (i: Record<string, unknown>) => Promise<ActionResult> }) {
  const t = useTranslations("projects");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const [reply, setReply] = React.useState(n.reply ?? "");
  const stage = stages.find((s) => s.id === n.stage_id);
  return (
    <div className={cn("grid gap-2 rounded-2xl p-3 text-[13px]", n.status === "new" ? "bg-warning-soft/70" : "bg-surface-sunken/60")}>
      <p className="text-[12px] text-muted-foreground">
        {fmt.dateTime(n.created_at)}
        {stage && ` · ${stage.name}`}
      </p>
      <p className="whitespace-pre-line">{n.body}</p>
      {n.photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {n.photos.map((p) =>
            p.url ? (
              <a key={p.path} href={p.url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className="size-16 rounded-xl object-cover" />
              </a>
            ) : null,
          )}
        </div>
      )}
      {canManage && n.status !== "resolved" ? (
        <>
          <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder={t("replyPlaceholder")} />
          <div className="flex gap-2">
            <Button size="sm" loading={pending} onClick={() => run(update && (() => update({ id: n.id, status: "resolved", reply: reply.trim() || null })))}>
              <Check /> {t("resolve")}
            </Button>
            {n.status === "new" && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(update && (() => update({ id: n.id, status: "seen", reply: reply.trim() || null })))}>
                {t("markSeen")}
              </Button>
            )}
          </div>
        </>
      ) : (
        n.reply && <p className="rounded-xl bg-surface px-3 py-2">↳ {n.reply}</p>
      )}
    </div>
  );
}
