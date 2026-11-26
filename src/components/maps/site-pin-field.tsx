"use client";
import { Crosshair, Link2, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actions";
import { settle } from "@/lib/client/action";
import { useFailureText } from "@/lib/client/failure-text";
import { mapLink, type LatLng } from "@/lib/geo";

const SiteMap = dynamic(() => import("./site-map").then((m) => m.SiteMap), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-2xl bg-surface-sunken" /> });

/**
 * «موقع المشروع على الخريطة» (owner, Nov 2026): tap the map or drag the pin, «موقعي الحالي» on site,
 * or «من الرابط» (a Google Maps link, short WhatsApp links too — read on the server).
 */
export function SitePinField({
  value,
  onChange,
  readLink,
  linkValue,
  fromLinkOnSave,
}: {
  value: LatLng | null;
  onChange: (p: LatLng | null) => void;
  readLink?: (input: { url: string }) => Promise<ActionResult<LatLng | null>>;
  /** the map link typed in the form (read when «من الرابط» is pressed) */
  linkValue: () => string;
  /** no pin set here: the pin is read from the link when saving */
  fromLinkOnSave?: boolean;
}) {
  const t = useTranslations("maps");
  const failure = useFailureText();
  const [busy, setBusy] = React.useState<"gps" | "link" | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  const here = () => {
    setNote(null);
    if (!("geolocation" in navigator)) return setNote(t("gpsUnavailable"));
    setBusy("gps");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(null);
        onChange({ lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lng: Math.round(pos.coords.longitude * 1e6) / 1e6 });
        if (pos.coords.accuracy > 100) setNote(t("gpsWeak", { m: Math.round(pos.coords.accuracy) }));
      },
      () => {
        setBusy(null);
        setNote(t("gpsDenied"));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  const fromLink = async () => {
    setNote(null);
    const url = linkValue().trim();
    if (!url) return setNote(t("linkEmpty"));
    if (!readLink) return;
    setBusy("link");
    const r = await settle(() => readLink({ url }));
    setBusy(null);
    if (!r.ok) return setNote(failure(r.error) ?? (r.error === "rateLimited" ? t("linkRateLimited") : t("linkFailed")));
    if (!r.data) return setNote(t("linkNoPin"));
    onChange(r.data);
  };

  return (
    <div className="grid gap-2">
      <p className="text-[13px] font-semibold">{t("sitePin")}</p>
      <p className="text-[12px] text-muted-foreground">{t("sitePinHint")}</p>
      <SiteMap className="h-64" label={t("pickLabel")} pins={[]} pick={{ value, onChange }} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" loading={busy === "gps"} disabled={busy != null} onClick={here}>
          <Crosshair /> {t("myLocation")}
        </Button>
        {readLink && (
          <Button type="button" size="sm" variant="secondary" loading={busy === "link"} disabled={busy != null} onClick={fromLink}>
            <Link2 /> {t("fromLink")}
          </Button>
        )}
        {value && (
          <Button type="button" size="sm" variant="ghost" disabled={busy != null} onClick={() => onChange(null)}>
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
