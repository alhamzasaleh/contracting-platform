"use client";
import { Plus, ShieldCheck, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { useFormatter } from "@/components/formatter-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import type { ActionResult } from "@/lib/actions";
import type { MaintenanceItem, MaintenancePageData } from "@/lib/data/maintenance";
import { companyPaidRepairs } from "@/lib/finance";
import type { MaintenanceStatus } from "@/lib/supabase/database.types";
import { ltr } from "@/lib/utils";

type Actions = { update: (i: unknown) => Promise<ActionResult>; create: (i: unknown) => Promise<ActionResult> };
const STATUSES: MaintenanceStatus[] = ["open", "in_progress", "resolved", "closed", "rejected"];
const TONE = { open: "warning", in_progress: "info", resolved: "primary", closed: "success", rejected: "neutral" } as const;

/** §3.13 maintenance requests during warranty + the list of warranties. */
export function MaintenanceView({ data, focus, contract = null, actions, base = "" }: { data: MaintenancePageData; focus: string | null; contract?: string | null; actions?: Actions; base?: string }) {
  const t = useTranslations("maintenance");
  const { fmt } = useFormatter();
  const [filter, setFilter] = React.useState<"active" | "all">("active");
  const active = (s: MaintenanceStatus) => s === "open" || s === "in_progress" || s === "resolved";
  // ?contract=C-… (from the project / contract page): only that project's requests and warranty
  const scoped = contract ? data.requests.filter((r) => r.contract === contract) : data.requests;
  const warranties = contract ? data.warranties.filter((w) => w.number === contract) : data.warranties;
  const list = scoped.filter((r) => filter === "all" || active(r.status) || r.number === focus);
  const year = new Date().getFullYear().toString();
  // the numbers follow the ?contract= filter too
  // what the company pays (covered by the warranty); repairs charged to the client are not our cost
  const cost = companyPaidRepairs(scoped.filter((r) => r.created_at.startsWith(year))).reduce((s, r) => s + r.cost, 0);
  const kpis = [
    { label: t("kOpen"), value: scoped.filter((r) => r.status === "open").length },
    { label: t("kProgress"), value: scoped.filter((r) => r.status === "in_progress").length },
    { label: t("kAwaiting"), value: scoped.filter((r) => r.status === "resolved").length },
  ];

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-3xl border border-border bg-surface p-4">
            <p className="text-[13px] text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-[26px] font-extrabold">{fmt.number(k.value)}</p>
          </div>
        ))}
        <div className="rounded-3xl border border-border bg-surface p-4">
          <p className="text-[13px] text-muted-foreground">{t("kCost", { year })}</p>
          <p className="mt-1 text-[clamp(1rem,5vw,1.375rem)] font-extrabold break-words">{fmt.money(cost)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented name={t("filter")} value={filter} onChange={setFilter} options={[{ value: "active", label: t("fActive") }, { value: "all", label: t("fAll") }]} />
        {contract && (
          <Link href={`${base}/maintenance`} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[13px] hover:border-primary/50">
            {t("onlyProject")} <bdi dir="ltr" className="font-latin">{contract}</bdi> <X className="size-3.5" aria-label={t("showAll")} />
          </Link>
        )}
        {data.canManage && actions && <NewRequest warranties={warranties.filter((w) => w.active)} create={actions.create} />}
      </div>

      {list.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="grid gap-4">
          {list.map((r) => (
            <RequestCard key={r.id} r={r} data={data} open={r.number === focus} actions={actions} base={base} />
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" /> {t("warranties")}
          </CardTitle>
          <CardDescription>{t("warrantiesHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {warranties.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noWarranties")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {warranties.map((w) => (
                <li key={w.number} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <span>
                    {/* the project page (projects.view, like this page) — the contract page needs quotes.view */}
                    <Link href={`${base}/projects/${w.number}`} className="hover:underline">
                      <bdi dir="ltr" className="font-latin">{w.number}</bdi>
                    </Link>{" "}
                    · {w.client}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground">{t("handover", { date: fmt.date(w.handover_at) })}</span>
                    <Badge tone={w.active ? "success" : "neutral"}>{w.active ? t("until", { date: fmt.date(w.warranty_end) }) : t("ended")}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RequestCard({ r, data, open, actions, base }: { r: MaintenanceItem; data: MaintenancePageData; open: boolean; actions?: Actions; base: string }) {
  const t = useTranslations("maintenance");
  const tw = useTranslations("wa");
  const tc = useTranslations("common");
  const { fmt } = useFormatter();
  const router = useRouter();
  const [edit, setEdit] = React.useState(open);
  const [v, setV] = React.useState({ status: r.status, assigned_to: r.assigned_to, covered: r.covered, cost: String(r.cost || ""), reply: r.reply ?? "", internal_note: r.internal_note ?? "" });
  const [pending, start] = React.useTransition();
  const save = () =>
    start(async () => {
      if (!actions) return void toast(tc("saved"));
      const res = await actions.update({ id: r.id, status: v.status, assigned_to: v.assigned_to, covered: v.covered, cost: Number(v.cost || 0), reply: v.reply || null, internal_note: v.internal_note || null });
      if (res.ok) {
        toast.success(tc("saved"));
        setEdit(false);
        router.refresh();
      } else toast.error(tc("error"));
    });
  const assignee = data.members.find((m) => m.id === r.assigned_to)?.name;
  return (
    <article id={r.number} className="grid gap-3 rounded-3xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-bold">
            <Wrench className="size-4 text-primary" />
            <bdi dir="ltr" className="font-latin">{r.number}</bdi>
            <span className="font-normal text-muted-foreground">
              ·{" "}
              <Link href={`${base}/projects/${r.contract}`} className="hover:underline">
                <bdi dir="ltr" className="font-latin">{r.contract}</bdi>
              </Link>{" "}
              · {r.client}
            </span>
          </p>
          <p className="text-[12px] text-muted-foreground">
            {fmt.dateTime(r.created_at)} · {t(r.source === "client" ? "fromClient" : "fromStaff")}
            {assignee && ` · ${t("assignedTo", { name: assignee })}`}
            {r.cost > 0 && ` · ${fmt.money(r.cost)}${r.covered ? "" : ` (${t("charged")})`}`}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          {r.status === "resolved" && (
            <WhatsAppButton phone={r.client_phone} label={tw("btnNotify")} text={tw("maintenance", { name: r.client, number: ltr(r.number), org: data.orgName ?? "" })} />
          )}
          {/* closed by staff without the client's confirmation, or rejected: tell him, with our reply */}
          {(r.status === "rejected" || (r.status === "closed" && r.closed_by && !r.client_confirmed_at)) && (
            <WhatsAppButton
              phone={r.client_phone}
              label={tw("btnNotify")}
              text={tw(r.status === "rejected" ? "maintenanceRejected" : "maintenanceClosed", {
                name: r.client, number: ltr(r.number), org: data.orgName ?? "", reply: r.reply ? tw("maintenanceReply", { reply: r.reply }) : "",
              })}
            />
          )}
          <Badge tone={TONE[r.status]}>{t(`st_${r.status}`)}</Badge>
        </span>
      </div>
      <p className="whitespace-pre-line text-sm">{r.body}</p>
      {r.photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {r.photos.map((u) => (
            <a key={u} href={u} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" className="size-20 rounded-xl object-cover" />
            </a>
          ))}
        </div>
      )}
      {r.reply && !edit && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">↳ {r.reply}</p>}
      {r.client_confirmed_at && <p className="text-[12px] text-success">{t("confirmed", { date: fmt.dateTime(r.client_confirmed_at) })}</p>}
      {(r.status === "closed" || r.status === "rejected") && r.closed_by && r.closed_at && (
        <p className="text-[12px] text-muted-foreground">
          {t(r.status === "rejected" ? "rejectedBy" : "closedBy", { name: data.members.find((m) => m.id === r.closed_by)?.name ?? t("ourTeam"), date: fmt.dateTime(r.closed_at) })}
        </p>
      )}

      {data.canManage &&
        (edit ? (
          <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
            <Field id={`st-${r.id}`} label={t("status")}>
              <NativeSelect value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as MaintenanceStatus })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`st_${s}`)}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field id={`as-${r.id}`} label={t("assign")}>
              <NativeSelect value={v.assigned_to ?? ""} onChange={(e) => setV({ ...v, assigned_to: e.target.value || null })}>
                <option value="">{t("nobody")}</option>
                {data.members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field id={`co-${r.id}`} label={t("cost")} hint={t("costHint")}>
              <Input inputMode="decimal" value={v.cost} onChange={(e) => setV({ ...v, cost: e.target.value.replace(/[^\d.]/g, "") })} dir="ltr" />
            </Field>
            <label className="flex items-center justify-between gap-3 self-end rounded-2xl border border-border px-4 py-3 text-sm">
              <span>{t("covered")}</span>
              <Switch checked={v.covered} onCheckedChange={(c) => setV({ ...v, covered: c })} aria-label={t("covered")} />
            </label>
            <Field id={`re-${r.id}`} label={t("reply")} hint={t("replyHint")} className="sm:col-span-2">
              <Textarea rows={2} maxLength={1000} value={v.reply} onChange={(e) => setV({ ...v, reply: e.target.value })} />
            </Field>
            <Field id={`in-${r.id}`} label={t("internal")} className="sm:col-span-2">
              <Textarea rows={2} maxLength={2000} value={v.internal_note} onChange={(e) => setV({ ...v, internal_note: e.target.value })} />
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button onClick={save} loading={pending}>{tc("save")}</Button>
              <Button variant="ghost" onClick={() => setEdit(false)}>{tc("cancel")}</Button>
            </div>
          </div>
        ) : (
          r.status !== "closed" && (
            <Button size="sm" variant="secondary" className="justify-self-start" onClick={() => setEdit(true)}>
              {t("manage")}
            </Button>
          )
        ))}
    </article>
  );
}

function NewRequest({ warranties, create }: { warranties: MaintenancePageData["warranties"]; create: Actions["create"] }) {
  const t = useTranslations("maintenance");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [contract, setContract] = React.useState(warranties[0]?.number ?? "");
  const [body, setBody] = React.useState("");
  const [pending, start] = React.useTransition();
  if (!open)
    return (
      <Button size="sm" onClick={() => setOpen(true)} disabled={!warranties.length}>
        <Plus /> {t("new")}
      </Button>
    );
  return (
    <div className="grid w-full gap-3 rounded-3xl border border-border bg-surface p-5">
      <Field id="mr-contract" label={t("contract")}>
        <NativeSelect value={contract} onChange={(e) => setContract(e.target.value)}>
          {warranties.map((w) => (
            <option key={w.number} value={w.number}>{`${ltr(w.number)} · ${w.client}`}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="mr-body" label={t("describe")}>
        <Textarea rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button
          loading={pending}
          disabled={!body.trim() || !contract}
          onClick={() =>
            start(async () => {
              const r = await create({ contract, body: body.trim() });
              if (r.ok) {
                toast.success(tc("saved"));
                setBody("");
                setOpen(false);
                router.refresh();
              } else toast.error(tc("error"));
            })
          }
        >
          {tc("save")}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>{tc("cancel")}</Button>
      </div>
    </div>
  );
}
