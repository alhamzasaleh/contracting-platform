"use client";
import { Camera, CheckCircle2, Send, ShieldCheck, Wrench, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import { shrinkImage } from "@/lib/client/image";
import type { PortalWarranty } from "@/lib/portal";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  open: "bg-warning-soft", in_progress: "bg-info-soft text-info", resolved: "bg-primary-soft text-primary", closed: "bg-success-soft text-success", rejected: "bg-surface-sunken text-muted-foreground",
};

/** §3.13 warranty on the client page: end date, open a maintenance request, follow it, confirm the fix. */
export function WarrantySection({ w, number, token, onAdd, onConfirm }: {
  w: PortalWarranty; number: string; token: string;
  onAdd?: (fd: FormData) => Promise<ActionResult>; onConfirm?: (i: Record<string, unknown>) => Promise<ActionResult>;
}) {
  const t = useTranslations("warranty");
  const { fmt } = useFormatter();
  const router = useRouter();
  const [body, setBody] = React.useState("");
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

  const send = () =>
    start(async () => {
      setMsg(null);
      if (!onAdd) return;
      const fd = new FormData();
      fd.set("number", number);
      fd.set("token", token);
      fd.set("body", body.trim());
      files.forEach((f) => fd.append("photos", f.file));
      const r = await onAdd(fd);
      if (r.ok) {
        setBody("");
        setFiles([]);
        setMsg({ ok: true, text: t("sent", { number: r.message ?? "" }) });
        router.refresh();
      } else setMsg({ ok: false, text: r.error === "rateLimited" ? t("errRate") : r.error === "warrantyEnded" ? t("ended") : t("errGeneric") });
    });

  const confirm = (id: string) =>
    start(async () => {
      if (!onConfirm) return;
      const r = await onConfirm({ number, token, request_id: id });
      if (r.ok) router.refresh();
      else setMsg({ ok: false, text: t("errGeneric") });
    });

  return (
    <section className="grid gap-4 rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="warranty-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="warranty-title" className="flex items-center gap-2 text-[18px] font-bold">
          <ShieldCheck className="size-5 text-primary" /> {t("title")}
        </h2>
        {w.warranty_end && (
          <span className={cn("rounded-full px-3 py-1 text-[13px] font-semibold", w.active ? "bg-success-soft text-success" : "bg-surface-sunken text-muted-foreground")}>
            {w.active ? t("until", { date: fmt.date(w.warranty_end) }) : t("endedOn", { date: fmt.date(w.warranty_end) })}
          </span>
        )}
      </div>

      {w.active ? (
        <div className="grid gap-3">
          <p className="text-[13px] text-muted-foreground">{t("hint")}</p>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} aria-label={t("describe")} placeholder={t("describe")} />
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
          <Button className="justify-self-start" loading={pending} disabled={!body.trim()} onClick={send}>
            <Send /> {t("send")}
          </Button>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">{t("ended")}</p>
      )}
      {msg && <p className={cn("text-[13px]", msg.ok ? "text-success" : "text-danger")}>{msg.text}</p>}

      {w.requests.length > 0 && (
        <ul className="grid gap-2 border-t border-border pt-4">
          {w.requests.map((r) => (
            <li key={r.id} className="grid gap-2 rounded-2xl bg-surface-sunken/50 p-4 text-[13px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-semibold">
                  <Wrench className="size-4 text-primary" />
                  <bdi dir="ltr" className="font-latin">{r.number}</bdi>
                  <span className="font-normal text-muted-foreground">· {fmt.date(r.created_at)}</span>
                </span>
                <span className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-semibold", TONE[r.status])}>{t(`st_${r.status}`)}</span>
              </div>
              <p className="whitespace-pre-line">{r.body}</p>
              {r.photos.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {r.photos.map((u) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={u} src={u} alt="" className="size-14 rounded-xl object-cover" />
                  ))}
                </div>
              )}
              {r.reply && <p className="rounded-xl bg-surface px-3 py-2">↳ {r.reply}</p>}
              {r.status === "resolved" && (
                <Button size="sm" className="justify-self-start" loading={pending} onClick={() => confirm(r.id)}>
                  <CheckCircle2 /> {t("confirm")}
                </Button>
              )}
              {r.client_confirmed_at && <p className="text-[12px] text-success">{t("confirmedOn", { date: fmt.dateTime(r.client_confirmed_at) })}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
