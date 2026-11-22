"use client";
import {
  AlertTriangle,
  Calculator,
  ChevronDown,
  Hammer,
  Lock,
  PaintBucket,
  PaintRoller,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { NumberInput } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import {
  buildEngineConfig,
  computeExterior,
  computeGypsum,
  computeInterior,
  priceProject,
  resolveScope,
  type CatalogueData,
  type EngineResult,
  type Line,
} from "@/lib/engine";
import { toNumber } from "@/lib/validation/numbers";
import { cn } from "@/lib/utils";

type Kind = "gypsum" | "interior" | "exterior";
const HATCHES = ["30x30", "40x40", "50x50", "60x60", "60x120"] as const;

const numOr = (v: string, d = 0) => {
  const n = toNumber(v);
  return typeof n === "number" && n >= 0 ? n : d;
};

/**
 * "Try the pricing": total areas in, quantities + price out, using the
 * organization's own catalogue and rates. Every line opens to show how it
 * was calculated. Nothing is saved — quotes come in Phase 3.
 */
export function CalculatorView({
  data,
  vatPercent,
}: {
  data: CatalogueData;
  vatPercent: number;
}) {
  const t = useTranslations("engine");
  const { fmt } = useFormatter();
  const [kind, setKind] = React.useState<Kind>("gypsum");
  const [v, setV] = React.useState<Record<string, string>>({
    ceil_normal: "345",
    ceil_moisture: "30",
    ceil_fire: "25",
    partitions: "40",
    trough: "",
    shadow: "",
    suspension: "rod",
    layers: "1",
    walls: "600",
    ceilings: "250",
    wet: "40",
    decorative: "30",
    colours: "2",
    ceilingColours: "1",
    variant: "new",
    crack: "",
    facade: "300",
    method: "roller",
    extColours: "1",
    scaffold: "",
    brand: "",
    gypsumBrand: "",
    margin: "",
  });
  // Arabic-keyboard digits (٢٥) are shown as 25 — numbers are always Western digits.
  const set =
    (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.target.value
        .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
        .replace(/٫/g, ".");
      setV((s) => ({ ...s, [k]: value }));
    };

  const cfg = React.useMemo(
    () => buildEngineConfig(data, { gypsumBrand: v.gypsumBrand || undefined }),
    [data, v.gypsumBrand],
  );
  const brand = v.brand || cfg.brands[0] || "";
  const margin = numOr(v.margin, cfg.commercial.targetMarginPercent);

  // Scope of work: what this client's price includes (always / optional items).
  const [choices, setChoices] = React.useState<Record<string, boolean>>({});
  const scopeKind = kind;
  const scopeVariant = kind === "interior" ? v.variant : kind === "exterior" ? v.method : v.suspension;
  const resolved = React.useMemo(
    () =>
      scopeKind
        ? resolveScope(
            cfg.rules[scopeKind],
            scopeVariant,
            Object.fromEntries(
              Object.entries(choices)
                .filter(([k]) => k.startsWith(`${scopeKind}:`))
                .map(([k, x]) => [k.split(":")[1], x]),
            ),
          )
        : null,
    [cfg, scopeKind, scopeVariant, choices],
  );
  const scope = resolved?.scope;

  const result: EngineResult = React.useMemo(() => {
    if (kind === "gypsum") {
      const hatches = Object.fromEntries(
        HATCHES.map((h) => [h, numOr(v[`hatch_${h}`] ?? "")]).filter(
          ([, n]) => (n as number) > 0,
        ),
      );
      return computeGypsum(
        {
          quickAreas: {
            normal: numOr(v.ceil_normal),
            moisture: numOr(v.ceil_moisture),
            fire: numOr(v.ceil_fire),
          },
          partitions:
            numOr(v.partitions) > 0
              ? [
                  {
                    id: "p",
                    area: numOr(v.partitions),
                    boardType: "normal",
                    layersPerFace: 1,
                  },
                ]
              : [],
          troughM: numOr(v.trough),
          shadowM: numOr(v.shadow),
          hatches,
          scope,
        },
        cfg.gypsum.catalogue,
        {
          ...cfg.gypsum.params,
          suspension: v.suspension === "vertical_c" ? "vertical_c" : "rod",
          layers: Math.max(1, Math.round(numOr(v.layers, 1))),
        },
      );
    }
    if (kind === "interior") {
      const zones = [
        ...(numOr(v.wet) > 0
          ? [{ id: "wet", kind: "wet" as const, wallArea: numOr(v.wet) }]
          : []),
        ...(numOr(v.decorative) > 0
          ? [
              {
                id: "decorative",
                kind: "decorative" as const,
                wallArea: numOr(v.decorative),
              },
            ]
          : []),
      ];
      return computeInterior(
        {
          wallArea: numOr(v.walls),
          ceilingArea: numOr(v.ceilings),
          zones,
          colours: Math.max(1, Math.round(numOr(v.colours, 1))),
          ceilingColours: Math.max(1, Math.round(numOr(v.ceilingColours, 1))),
          variant: v.variant === "repaint" ? "repaint" : "new",
          brand,
          crackM: numOr(v.crack),
          scope,
        },
        cfg.paintProducts,
        cfg.interior,
      );
    }
    return computeExterior(
      {
        area: numOr(v.facade),
        method:
          v.method === "spray"
            ? "spray"
            : v.method === "profile"
              ? "profile"
              : "roller",
        colours: Math.max(1, Math.round(numOr(v.extColours, 1))),
        brand,
        scaffoldDays: numOr(v.scaffold),
        scope,
      },
      cfg.paintProducts,
      { ...cfg.exterior },
    );
  }, [kind, v, cfg, brand, scope]);

  const price = priceProject([result], {
    contingencyPercent: cfg.commercial.contingencyPercent,
    marginPercent: Math.min(95, margin),
    roundingStep: cfg.commercial.roundingStep,
    method: "unit",
    vatPercent,
  });

  // Only warn about products this calculation actually uses.
  const PAINT_SUNDRIES = new Set([
    "sandpaper",
    "floor_nylon",
    "masking_tape",
    "crack_material",
  ]);
  const relevant = (role: string) =>
    kind === "gypsum"
      ? !cfg.paintProducts.some((p) => p.role === role) &&
        !PAINT_SUNDRIES.has(role) &&
        role !== "sealer"
      : resolved?.scope[role] === true ||
        (kind === "interior" && PAINT_SUNDRIES.has(role));
  const fieldName = (f: "coverage" | "pack" | "price") =>
    t(
      f === "coverage"
        ? "field_coverage"
        : f === "pack"
          ? "field_pack"
          : "field_price",
    );
  const warnings = [
    ...cfg.warnings
      .filter(
        (w) =>
          (w.kind === "missing_price" || w.kind === "missing_data") &&
          relevant(w.role),
      )
      .map((w) =>
        w.kind === "missing_data"
          ? t("missingDataWarn", {
              product: w.product,
              fields: w.fields.map(fieldName).join("، "),
            })
          : t("missingDataWarn", {
              product: "product" in w ? w.product : "",
              fields: fieldName("price"),
            }),
      ),
    ...result.warnings
      .filter(
        (w) =>
          !(
            w.startsWith("missing_product_") &&
            cfg.warnings.some(
              (x) =>
                x.kind === "missing_data" &&
                x.role === w.slice("missing_product_".length),
            )
          ),
      )
      .map((w) =>
        w === "quick_estimate"
          ? t("warnQuick")
          : w.startsWith("brand_fallback_")
            ? t("warnBrandFallback")
            : w.startsWith("missing_product_")
              ? t("warnMissingProductNamed", {
                  role: t.has(`role_${w.slice(16)}`) ? t(`role_${w.slice(16)}`) : w.slice(16),
                })
              : w,
      ),
  ];

  const num = (k: string, label: string, suffix?: string) => (
    <Field id={`calc-${k}`} label={label}>
      <NumberInput
        id={`calc-${k}`}
        value={v[k] ?? ""}
        onChange={set(k)}
        suffix={suffix}
      />
    </Field>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      <div className="grid content-start gap-5 rounded-3xl border border-border bg-surface p-5">
        <Segmented
          name={t("calcKind")}
          value={kind}
          onChange={setKind}
          options={[
            { value: "gypsum", label: t("familyGypsum"), icon: <Hammer /> },
            { value: "interior", label: t("interior"), icon: <PaintRoller /> },
            { value: "exterior", label: t("exterior"), icon: <PaintBucket /> },
          ]}
        />
        {kind === "gypsum" && (
          <>
            <div className="grid grid-cols-3 gap-3">
              {num("ceil_normal", t("boardNormal"), "m²")}
              {num("ceil_moisture", t("boardMoisture"), "m²")}
              {num("ceil_fire", t("boardFire"), "m²")}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {num("partitions", t("partitions"), "m²")}
              <Field id="calc-susp" label={t("suspension")}>
                <NativeSelect
                  id="calc-susp"
                  value={v.suspension}
                  onChange={set("suspension")}
                >
                  <option value="rod">{t("suspRod")}</option>
                  <option value="vertical_c">{t("suspVertical")}</option>
                </NativeSelect>
              </Field>
              {num("layers", t("layers"))}
            </div>
            <details className="group rounded-2xl border border-border p-4 open:pb-5">
              <summary className="flex cursor-pointer list-none items-center justify-between text-[14px] font-bold">
                {t("optionalFeatures")}
                <ChevronDown className="size-4 transition group-open:rotate-180" />
              </summary>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {t("optionalFeaturesHint")}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {num("trough", t("trough"), "m")}
                {num("shadow", t("shadow"), "m")}
                {HATCHES.map((h) => (
                  <React.Fragment key={h}>
                    {num(
                      `hatch_${h}`,
                      t("hatch", { size: h.replace("x", "×") }),
                    )}
                  </React.Fragment>
                ))}
              </div>
            </details>
          </>
        )}
        {kind === "interior" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {num("walls", t("walls"), "m²")}
              {num("ceilings", t("ceilings"), "m²")}
              {num("wet", t("wetZone"), "m²")}
              {num("decorative", t("decorativeZone"), "m²")}
              {num("colours", t("wallColours"))}
              {num("ceilingColours", t("ceilingColours"))}
              <Field id="calc-variant" label={t("system")}>
                <NativeSelect
                  id="calc-variant"
                  value={v.variant}
                  onChange={set("variant")}
                >
                  <option value="new">{t("variantNew")}</option>
                  <option value="repaint">{t("variantRepaint")}</option>
                </NativeSelect>
              </Field>
              {num("crack", t("cracks"), "m")}
            </div>
          </>
        )}
        {kind === "exterior" && (
          <div className="grid grid-cols-2 gap-3">
            {num("facade", t("facadeArea"), "m²")}
            <Field id="calc-method" label={t("method")}>
              <NativeSelect
                id="calc-method"
                value={v.method}
                onChange={set("method")}
              >
                <option value="roller">{t("methodRoller")}</option>
                <option value="profile">{t("methodProfile")}</option>
                <option value="spray">{t("methodSpray")}</option>
              </NativeSelect>
            </Field>
            {num("extColours", t("wallColours"))}
            {num("scaffold", t("scaffoldDays"))}
          </div>
        )}
        {resolved && (
          <div className="grid gap-2 rounded-2xl border border-border p-4">
            <p className="text-[14px] font-bold">{t("scopeTitle")}</p>
            <p className="text-[12px] text-muted-foreground">
              {t("scopeHint")}
            </p>
            {(() => {
              const roleName = (role: string) => (t.has(`role_${role}`) ? t(`role_${role}`) : role);
              const applying = resolved.items.filter((it) => it.applies);
              const optional = applying.filter((it) => it.optional);
              const always = applying.filter((it) => !it.optional);
              return (
                <>
                  {optional.length === 0 && <p className="text-[13px] text-muted-foreground">{t("scopeAllAlways")}</p>}
                  <ul className="mt-1 grid gap-1">
                    {optional.map((it) => {
                      const name = roleName(it.role);
                      const parentOff = it.requires && !resolved.scope[it.requires];
                      return (
                        <li key={it.role} className="flex min-h-10 items-center justify-between gap-3">
                          <label
                            htmlFor={`scope-${it.role}`}
                            className={cn("text-[14px]", !it.included && "text-muted-foreground line-through decoration-1")}
                          >
                            {name}
                            {parentOff && (
                              <span className="ms-2 text-[11px] no-underline">{t("needsParent", { parent: roleName(it.requires!) })}</span>
                            )}
                          </label>
                          <Switch
                            id={`scope-${it.role}`}
                            checked={it.included}
                            disabled={!!parentOff}
                            aria-label={name}
                            onCheckedChange={(x) => setChoices((c) => ({ ...c, [`${scopeKind}:${it.role}`]: x }))}
                          />
                        </li>
                      );
                    })}
                  </ul>
                  {always.length > 0 && (
                    <details className="group mt-1 rounded-xl bg-surface-sunken/60 px-3 py-2">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[13px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Lock className="size-3.5" /> {t("alwaysCount", { n: always.length })}
                        </span>
                        <ChevronDown className="size-4 transition group-open:rotate-180" />
                      </summary>
                      <p className="mt-2 text-[13px] leading-6">{always.map((it) => roleName(it.role)).join("، ")}</p>
                      <p className="mt-1 text-[12px] text-subtle-foreground">{t("changeInSystems")}</p>
                    </details>
                  )}
                </>
              );
            })()}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-5">
          {kind === "gypsum" && cfg.gypsumBrands.length > 0 && (
            <Field id="calc-gbrand" label={t("brand")}>
              <NativeSelect
                id="calc-gbrand"
                value={v.gypsumBrand}
                onChange={set("gypsumBrand")}
              >
                <option value="">{t("cheapestBrand")}</option>
                {cfg.gypsumBrands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {kind !== "gypsum" && (
            <Field id="calc-brand" label={t("brand")}>
              <NativeSelect
                id="calc-brand"
                value={brand}
                onChange={set("brand")}
              >
                {cfg.brands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field id="calc-margin" label={t("margin")}>
            <NumberInput
              id="calc-margin"
              value={v.margin}
              placeholder={String(cfg.commercial.targetMarginPercent)}
              onChange={set("margin")}
              suffix="%"
            />
          </Field>
        </div>
      </div>

      <div className="grid content-start gap-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi label={t("totalCost")} value={fmt.money(price.cost)} />
          <Kpi
            label={t("sellingPrice")}
            value={fmt.money(price.subtotal)}
            strong
          />
          <Kpi
            label={t("achievedMargin")}
            value={fmt.percent(price.marginPercent / 100)}
            sub={t("markup", { n: fmt.number(price.markupPercent, 1) })}
          />
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <table className="w-full text-[14px]">
            <thead className="bg-surface-sunken/60 text-[12px] text-muted-foreground">
              <tr>
                <th className="whitespace-nowrap px-4 py-2.5 text-start font-bold">
                  {t("workType")}
                </th>
                <th className="px-4 py-2.5 text-end font-bold">{t("area")}</th>
                <th className="px-4 py-2.5 text-end font-bold">{t("cost")}</th>
                <th className="px-4 py-2.5 text-end font-bold">
                  {t("pricePerM2")}
                </th>
                <th className="px-4 py-2.5 text-end font-bold">{t("total")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-latin tabular-nums">
              {price.byWorkType.map((w) => (
                <tr key={w.workType}>
                  <td className="px-4 py-3 font-sans font-bold">
                    {t(`wt_${w.workType}`)}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {fmt.number(w.area, 1)}
                  </td>
                  <td className="px-4 py-3 text-end">{fmt.money(w.cost)}</td>
                  <td className="px-4 py-3 text-end font-bold text-primary">
                    {fmt.money(w.pricePerM2)}
                  </td>
                  <td className="px-4 py-3 text-end">{fmt.money(w.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {vatPercent > 0 && (
            <p className="flex justify-between border-t border-border px-4 py-3 text-[14px]">
              <span>{t("vatLine", { n: vatPercent })}</span>
              <span className="font-latin tabular-nums">
                {fmt.money(price.vat)}
              </span>
            </p>
          )}
        </div>

        {warnings.length > 0 && (
          <ul className="grid gap-1.5 rounded-2xl bg-warning-soft px-5 py-3.5 text-[13px]">
            {[...new Set(warnings)].map((w) => (
              <li key={w} className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {w}
              </li>
            ))}
          </ul>
        )}

        <LinesTable lines={result.lines} />
      </div>
    </div>
  );
}

function Kpi({
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

function LinesTable({ lines }: { lines: Line[] }) {
  const t = useTranslations("engine");
  const { fmt } = useFormatter();
  const [open, setOpen] = React.useState<string | null>(null);
  const groups: Line["group"][] = ["material", "labour", "hatch", "extra"];

  const qn = (x: number) =>
    fmt.number(x, Number.isInteger(x) ? 0 : Number.isInteger(x * 10) ? 1 : 2);

  function purchase(l: Line) {
    const p = l.purchase;
    if (p.kind === "packs")
      return p.packs.map((k) => `${k.count} × ${qn(k.size)}`).join(" + ");
    if (p.kind === "bars")
      return t("barsBuy", { n: p.bars, len: qn(p.stockLength) });
    return `${qn(l.qty)} ${t.has(`lineUnit_${l.unit}`) ? t(`lineUnit_${l.unit}`) : l.unit}`;
  }

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
                          <span className="font-latin">{purchase(l)}</span>
                          {l.zone && <Badge className="ms-2">{l.zone}</Badge>}
                          {l.cost === 0 && (
                            <Badge tone="warning" className="ms-2">
                              {t("noPriceLine")}
                            </Badge>
                          )}
                        </span>
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
                          <span dir="ltr" className="font-latin">
                            {l.formula}
                          </span>
                        </p>
                        <dl
                          className="grid grid-cols-2 gap-x-4 gap-y-1 font-latin sm:grid-cols-3"
                          dir="ltr"
                        >
                          {Object.entries(l.inputs).map(([k, val]) => (
                            <div key={k} className="flex justify-between gap-2">
                              <dt className="text-muted-foreground">{k}</dt>
                              <dd className="tabular-nums">
                                {typeof val === "number"
                                  ? fmt.number(val, 3)
                                  : val}
                              </dd>
                            </div>
                          ))}
                          <div className="flex justify-between gap-2">
                            <dt className="text-muted-foreground">need</dt>
                            <dd className="tabular-nums">
                              {fmt.number(l.need, 2)} {l.needUnit}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-muted-foreground">
                              unit price
                            </dt>
                            <dd className="tabular-nums">
                              {fmt.number(l.unitPrice, 2)}
                            </dd>
                          </div>
                        </dl>
                        {l.purchase.kind === "packs" &&
                          l.purchase.leftover > 0 && (
                            <p className="text-muted-foreground">
                              {t("leftover", {
                                n: fmt.number(l.purchase.leftover, 2),
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
