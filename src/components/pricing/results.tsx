"use client";
import { Calculator, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { Badge } from "@/components/ui/badge";
import type { Line } from "@/lib/engine";
import { FORMULA_KEYS } from "@/lib/engine/formula-keys";
import { buyParts } from "@/lib/quotes/materials";
import { useUnitText } from "@/components/forms/form-kit";
import { useBuyText } from "@/components/quotes/buy-text";
import { cn } from "@/lib/utils";

/** Result panels shared by the pricing screen: KPI tiles and the traceable lines list. */

export function Kpi({
  label,
  value,
  sub,
  strong,
}: {
  label: string;
  value: string;
  sub?: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border p-4",
        strong ? "bg-ink text-ink-foreground" : "bg-surface",
      )}
    >
      <p
        className={cn(
          "text-[12px]",
          strong ? "opacity-75" : "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <p className="mt-1 font-latin text-[19px] font-bold leading-tight tabular-nums">
        {value}
      </p>
      {sub && (
        <p
          className={cn(
            "text-[12px]",
            strong ? "opacity-75" : "text-muted-foreground",
          )}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

export function LinesTable({ lines, explain }: { lines: Line[]; explain: (role: string) => string[] }) {
  const t = useTranslations("engine");
  const { fmt } = useFormatter();
  const tf = useTranslations("formulas");
  const ti = useTranslations("inputs");
  const tz = useTranslations("survey");
  /** wet / decorative → «رطب» / «ديكوري» (engine zone ids are never shown as they are) */
  const zoneName = (z: string) => (tz.has(`zone_${z}`) ? tz(`zone_${z}`) : z);
  // The engine speaks English internally; show formulas and value names in the user's language.
  const formulaText = (f: string) => (FORMULA_KEYS[f] && tf.has(FORMULA_KEYS[f]) ? tf(FORMULA_KEYS[f]) : f);
  const inputName = (k: string) => (ti.has(k) ? ti(k) : k);
  /** 660 → "660", 11.1111 → "11.11", 0.4 → "0.4" */
  const trim = (x: number) => fmt.number(x, Number.isInteger(x) ? 0 : Math.abs(x) >= 10 ? 2 : 3);
  const [open, setOpen] = React.useState<string | null>(null);
  const groups: Line["group"][] = ["material", "labour", "hatch", "extra"];

  const qn = (x: number) =>
    fmt.number(x, Number.isInteger(x) ? 0 : Number.isInteger(x * 10) ? 1 : 2);

  const buyText = useBuyText();
  const unitText = useUnitText();
  /** materials: «2 عبوة × 18 لتر + 1 عبوة × 4 لتر» (count per pack size, with units); labour: quantity */
  function purchase(l: Line) {
    if (l.group === "material") return buyText(buyParts(l.purchase, l.needUnit || null, l.unit, l.qty));
    return `${qn(l.qty)} ${t.has(`lineUnit_${l.unit}`) ? t(`lineUnit_${l.unit}`) : l.unit}`;
  }
  /** a bought pack / bar / box covers more than needed: say how much is actually needed */
  const showsNeed = (l: Line) => l.group === "material" && l.need > 0 && !!l.needUnit;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <Calculator className="size-4 text-muted-foreground" />
        <h3 className="text-[14px] font-bold">{t("linesTitle")}</h3>
        <span className="text-[12px] text-muted-foreground">
          · {t("linesHint")}
        </span>
      </div>
      {groups.map((g) => {
        // Unpriced items stay visible (marked), so nothing silently disappears from the total.
        const list = lines.filter(
          (l) => l.group === g && (l.cost > 0 || l.group === "material"),
        );
        if (!list.length) return null;
        return (
          <div key={g}>
            <p className="bg-surface-sunken/60 px-5 py-1.5 text-[12px] font-bold text-muted-foreground">
              {t(`group_${g}`)}
            </p>
            <ul className="divide-y divide-border">
              {list.map((l) => {
                const isOpen = open === l.key;
                return (
                  <li key={l.key}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : l.key)}
                      className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-5 py-3 text-start hover:bg-surface-sunken/40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-medium">
                          {l.label}
                        </span>
                        <span className="block text-[12px] text-muted-foreground">
                          {l.group === "labour" ? t("qty") : t("buy")}:{" "}
                          <span>{purchase(l)}</span>
                          {showsNeed(l) && !l.key.startsWith("missing_") && (
                            <span> · {t("needShort", { n: trim(l.need), unit: unitText(l.needUnit) })}</span>
                          )}
                          {l.zone && <Badge className="ms-2">{zoneName(l.zone)}</Badge>}
                          {l.cost === 0 && !l.key.startsWith("missing_") && (
                            <Badge tone="warning" className="ms-2">
                              {t("noPriceLine")}
                            </Badge>
                          )}
                        </span>
                        {l.key.startsWith("missing_") && (
                          <span className="mt-1.5 grid gap-0.5 rounded-lg bg-danger-soft px-2.5 py-1.5 text-[12px] text-danger">
                            {explain(l.key.slice("missing_".length)).map((x) => (
                              <span key={x}>• {x}</span>
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-2 font-latin tabular-nums">
                        {fmt.money(l.cost)}
                        <ChevronDown
                          className={cn(
                            "size-4 text-subtle-foreground transition",
                            isOpen && "rotate-180",
                          )}
                        />
                      </span>
                    </button>
                    {isOpen && (
                      <div className="mx-5 mb-3 grid gap-2 rounded-xl bg-surface-sunken p-3.5 text-[13px]">
                        <p>
                          <span className="font-bold">{t("formula")}: </span>
                          <span>{formulaText(l.formula)}</span>
                        </p>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                          {Object.entries(l.inputs).map(([k, val]) => (
                            <div key={k} className="flex justify-between gap-2">
                              <dt className="text-muted-foreground">{inputName(k)}</dt>
                              <dd className="tabular-nums">
                                {typeof val === "number" ? trim(val) : inputName(val)}
                              </dd>
                            </div>
                          ))}
                          <div className="flex justify-between gap-2">
                            <dt className="text-muted-foreground">{inputName("need")}</dt>
                            <dd className="tabular-nums">
                              {trim(l.need)} {t.has(`lineUnit_${l.needUnit}`) ? t(`lineUnit_${l.needUnit}`) : l.needUnit}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-muted-foreground">{inputName("unitPrice")}</dt>
                            <dd className="tabular-nums">
                              {fmt.number(l.unitPrice, 2)}
                            </dd>
                          </div>
                        </dl>
                        {l.purchase.kind === "packs" &&
                          l.purchase.leftover > 0 && (
                            <p className="text-muted-foreground">
                              {t("leftoverUnit", {
                                n: trim(l.purchase.leftover),
                                unit: unitText(l.needUnit),
                              })}
                            </p>
                          )}
                        {l.purchase.kind === "bars" &&
                          l.purchase.offcuts.length > 0 && (
                            <p className="text-muted-foreground">
                              {t("offcuts", {
                                n: l.purchase.offcuts.length,
                                m: fmt.number(
                                  l.purchase.offcuts.reduce((a, b) => a + b, 0),
                                  2,
                                ),
                              })}
                            </p>
                          )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
