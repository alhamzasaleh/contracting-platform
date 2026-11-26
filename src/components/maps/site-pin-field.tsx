"use client";
import { Crosshair, Loader2, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import * as React from "react";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import { settle } from "@/lib/client/action";
import { useFailureText } from "@/lib/client/failure-text";
import { mapLink, parseMapCoords, type LatLng } from "@/lib/geo";
import { looksLikeMapLink, type Place } from "@/lib/geo-place";

const SiteMap = dynamic(() => import("./site-map").then((m) => m.SiteMap), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-2xl bg-surface-sunken" /> });

/**
 * «الموقع» — one place for the site (owner, Nov 2026): paste a Google Maps link (short WhatsApp
 * links too, read on the server) and the pin moves at once; or tap the map / drag the pin, or
 * «موقعي الحالي» on site. Each new pin also asks for its city and district (`readPlace` → `onPlace`).
 */
export function SitePinField({
  id = "site",
  value,
  onChange,
  link,
  onLinkChange,
  readLink,
  readPlace,
  onPlace,
  fromLinkOnSave,
}: {
  id?: string;
  value: LatLng | null;
  /** a pin set here (map / phone / a link read) — null = cleared */
  onChange: (p: LatLng | null) => void;
  /** the map link typed in the field (kept by the form) */
  link: string;
  onLinkChange: (text: string) => void;
  readLink?: (input: { url: string }) => Promise<ActionResult<LatLng | null>>;
  readPlace?: (input: LatLng) => Promise<ActionResult<Place | null>>;
  onPlace?: (p: Place) => void;
  /** no pin set here: the server reads it from the link when saving */
  fromLinkOnSave?: boolean;
}) {
  const t = useTranslations("maps");
  const failure = useFailureText();
  const [busy, setBusy] = React.useState<"gps" | "link" | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const asked = React.useRef(0);
  const placed = React.useRef(0);

  // a new pin → its city and district (a suggestion for the form); only the latest pin's answer counts
  const place = (p: LatLng) => {
    if (!readPlace || !onPlace) return;
    const ask = ++placed.current;
    void settle(() => readPlace(p)).then((r) => {
      if (ask === placed.current && r.ok && r.data) onPlace(r.data);
    });
  };
  const set = (p: LatLng | null) => {
    onChange(p);
    if (p) place(p);
  };

  // read a pasted link: written coordinates at once, a short link on the server
  const read = async (url: string) => {
    const ask = ++asked.current;
    setNote(null);
    const direct = parseMapCoords(url);
    if (direct) return set(direct);
    if (!readLink) return;
    setBusy("link");
    const r = await settle(() => readLink({ url }));
    if (ask !== asked.current) return; // the link changed meanwhile
    setBusy(null);
    if (!r.ok) return setNote(failure(r.error) ?? (r.error === "rateLimited" ? t("linkRateLimited") : t("linkFailed")));
    if (!r.data) return setNote(t("linkNoPin"));
    set(r.data);
  };

  const here = () => {
    setNote(null);
    if (!("geolocation" in navigator)) return setNote(t("gpsUnavailable"));
    setBusy("gps");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(null);
        set({ lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lng: Math.round(pos.coords.longitude * 1e6) / 1e6 });
        if (pos.coords.accuracy > 100) setNote(t("gpsWeak", { m: Math.round(pos.coords.accuracy) }));
      },
      () => {
        setBusy(null);
        setNote(t("gpsDenied"));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  return (
    <div className="grid gap-2">
      <p className="text-[13px] font-semibold">{t("sitePin")}</p>
      <p className="text-[12px] text-muted-foreground">{t("sitePinHint")}</p>
      <Field
        id={`${id}-link`}
        label={t("linkLabel")}
        hint={t("linkHint")}
        action={busy === "link" ? <Loader2 role="status" aria-label={t("linkReading")} className="size-4 animate-spin text-muted-foreground" /> : undefined}
      >
        <Input
          name="location_url"
          dir="ltr"
          inputMode="url"
          placeholder="https://maps.app.goo.gl/…"
          className="font-latin rtl:text-right"
          value={link}
          onChange={(e) => {
            const text = e.target.value;
            onLinkChange(text);
            asked.current++;
            setBusy(null);
            if (looksLikeMapLink(text)) void read(text.trim());
          }}
        />
      </Field>
      <SiteMap className="h-64" label={t("pickLabel")} pins={[]} pick={{ value, onChange: set }} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" loading={busy === "gps"} disabled={busy != null} onClick={here}>
          <Crosshair /> {t("myLocation")}
        </Button>
        {value && (
          <Button type="button" size="sm" variant="ghost" disabled={busy != null} onClick={() => (placed.current++, onChange(null))}>
            <X /> {t("clearPin")}
          </Button>
        )}
      </div>
      {value ? (
        <p className="text-[12px] text-muted-foreground">
          {t("pinSet")}{" "}
          <a className="text-primary underline" href={mapLink(value)} target="_blank" rel="noopener noreferrer">
            {t("openInMaps")}
          </a>
        </p>
      ) : (
        <p className="text-[12px] text-muted-foreground">{fromLinkOnSave ? t("pinFromLink") : t("pinNotSet")}</p>
      )}
      {note && <p className="rounded-xl bg-warning-soft px-3 py-2 text-[12px]">{note}</p>}
    </div>
  );
}
