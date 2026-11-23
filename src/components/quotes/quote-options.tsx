"use client";
import { Layers } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { useFormatter } from "@/components/formatter-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import type { QuoteDetail } from "@/lib/data/quotes";
import { cn } from "@/lib/utils";

type Opt = { version: number; label: string };

/**
 * Optional: offer 2–3 of this quote's versions side by side (e.g. Jotun / Al-Jazeera / Asib).
 * Each version is priced on the Pricing screen as usual ("edit → new version" with another brand or method).
 */
export function QuoteOptionsPanel({ detail, save, preview }: { detail: QuoteDetail; save?: (i: Record<string, unknown>) => Promise<ActionResult>; preview?: boolean }) {
  const t = useTranslations("quotes");
  const tc = useTranslations("common");
  const { fmt } = useFormatter();
  const locked = !detail.canManage || detail.quote.status === "accepted" || !!detail.contract;
  const [picked, setPicked] = React.useState<Opt[]>(detail.options ?? []);
  const [pending, start] = React.useTransition();
  if (detail.versions.length < 2 && !detail.options) return null;

  const toggle = (version: number, brands: string[]) =>
    setPicked((xs) =>
      xs.some((x) => x.version === version)
        ? xs.filter((x) => x.version !== version)
        : xs.length >= 3
          ? xs
          : [...xs, { version, label: brands.join(" · ").slice(0, 60) || t("optionN", { n: xs.length + 1 }) }].sort((a, b) => a.version - b.version),
    );

  const submit = (options: Opt[] | null) =>
    start(async () => {
      if (preview || !save) return void toast(tc("saved"));
      const r = await save({ quote_id: detail.quote.id, options });
      if (r.ok) toast.success(options ? t("optionsSaved") : t("optionsCleared"));
      else toast.error(r.error === "optionsMixedType" ? t("optionsMixedType") : r.error === "quoteLocked" ? t("optionsLocked") : tc("error"));
    });

  const valid = picked.length >= 2 && picked.length <= 3 && picked.every((p) => p.label.trim().length > 0);

  return (
    <section className="grid gap-3 rounded-2xl border border-border bg-surface p-4">
      <p className="flex items-center gap-2 text-[14px] font-bold">
        <Layers className="size-4 text-primary" /> {t("optionsTitle")}
      </p>
      <p className="text-[12px] text-muted-foreground">{t("optionsHint")}</p>
      <ul className="grid gap-2">
        {detail.versions
          .slice()
          .sort((a, b) => a.version - b.version)
          .map((v) => {
            const sel = picked.find((p) => p.version === v.version);
            return (
              <li key={v.version} className={cn("grid gap-2 rounded-xl border p-3", sel ? "border-primary/60 bg-primary/5" : "border-border")}>
                <label className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={!!sel}
                      disabled={locked || (!sel && picked.length >= 3)}
                      onChange={() => toggle(v.version, v.brands)}
                    />
                    <span className="font-semibold">{t("versionN", { n: v.version })}</span>
                    {v.brands.length > 0 && <span className="text-muted-foreground">{v.brands.join(" · ")}</span>}
                  </span>
                  <span className="font-latin tabular-nums">{fmt.money(v.total)}</span>
                </label>
                {sel && (
                  <Input
                    aria-label={t("optionLabel", { n: v.version })}
                    value={sel.label}
                    maxLength={60}
                    disabled={locked}
                    placeholder={t("optionLabelPlaceholder")}
                    onChange={(e) => setPicked((xs) => xs.map((x) => (x.version === v.version ? { ...x, label: e.target.value } : x)))}
                  />
                )}
              </li>
            );
          })}
      </ul>
      {!locked && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={pending} disabled={!valid} onClick={() => submit(picked.map((p) => ({ version: p.version, label: p.label.trim() })))}>
            {t("optionsSave")}
          </Button>
          {detail.options && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setPicked([]); submit(null); }}>
              {t("optionsSingle")}
            </Button>
          )}
        </div>
      )}
      {detail.options && <p className="text-[12px] font-semibold text-primary">{t("optionsActive", { n: detail.options.length })}</p>}
    </section>
  );
}
