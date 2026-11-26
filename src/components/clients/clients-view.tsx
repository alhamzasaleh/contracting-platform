"use client";
import type { MarketerChoice } from "@/lib/data/marketers";
import { DocNo } from "@/components/doc-no";
import { ClipboardList, FileSignature, FileText, HardHat, MapPin, MessageCircle, Pencil, Phone, Plus, Receipt, Search, Users, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { DECISION_TONE } from "@/lib/portal-flow";
import { useFormatter } from "@/components/formatter-provider";
import { FormDialog, str, useActionRunner } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Input, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import type { ClientDetail, ClientListItem } from "@/lib/data/clients";
import { DeleteRecord } from "@/components/forms/delete-record";
import { clientDeleteBlock, surveyDeleteBlock } from "@/lib/deletion";
import { ltr } from "@/lib/utils";
import { SitePinField } from "@/components/maps/site-pin-field";
import { PlaceOffer } from "@/components/maps/place-offer";
import { NewSurveyDialog, type ReadMapLink, type ReadPlace } from "@/components/clients/survey-site";
import { fillPlace, type Place } from "@/lib/geo-place";
import { mapLink, siteOf, type LatLng, type PinSource } from "@/lib/geo";
import dynamic from "next/dynamic";

const SiteMap = dynamic(() => import("@/components/maps/site-map").then((m) => m.SiteMap), { ssr: false, loading: () => <div className="h-56 animate-pulse rounded-2xl bg-surface-sunken" /> });

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
  onReadLink,
  onReadPlace,
  base = "",
  marketers = [],
}: {
  base?: string;
  /** success partners («جاء عن طريق»); empty = the field isn't shown */
  marketers?: MarketerChoice[];
  client?: ClientDetail["client"];
  onClose: () => void;
  onSave?: SaveClient;
  onReadLink?: ReadMapLink;
  onReadPlace?: ReadPlace;
}) {
  const t = useTranslations("clients");
  const tc = useTranslations("common");
  const router = useRouter();
  const { run, pending, fieldText } = useActionRunner();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  // the site pin (map / phone / link); without one the server reads it from the link
  const [pin, setPin] = React.useState<LatLng | null>(siteOf({ latitude: client?.latitude, longitude: client?.longitude }));
  // map = set here (kept) · auto = read from the link on save (a new link replaces the old pin) · none = cleared
  const [source, setSource] = React.useState<PinSource>(pin ? "map" : "auto");
  const [linkText, setLinkText] = React.useState(client?.location_url ?? "");
  // city and district: typed, or filled from the pin (only when empty; a different one is offered)
  const [place, setPlace] = React.useState({ city: client?.city ?? "", district: client?.district ?? "" });
  // the map's place: fills empty fields; offered while it differs from what's typed
  const [placeFound, setPlaceFound] = React.useState<Place | null>(null);
  const placeOffer = placeFound ? fillPlace(place, placeFound).offer : null;
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
                id_number: str(fd, "id_number"),
                location_url: linkText.trim(),
                latitude: source === "map" ? (pin?.lat ?? null) : null,
                longitude: source === "map" ? (pin?.lng ?? null) : null,
                pin_source: source,
                notes: str(fd, "notes") || null,
                ...(marketers.length ? { marketer_id: str(fd, "marketer_id") || null } : {}),
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
      <div className="field-row grid gap-4 sm:grid-cols-2">
        <Field id="cl-city" label={t("city")} optional={tc("optional")}>
          <Input name="city" value={place.city} onChange={(e) => { const city = e.target.value; setPlace((p) => ({ ...p, city })); }} />
        </Field>
        <Field id="cl-district" label={t("district")} optional={tc("optional")}>
          <Input name="district" value={place.district} onChange={(e) => { const district = e.target.value; setPlace((p) => ({ ...p, district })); }} />
        </Field>
      </div>
      <PlaceOffer offer={placeOffer} onUse={(o) => setPlace((p) => ({ city: o.city ?? p.city, district: o.district ?? p.district }))} />
      <Field id="cl-id" label={t("idNumber")} hint={t("idHint")} optional={tc("optional")} error={errors.id_number ? t("idInvalid") : undefined}>
        <Input name="id_number" defaultValue={client?.id_number ?? ""} inputMode="numeric" dir="ltr" maxLength={10} className="font-latin rtl:text-right" />
      </Field>
      <SitePinField
        id="cl-site"
        value={source === "auto" ? null : pin}
        onChange={(p) => {
          setPin(p);
          setSource(p ? "map" : "none");
        }}
        link={linkText}
        // a changed link is read at once; until then (or if it can't be) the server reads it on save
        onLinkChange={(text) => {
          setLinkText(text);
          if (text.trim() !== (client?.location_url ?? "")) setSource("auto");
        }}
        readLink={onReadLink}
        readPlace={onReadPlace}
        // the address arrives later: fill what the fields hold NOW (typing meanwhile is kept)
        onPlace={(found) => {
          setPlace((cur) => {
            const r = fillPlace(cur, found);
            return { city: r.city, district: r.district };
          });
          setPlaceFound(found);
        }}
        fromLinkOnSave={source === "auto" && !!linkText.trim()}
      />
      {errors.location_url && <p className="text-[12px] text-danger">{t("urlInvalid")}</p>}
      {marketers.length > 0 && (
        <Field id="cl-marketer" label={t("cameThrough")} hint={t("cameThroughHint")} optional={tc("optional")}>
          <NativeSelect name="marketer_id" defaultValue={client?.marketer_id ?? ""}>
            <option value="">{t("cameThroughNone")}</option>
            {marketers.filter((m) => m.is_active || m.id === client?.marketer_id).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <Field id="cl-notes" label={t("notes")} optional={tc("optional")}>
        <Textarea name="notes" defaultValue={client?.notes ?? ""} rows={2} />
      </Field>
    </FormDialog>
  );
}

export function ClientsView({ clients, canManage, onSave, onReadLink, onReadPlace, base = "", marketers }: { clients: ClientListItem[]; canManage: boolean; onSave?: SaveClient; onReadLink?: ReadMapLink; onReadPlace?: ReadPlace; base?: string; marketers?: MarketerChoice[] }) {
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
                    <DocNo className="text-[12px] text-muted-foreground">{c.number}</DocNo>
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
      {creating && <ClientDialog onClose={() => setCreating(false)} onSave={onSave} onReadLink={onReadLink} onReadPlace={onReadPlace} base={base} marketers={marketers} />}
    </div>
  );
}

export function ClientDetailView({
  detail,
  canManage,
  canQuote,
  onSave,
  onReadLink,
  onReadPlace,
  onNewSurvey,
  onDelete,
  onDeleteSurvey,
  base = "",
}: {
  base?: string;
  detail: ClientDetail;
  canManage: boolean;
  canQuote: boolean;
  onSave?: SaveClient;
  onReadLink?: ReadMapLink;
  onReadPlace?: ReadPlace;
  onNewSurvey?: (i: Record<string, unknown>) => Promise<ActionResult<{ number: string }>>;
  /** owner only (detail.canDelete) */
  onDelete?: (i: Record<string, unknown>) => Promise<ActionResult>;
  onDeleteSurvey?: (i: Record<string, unknown>) => Promise<ActionResult>;
}) {
  const t = useTranslations("clients");
  const td = useTranslations("deletion");
  const tq = useTranslations("quotes");
  const tcn = useTranslations("contract");
  const { fmt } = useFormatter();
  const [editing, setEditing] = React.useState(false);
  const { client, surveys, quotes } = detail;
  const wa = client.phone ? `https://wa.me/${client.phone}` : null;
  const tm = useTranslations("maps");
  const site = siteOf({ latitude: client.latitude, longitude: client.longitude });

  // «معاينة جديدة»: booked with its date, time and site before the visit
  const [newSurvey, setNewSurvey] = React.useState<"rooms" | "total" | null>(null);

  return (
    <div className="grid gap-6">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-border bg-surface p-5">
        <div className="grid gap-1.5">
          <p className="font-latin text-[12px] text-muted-foreground"><bdi dir="ltr" className="whitespace-nowrap">{client.number}</bdi></p>
          <h2 className="text-[22px] font-bold">{client.name}</h2>
          <p className="flex flex-wrap gap-x-3 text-[14px] text-muted-foreground">
            {client.city && <span>{[client.city, client.district].filter(Boolean).join(" — ")}</span>}
            {client.phone && <span className="ltr-inline font-latin">{displayPhone(client.phone)}</span>}
          </p>
          {client.notes && <p className="max-w-prose text-[13px] leading-6">{client.notes}</p>}
          {client.marketer_id && (
            <p className="text-[13px] text-muted-foreground" data-testid="came-through">
              {detail.canOpenPartners ? (
                <Link href={`${base}/partners`} className="hover:text-primary hover:underline">
                  {t("cameThroughValue", { name: detail.marketers?.find((m) => m.id === client.marketer_id)?.name ?? "—" })}
                </Link>
              ) : (
                t("cameThroughValue", { name: detail.marketers?.find((m) => m.id === client.marketer_id)?.name ?? "—" })
              )}
            </p>
          )}
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
          {(site || client.location_url) && (
            <Button asChild variant="secondary" size="sm">
              <a href={site ? mapLink(site) : client.location_url!} target="_blank" rel="noopener noreferrer">
                <MapPin /> {t("openMap")}
              </a>
            </Button>
          )}
          {canManage && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil /> {t("edit")}
            </Button>
          )}
          {detail.canDelete && (
            <DeleteRecord
              label={td("deleteClient")}
              title={td("clientTitle", { name: client.name })}
              body={td("clientBody", { surveys: surveys.length, quotes: quotes.length })}
              block={clientDeleteBlock({ contracts: detail.contractCount ?? 0, quotes })}
              action={onDelete && (() => onDelete({ id: client.id }))}
              to={`${base}/clients`}
            />
          )}
        </div>
      </section>

      {site ? (
        <SiteMap className="h-56" label={tm("siteMapLabel", { name: client.name })} pins={[{ id: "site", ...site, tone: "site", label: client.name }]} />
      ) : (
        canManage && <p className="rounded-2xl bg-warning-soft px-4 py-3 text-[13px]">{tm("noSiteYet")}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="grid content-start gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[17px] font-bold">{t("surveys")}</h3>
            {canManage && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setNewSurvey("rooms")}>
                  <Plus /> {t("newSurveyRooms")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setNewSurvey("total")}>
                  {t("newSurveyTotal")}
                </Button>
              </div>
            )}
          </div>
          {surveys.length === 0 && <p className="rounded-2xl border border-dashed border-border p-5 text-center text-[14px] text-muted-foreground">{t("noSurveys")}</p>}
          <ul className="grid gap-2">
            {surveys.map((s) => (
              <li key={s.id} className="flex items-center gap-1.5">
                <Link href={`${base}/clients/${client.number}/surveys/${s.number}`} className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 hover:border-primary/40">
                  <span>
                    <span className="block text-[15px] font-bold">{s.title ?? t("survey")}</span>
                    <span className="text-[12px] text-muted-foreground">
                      {s.mode === "rooms" ? t("roomsCount", { n: s.rooms }) : t("totalMode")}
                      {s.visit_date && ` · ${fmt.date(s.visit_date)}`}
                      {s.visit_time && <span className="font-latin tabular-nums" dir="ltr"> {s.visit_time.slice(0, 5)}</span>}
                      {s.ownSite && ` · ${t("surveyOwnSite")}`}
                    </span>
                  </span>
                  <DocNo className="text-[12px] text-muted-foreground">{s.number}</DocNo>
                </Link>
                {detail.canDelete && (
                  <DeleteRecord
                    compact
                    label={td("deleteSurvey")}
                    title={td("surveyTitle", { number: ltr(s.number) })}
                    body={td("surveyBody", { rooms: s.rooms })}
                    block={surveyDeleteBlock({ quotes: s.quotes ?? 0 })}
                    action={onDeleteSurvey && (() => onDeleteSurvey({ id: s.id }))}
                    to={`${base}/clients/${client.number}`}
                  />
                )}
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
                    <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                      {tq(`status_${q.status}`)} · {tq("versionN", { n: q.version })}
                      {q.clientDecision && <Badge tone={DECISION_TONE[q.clientDecision]}>{tq(`decision_${q.clientDecision}`)}</Badge>}
                    </span>
                  </span>
                  <span className="text-end">
                    {q.total != null && <span className="block font-latin text-[15px] font-bold tabular-nums">{fmt.money(q.total)}</span>}
                    <DocNo className="text-[12px] text-muted-foreground">{q.number}</DocNo>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {((detail.contracts?.length ?? 0) > 0 || detail.balance) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="grid content-start gap-3">
            <h3 className="text-[17px] font-bold">{t("contracts")}</h3>
            <ul className="grid gap-2">
              {(detail.contracts ?? []).map((c) => (
                <li key={c.number} className="grid gap-2 rounded-2xl border border-border bg-surface px-4 py-3">
                  <Link href={`${base}/contracts/${c.number}`} className="flex flex-wrap items-center justify-between gap-2 hover:text-primary">
                    <span className="flex items-center gap-2 font-bold">
                      <FileSignature className="size-4 text-primary" />
                      {tq(`service_${c.service}`)} · <DocNo>{c.number}</DocNo>
                    </span>
                    <span className="font-latin font-bold tabular-nums">{fmt.money(c.total)}</span>
                  </Link>
                  <span className="flex flex-wrap items-center gap-2 text-[12px]">
                    <Badge tone={c.status === "accepted" ? "success" : "neutral"}>{tcn(`status_${c.status}` as "status_sent")}</Badge>
                    {c.status === "accepted" && detail.canViewProjects && (
                      <>
                        <Link href={`${base}/projects/${c.number}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                          <HardHat className="size-3.5" /> {t("openProject")}
                        </Link>
                        <Link href={`${base}/maintenance?contract=${c.number}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                          <Wrench className="size-3.5" /> {t("maintenance")}
                          {c.openMaintenance > 0 && <Badge tone="warning">{c.openMaintenance}</Badge>}
                        </Link>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          {detail.balance && (
            <section className="grid content-start gap-3">
              <h3 className="text-[17px] font-bold">{t("balance")}</h3>
              <div className="grid grid-cols-3 gap-2">
                {(["billed", "received", "outstanding"] as const).map((k) => (
                  <div key={k} className="rounded-2xl border border-border bg-surface p-3">
                    <p className="text-[12px] text-muted-foreground">{t(`bal_${k}`)}</p>
                    <p className={`mt-1 font-latin text-[clamp(0.85rem,3.6vw,1rem)] font-extrabold tabular-nums break-words ${k === "outstanding" && detail.balance!.outstanding > 0 ? "text-warning-foreground" : ""}`}>{fmt.money(detail.balance![k])}</p>
                  </div>
                ))}
              </div>
              {(detail.invoices?.length ?? 0) > 0 && (
                <ul className="grid gap-2">
                  {detail.invoices!.map((i) => (
                    <li key={i.number}>
                      <Link href={`${base}/invoices/${i.number}`} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface px-4 py-2.5 text-[14px] hover:border-primary/40">
                        <span className="flex items-center gap-2">
                          <Receipt className="size-4 text-primary" /> <DocNo>{i.number}</DocNo>
                          <span className="text-[12px] text-muted-foreground">· {fmt.date(i.issue_date)}</span>
                        </span>
                        <span className="font-latin font-bold tabular-nums">{fmt.money(i.total)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
      {editing && <ClientDialog client={client} onClose={() => setEditing(false)} onSave={onSave} onReadLink={onReadLink} onReadPlace={onReadPlace} marketers={detail.marketers} />}
      {newSurvey && (
        <NewSurveyDialog
          mode={newSurvey}
          clientId={client.id}
          clientNumber={client.number}
          clientHasSite={!!site}
          base={base}
          onClose={() => setNewSurvey(null)}
          create={onNewSurvey}
          readLink={onReadLink}
          readPlace={onReadPlace}
        />
      )}
    </div>
  );
}
