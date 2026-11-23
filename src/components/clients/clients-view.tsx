"use client";
import { ClipboardList, FileText, MapPin, MessageCircle, Pencil, Phone, Plus, Search, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { FormDialog, str, useActionRunner } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import type { ClientDetail, ClientListItem } from "@/lib/data/clients";

type SaveClient = (i: Record<string, unknown>) => Promise<ActionResult<{ number: string }>>;

/** 966551234567 → 055 123 4567 */
export function displayPhone(p: string | null) {
  if (!p) return null;
  const local = p.startsWith("966") ? `0${p.slice(3)}` : p;
  return local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : local;
}

function ClientDialog({
  client,
  onClose,
  onSave,
  base = "",
}: {
  base?: string;
  client?: ClientDetail["client"];
  onClose: () => void;
  onSave?: SaveClient;
}) {
  const t = useTranslations("clients");
  const tc = useTranslations("common");
  const router = useRouter();
  const { run, pending, fieldText } = useActionRunner();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={client ? t("edit") : t("new")}
      pending={pending}
      onSubmit={(fd) =>
        run(
          onSave &&
            (() =>
              onSave({
                ...(client ? { id: client.id } : {}),
                name: str(fd, "name"),
                phone: str(fd, "phone"),
                city: str(fd, "city") || null,
                district: str(fd, "district") || null,
                location_url: str(fd, "location_url"),
                notes: str(fd, "notes") || null,
              })),
          {
            onFieldErrors: setErrors,
            onSuccess: (r) => {
              onClose();
              const number = r.ok ? r.data?.number : undefined;
              if (!client && number) router.push(`${base}/clients/${number}`);
            },
          },
        )
      }
    >
      <Field id="cl-name" label={t("name")} error={fieldText(errors.name)}>
        <Input name="name" defaultValue={client?.name} autoFocus />
      </Field>
      <Field id="cl-phone" label={t("phone")} optional={tc("optional")} error={errors.phone ? t("phoneInvalid") : undefined}>
        <Input name="phone" defaultValue={client?.phone ? `0${client.phone.slice(3)}` : ""} inputMode="tel" dir="ltr" placeholder="05xxxxxxxx" className="font-latin rtl:text-right" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field id="cl-city" label={t("city")} optional={tc("optional")}>
          <Input name="city" defaultValue={client?.city ?? ""} />
        </Field>
        <Field id="cl-district" label={t("district")} optional={tc("optional")}>
          <Input name="district" defaultValue={client?.district ?? ""} />
        </Field>
      </div>
      <Field id="cl-loc" label={t("location")} hint={t("locationHint")} optional={tc("optional")} error={errors.location_url ? t("urlInvalid") : undefined}>
        <Input name="location_url" defaultValue={client?.location_url ?? ""} dir="ltr" inputMode="url" placeholder="https://maps.app.goo.gl/…" className="font-latin rtl:text-right" />
      </Field>
      <Field id="cl-notes" label={t("notes")} optional={tc("optional")}>
        <Textarea name="notes" defaultValue={client?.notes ?? ""} rows={2} />
      </Field>
    </FormDialog>
  );
}

export function ClientsView({ clients, canManage, onSave, base = "" }: { clients: ClientListItem[]; canManage: boolean; onSave?: SaveClient; base?: string }) {
  const t = useTranslations("clients");
  const { fmt } = useFormatter();
  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const q = query.trim().toLowerCase();
  const list = q ? clients.filter((c) => [c.name, c.number, c.phone, c.city, displayPhone(c.phone)].some((v) => v?.toLowerCase().includes(q))) : clients;

  return (
    <div className="grid gap-5">
      {clients.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={t("emptyTitle")}
          description={t("emptyBody")}
          action={
            canManage && (
              <Button onClick={() => setCreating(true)}>
                <Plus /> {t("new")}
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4 text-subtle-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="ps-10" />
            </div>
            {canManage && (
              <Button onClick={() => setCreating(true)}>
                <Plus /> {t("new")}
              </Button>
            )}
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((c) => (
              <li key={c.id}>
                <Link
                  href={`${base}/clients/${c.number}`}
                  className="flex h-full flex-col gap-2 rounded-2xl border border-border bg-surface p-4 transition hover:border-primary/40 hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[16px] font-bold">{c.name}</span>
                    <span className="font-latin text-[12px] text-muted-foreground">{c.number}</span>
                  </div>
                  <span className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                    {c.phone && <span className="ltr-inline font-latin">{displayPhone(c.phone)}</span>}
                    {c.city && <span>{c.city}</span>}
                  </span>
                  <span className="mt-auto flex gap-2 pt-1">
                    <Badge>
                      <ClipboardList /> {t("surveysCount", { n: c.surveys })}
                    </Badge>
                    <Badge tone={c.quotes ? "primary" : "neutral"}>
                      <FileText /> {t("quotesCount", { n: c.quotes })}
                    </Badge>
                    <span className="ms-auto text-[11px] text-subtle-foreground">{fmt.date(c.created_at)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {list.length === 0 && <p className="py-10 text-center text-muted-foreground">{t("noResults")}</p>}
        </>
      )}
      {creating && <ClientDialog onClose={() => setCreating(false)} onSave={onSave} base={base} />}
    </div>
  );
}

export function ClientDetailView({
  detail,
  canManage,
  canQuote,
  onSave,
  onNewSurvey,
  base = "",
}: {
  base?: string;
  detail: ClientDetail;
  canManage: boolean;
  canQuote: boolean;
  onSave?: SaveClient;
  onNewSurvey?: (i: Record<string, unknown>) => Promise<ActionResult<{ number: string }>>;
}) {
  const t = useTranslations("clients");
  const tq = useTranslations("quotes");
  const { fmt } = useFormatter();
  const router = useRouter();
  const { run, pending } = useActionRunner();
  const [editing, setEditing] = React.useState(false);
  const { client, surveys, quotes } = detail;
  const wa = client.phone ? `https://wa.me/${client.phone}` : null;

  const newSurvey = (mode: "rooms" | "total") =>
    run(onNewSurvey && (() => onNewSurvey({ client_id: client.id, mode })), {
      silent: true,
      onSuccess: (r) => r.ok && r.data && router.push(`${base}/clients/${client.number}/surveys/${r.data.number}`),
    });

  return (
    <div className="grid gap-6">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-border bg-surface p-5">
        <div className="grid gap-1.5">
          <p className="font-latin text-[12px] text-muted-foreground">{client.number}</p>
          <h2 className="text-[22px] font-bold">{client.name}</h2>
          <p className="flex flex-wrap gap-x-3 text-[14px] text-muted-foreground">
            {client.city && <span>{[client.city, client.district].filter(Boolean).join(" — ")}</span>}
            {client.phone && <span className="ltr-inline font-latin">{displayPhone(client.phone)}</span>}
          </p>
          {client.notes && <p className="max-w-prose text-[13px] leading-6">{client.notes}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {client.phone && (
            <Button asChild variant="secondary" size="sm">
              <a href={`tel:+${client.phone}`}>
                <Phone /> {t("call")}
              </a>
            </Button>
          )}
          {wa && (
            <Button asChild variant="secondary" size="sm">
              <a href={wa} target="_blank" rel="noopener noreferrer">
                <MessageCircle /> {t("whatsapp")}
              </a>
            </Button>
          )}
          {client.location_url && (
            <Button asChild variant="secondary" size="sm">
              <a href={client.location_url} target="_blank" rel="noopener noreferrer">
                <MapPin /> {t("openMap")}
              </a>
            </Button>
          )}
          {canManage && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil /> {t("edit")}
            </Button>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="grid content-start gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[17px] font-bold">{t("surveys")}</h3>
            {canManage && (
              <div className="flex gap-2">
                <Button size="sm" loading={pending} onClick={() => newSurvey("rooms")}>
                  <Plus /> {t("newSurveyRooms")}
                </Button>
                <Button size="sm" variant="secondary" loading={pending} onClick={() => newSurvey("total")}>
                  {t("newSurveyTotal")}
                </Button>
              </div>
            )}
          </div>
          {surveys.length === 0 && <p className="rounded-2xl border border-dashed border-border p-5 text-center text-[14px] text-muted-foreground">{t("noSurveys")}</p>}
          <ul className="grid gap-2">
            {surveys.map((s) => (
              <li key={s.id}>
                <Link href={`${base}/clients/${client.number}/surveys/${s.number}`} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 hover:border-primary/40">
                  <span>
                    <span className="block text-[15px] font-bold">{s.title ?? t("survey")}</span>
                    <span className="text-[12px] text-muted-foreground">
                      {s.mode === "rooms" ? t("roomsCount", { n: s.rooms }) : t("totalMode")}
                      {s.visit_date && ` · ${fmt.date(s.visit_date)}`}
                    </span>
                  </span>
                  <span className="font-latin text-[12px] text-muted-foreground">{s.number}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="grid content-start gap-3">
          <h3 className="text-[17px] font-bold">{t("quotes")}</h3>
          {quotes.length === 0 && (
            <p className="rounded-2xl border border-dashed border-border p-5 text-center text-[14px] text-muted-foreground">{canQuote ? t("noQuotesHint") : t("noQuotes")}</p>
          )}
          <ul className="grid gap-2">
            {quotes.map((q) => (
              <li key={q.id}>
                <Link href={`${base}/quotations/${q.number}`} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 hover:border-primary/40">
                  <span>
                    <span className="block text-[15px] font-bold">{tq(`service_${q.service}`)}</span>
                    <span className="text-[12px] text-muted-foreground">
                      {tq(`status_${q.status}`)} · {tq("versionN", { n: q.version })}
                    </span>
                  </span>
                  <span className="text-end">
                    {q.total != null && <span className="block font-latin text-[15px] font-bold tabular-nums">{fmt.money(q.total)}</span>}
                    <span className="font-latin text-[12px] text-muted-foreground">{q.number}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {editing && <ClientDialog client={client} onClose={() => setEditing(false)} onSave={onSave} />}
    </div>
  );
}
