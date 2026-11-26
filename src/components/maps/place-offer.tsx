"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { Place } from "@/lib/geo-place";

/** «حسب الخريطة: الرياض — الملقا» — the pin's place when it differs from what was typed (never forced). */
export function PlaceOffer({ offer, onUse }: { offer: Place | null; onUse: (p: Place) => void }) {
  const t = useTranslations("maps");
  if (!offer) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2 text-[12px]">
      <span>{t("placeFromMap", { place: [offer.city, offer.district].filter(Boolean).join(" — ") })}</span>
      <Button type="button" size="sm" variant="ghost" onClick={() => onUse(offer)}>
        {t("usePlace")}
      </Button>
    </p>
  );
}
