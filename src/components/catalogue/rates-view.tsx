"use client";
import { Check, SlidersHorizontal, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { NumberInput, useActionRunner } from "@/components/forms/form-kit";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { ActionResult } from "@/lib/actions";
import type { RateSection } from "@/lib/supabase/database.types";
import { toNumber } from "@/lib/validation/numbers";

export type RateItem = {
  id: string;
  key: string;
  value: number;
  unit: string | null;
  label: string;
  section: RateSection;
  sort_order: number;
  last_reviewed_at: string | null;
};

const SECTIONS: RateSection[] = ["gypsum", "interior", "exterior", "labour", "commercial"];

const UNIT_KEYS: Record<string, string> = {
  m: "rateUnit_m",
  m2: "rateUnit_m2",
  kg: "rateUnit_kg",
  pcs: "rateUnit_pcs",
  coats: "rateUnit_coats",
  days: "rateUnit_days",
  SAR: "rateUnit_SAR",
  "SAR/m2": "rateUnit_SARm2",
  "SAR/m": "rateUnit_SARm",
  "m2/day": "rateUnit_m2day",
};

/** Engine parameters (Appendix A.6): edit inline, saved on Enter / leaving the field. */
export function RatesView({
  rates,
  canManage,
  onSave,
  onSeed,
}: {
  rates: RateItem[];
  canManage: boolean;
  onSave?: (i: Record<string, unknown>) => Promise<ActionResult>;
  onSeed?: () => Promise<ActionResult>;
}) {
  const t = useTranslations("engine");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const [saved, setSaved] = React.useState<string | null>(null);

  if (rates.length === 0) {
    return (
      <EmptyState
        icon={<SlidersHorizontal />}
        title={t("emptyTitle")}
        description={t("emptyBody")}
        action={
          canManage && (
            <Button loading={pending} onClick={() => run(onSeed)}>
              <Sparkles /> {t("seed")}
            </Button>
          )
        }
      />
    );
  }

  function unitText(u: string | null) {
    if (!u) return undefined;
    if (u === "%") return "%";
    const key = UNIT_KEYS[u];
    return key ? t(key) : u;
  }

  function commit(r: RateItem, raw: string) {
    const v = toNumber(raw);
    if (typeof v !== "number" || v === r.value) return;
    run(onSave && (() => onSave({ id: r.id, value: v })), { silent: true, onSuccess: () => setSaved(r.id) });
  }

  return (
    <div className="grid gap-5">
      <p className="rounded-2xl bg-primary-soft/60 px-5 py-3.5 text-[14px] text-foreground">{t("ratesIntro")}</p>
      <div className="grid gap-5 lg:grid-cols-2">
        {SECTIONS.map((sec) => {
          // Coats are chosen per client in Pricing (and saved in its template) — not here.
          const list = rates.filter((r) => r.section === sec && !r.key.includes(".coats."));
          if (!list.length) return null;
          return (
            <section key={sec} className="overflow-hidden rounded-2xl border border-border bg-surface">
              <header className="border-b border-border bg-surface-sunken/60 px-5 py-2.5">
                <h3 className="text-[14px] font-bold">{t(`section_${sec}`)}</h3>
              </header>
              <ul className="divide-y divide-border">
                {list.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-2.5">
                    <label htmlFor={`rate-${r.id}`} className="min-w-0 flex-1 text-[14px]">
                      {r.label}
                      {r.last_reviewed_at && <span className="block text-[11px] text-subtle-foreground">{t("reviewed", { date: fmt.date(r.last_reviewed_at) })}</span>}
                    </label>
                    <div className="w-36 shrink-0">
                      <NumberInput
                        id={`rate-${r.id}`}
                        key={`${r.id}-${r.value}`}
                        defaultValue={r.value}
                        disabled={!canManage}
                        suffix={unitText(r.unit)}
                        className="h-10"
                        onBlur={(e) => commit(r, e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                    </div>
                    <span className="w-4 text-success">{saved === r.id && <Check className="size-4" aria-label={t("savedShort")} />}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
