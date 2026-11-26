"use client";
import { CalendarClock, MapPin, Navigation, Pencil } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DocNo } from "@/components/doc-no";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { FormDialog, useActionRunner } from "@/components/forms/form-kit";
import { PlaceOffer } from "@/components/maps/place-offer";
import { SitePinField } from "@/components/maps/site-pin-field";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import type { ActionResult } from "@/lib/actions";
import { mapLink, siteOf, type LatLng } from "@/lib/geo";
import { fillPlace, type Place } from "@/lib/geo-place";

const SiteMap = dynamic(() => import("@/components/maps/site-map").then((m) => m.SiteMap), { ssr: false, loading: () => <div className="h-48 animate-pulse rounded-2xl bg-surface-sunken" /> });

export type ReadMapLink = (i: { url: string }) => Promise<ActionResult<LatLng | null>>;
export type ReadPlace = (i: LatLng) => Promise<ActionResult<Place | null>>;
type SiteValue = { own: boolean; pin: LatLng | null; city: string; district: string };

/** The survey's site as sent to the server: «نفس موقع العميل» = no pin of its own. */
export function siteInput(v: SiteValue) {
  return v.own && v.pin
    ? { latitude: v.pin.lat, longitude: v.pin.lng, site_city: v.city.trim() || null, site_district: v.district.trim() || null }
    : { latitude: null, longitude: null, site_city: null, site_district: null };
}

/** «نفس موقع العميل» / «موقع ثاني» + the one place for the site and its city / district. */
function SiteChoice({ value, onChange, clientHasSite, readLink, readPlace }: { value: SiteValue; onChange: React.Dispatch<React.SetStateAction<SiteValue>>; clientHasSite: boolean; readLink?: ReadMapLink; readPlace?: ReadPlace }) {
  const t = useTranslations("survey");
  const tc = useTranslations("common");
  const tcl = useTranslations("clients");
  const [link, setLink] = React.useState("");
  // the map's place: fills empty fields; offered while it differs from what's typed
  const [found, setFound] = React.useState<Place | null>(null);
  const offer = found ? fillPlace(value, found).offer : null;
  return (
    <div className="grid gap-3">
      <Segmented
        name={t("siteWhere")}
        value={value.own ? "own" : "client"}
        onChange={(o) => onChange((v) => ({ ...v, own: o === "own" }))}
        options={[
          { value: "client", label: t("siteClient") },
          { value: "own", label: t("siteOther") },
        ]}
      />
      {!value.own && <p className="text-[12px] text-muted-foreground">{clientHasSite ? t("siteClientHint") : t("siteClientMissing")}</p>}
      {value.own && (
        <>
          <SitePinField
            id="sv-site"
            value={value.pin}
            onChange={(pin) => onChange((v) => ({ ...v, pin }))}
            link={link}
            onLinkChange={setLink}
            readLink={readLink}
            readPlace={readPlace}
            // the address arrives later: fill the CURRENT value (never an older pin)
            onPlace={(found) => {
              onChange((v) => ({ ...v, ...pick(fillPlace(v, found)) }));
              setFound(found);
            }}
          />
          <div className="field-row grid gap-4 sm:grid-cols-2">
            <Field id="sv-city" label={tcl("city")} optional={tc("optional")}>
              <Input value={value.city} onChange={(e) => { const city = e.target.value; onChange((v) => ({ ...v, city })); }} />
            </Field>
            <Field id="sv-district" label={tcl("district")} optional={tc("optional")}>
              <Input value={value.district} onChange={(e) => { const district = e.target.value; onChange((v) => ({ ...v, district })); }} />
            </Field>
          </div>
          <PlaceOffer offer={offer} onUse={(o) => onChange((v) => ({ ...v, city: o.city ?? v.city, district: o.district ?? v.district }))} />
        </>
      )}
    </div>
  );
}

const pick = (r: { city: string; district: string }) => ({ city: r.city, district: r.district });

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });

/**
 * «معاينة جديدة» (owner, Nov 2026): booked before the visit — the date and time, and where: the
 * client's site or another one (a second villa). Saved even if no quote or contract ever follows.
 */
export function NewSurveyDialog({
  mode,
  clientId,
  clientNumber,
  clientHasSite,
  base = "",
  onClose,
  create,
  readLink,
  readPlace,
}: {
  mode: "rooms" | "total";
  clientId: string;
  clientNumber: string;
  clientHasSite: boolean;
  base?: string;
  onClose: () => void;
  create?: (i: Record<string, unknown>) => Promise<ActionResult<{ number: string }>>;
  readLink?: ReadMapLink;
  readPlace?: ReadPlace;
}) {
  const t = useTranslations("survey");
  const tc = useTranslations("common");
  const router = useRouter();
  const { run, pending } = useActionRunner();
  const [date, setDate] = React.useState(today());
  const [time, setTime] = React.useState("");
  const [site, setSite] = React.useState<SiteValue>({ own: !clientHasSite, pin: null, city: "", district: "" });
  const missingPin = site.own && !site.pin;
  // «موقع ثاني» names its place: the contract says where the project is
  const missingPlace = site.own && !!site.pin && !site.city.trim() && !site.district.trim();
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={mode === "rooms" ? t("newRooms") : t("newTotal")}
      description={t("newHint")}
      pending={pending}
      submitLabel={t("create")}
      onSubmit={() =>
        !missingPin &&
        !missingPlace &&
        run(create && (() => create({ client_id: clientId, mode, visit_date: date || null, visit_time: time || null, ...siteInput(site) })), {
          silent: true,
          onSuccess: (r) => {
            onClose();
            if (r.ok && r.data) router.push(`${base}/clients/${clientNumber}/surveys/${r.data.number}`);
          },
        })
      }
    >
      <div className="field-row grid gap-4 sm:grid-cols-2">
        <Field id="ns-date" label={t("visitDate")}>
          <Input id="ns-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="ns-time" label={t("visitTime")} optional={tc("optional")}>
          <Input id="ns-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <SiteChoice value={site} onChange={setSite} clientHasSite={clientHasSite} readLink={readLink} readPlace={readPlace} />
      {missingPin && <p className="text-[12px] text-muted-foreground">{t("siteOtherNeedsPin")}</p>}
      {missingPlace && <p className="text-[12px] text-muted-foreground">{t("siteOtherNeedsPlace")}</p>}
    </FormDialog>
  );
}

/**
 * The survey's site on its page: where the supervisor goes (its own pin, else the client's), with
 * «افتح في الخرائط» for directions, and «تغيير الموقع» (clients.manage).
 */
export function SurveySiteCard({
  survey,
  client,
  project,
  canOpenProject,
  sentContract,
  canOpenContract,
  base = "",
  canManage,
  save,
  readLink,
  readPlace,
}: {
  survey: { id: string; visit_date: string | null; visit_time?: string | null; latitude?: number | null; longitude?: number | null; site_city?: string | null; site_district?: string | null };
  client: { name: string; latitude?: number | null; longitude?: number | null; city?: string | null; district?: string | null; location_url?: string | null };
  /** an accepted project made from this survey (it keeps its own site) */
  project?: string | null;
  /** projects.view: the number links to the project */
  canOpenProject?: boolean;
  /** a contract sent to the client: its place is frozen since sending */
  sentContract?: string | null;
  canOpenContract?: boolean;
  base?: string;
  canManage: boolean;
  save?: (i: Record<string, unknown>) => Promise<ActionResult>;
  readLink?: ReadMapLink;
  readPlace?: ReadPlace;
}) {
  const t = useTranslations("survey");
  const tm = useTranslations("maps");
  const { fmt } = useFormatter();
  const [editing, setEditing] = React.useState(false);
  const own = siteOf({ latitude: survey.latitude, longitude: survey.longitude });
  const clientSite = siteOf({ latitude: client.latitude, longitude: client.longitude });
  const site = own ?? clientSite;
  const place = own ? [survey.site_city, survey.site_district] : [client.city, client.district];
  return (
    <section className="grid gap-3 rounded-3xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[15px] font-bold">
          <MapPin className="size-4" /> {t("siteTitle")}
        </p>
        <div className="flex flex-wrap gap-2">
          {(site || client.location_url) && (
            <Button asChild size="sm" variant="secondary">
              <a href={site ? mapLink(site) : client.location_url!} target="_blank" rel="noopener noreferrer">
                <Navigation /> {t("directions")}
              </a>
            </Button>
          )}
          {canManage && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil /> {t("changeSite")}
            </Button>
          )}
        </div>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {own ? t("siteIsOwn") : clientSite ? t("siteIsClient") : t("siteNone")}
        {place.some(Boolean) && ` · ${place.filter(Boolean).join(" — ")}`}
      </p>
      {sentContract && !project && (
        <p className="rounded-xl bg-surface-sunken px-3 py-2 text-[12px]">
          {t.rich("siteContractSent", {
            contract: () => (canOpenContract ? <Link href={`${base}/contracts/${sentContract}`} className="font-semibold text-primary hover:underline"><DocNo>{sentContract}</DocNo></Link> : <DocNo>{sentContract}</DocNo>),
          })}
        </p>
      )}
      {project && (
        <p className="rounded-xl bg-surface-sunken px-3 py-2 text-[12px]">
          {t.rich("siteProjectKept", {
            project: () => (canOpenProject ? <Link href={`${base}/projects/${project}`} className="font-semibold text-primary hover:underline"><DocNo>{project}</DocNo></Link> : <DocNo>{project}</DocNo>),
          })}
        </p>
      )}
      {survey.visit_date && (
        <p className="flex items-center gap-2 text-[13px]">
          <CalendarClock className="size-4 text-muted-foreground" />
          {fmt.date(survey.visit_date)}
          {survey.visit_time && <span className="font-latin tabular-nums" dir="ltr">{survey.visit_time.slice(0, 5)}</span>}
        </p>
      )}
      {site && <SiteMap className="h-48" label={tm("siteMapLabel", { name: client.name })} pins={[{ id: "site", ...site, tone: "site", label: client.name }]} />}
      {editing && (
        <SurveySiteDialog
          initial={{ own: !!own, pin: own, city: survey.site_city ?? "", district: survey.site_district ?? "" }}
          clientHasSite={!!clientSite}
          onClose={() => setEditing(false)}
          save={save && ((v) => save({ id: survey.id, ...siteInput(v) }))}
          readLink={readLink}
          readPlace={readPlace}
        />
      )}
    </section>
  );
}

function SurveySiteDialog({ initial, clientHasSite, onClose, save, readLink, readPlace }: { initial: SiteValue; clientHasSite: boolean; onClose: () => void; save?: (v: SiteValue) => Promise<ActionResult>; readLink?: ReadMapLink; readPlace?: ReadPlace }) {
  const t = useTranslations("survey");
  const { run, pending } = useActionRunner();
  const [site, setSite] = React.useState<SiteValue>(initial);
  const missingPin = site.own && !site.pin;
  // «موقع ثاني» names its place: the contract says where the project is
  const missingPlace = site.own && !!site.pin && !site.city.trim() && !site.district.trim();
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t("changeSite")}
      pending={pending}
      onSubmit={() => !missingPin && !missingPlace && run(save && (() => save(site)), { onSuccess: onClose })}
    >
      <SiteChoice value={site} onChange={setSite} clientHasSite={clientHasSite} readLink={readLink} readPlace={readPlace} />
      {missingPin && <p className="text-[12px] text-muted-foreground">{t("siteOtherNeedsPin")}</p>}
      {missingPlace && <p className="text-[12px] text-muted-foreground">{t("siteOtherNeedsPlace")}</p>}
    </FormDialog>
  );
}
