"use client";
import { AlertTriangle, Boxes, EyeOff, PaintBucket, Pencil, Plus, Search, Sparkles, Tag, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { FormDialog, NumberInput, bool, str, useActionRunner } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import type { ActionResult } from "@/lib/actions";
import { CATEGORIES_BY_FAMILY, CATEGORY_SPEC, rolesFor } from "@/lib/catalogue/product-kinds";
import { brandCoverage, lineMissing, type LineBrand, type LinePack, type ProductLine } from "@/lib/catalogue/product-lines";
import { familyOf, type ProductCategory, type ProductFamily, type PurchaseUnit } from "@/lib/supabase/database.types";
import { toNumber } from "@/lib/validation/numbers";
import { cn } from "@/lib/utils";
import { SwitchField } from "./services-view";

export type ProductLinesActions = {
  seed: () => Promise<ActionResult>;
  saveLine: (i: Record<string, unknown>) => Promise<ActionResult>;
  addBrand: (i: Record<string, unknown>) => Promise<ActionResult>;
  updateBrand: (i: Record<string, unknown>) => Promise<ActionResult>;
  addPack: (i: Record<string, unknown>) => Promise<ActionResult>;
  deletePack: (i: Record<string, unknown>) => Promise<ActionResult>;
  addPrice: (i: Record<string, unknown>) => Promise<ActionResult>;
};

type BrandOption = { id: string; name: string; families: ProductFamily[] };
const DEFAULT_CAT: Record<ProductFamily, ProductCategory> = { paint: "finish_paint", gypsum: "gypsum_board", other: "other" };

/**
 * Products as the owner thinks of them:
 *   PRODUCT (type + coverage per litre, entered once)
 *     └─ BRANDS — each with its pack sizes and prices.
 */
export function ProductLinesView({
  lines,
  unlinked = [],
  brands,
  suppliers,
  canManage,
  canSeeCosts,
  actions,
}: {
  lines: ProductLine[];
  unlinked?: LineBrand[];
  brands: BrandOption[];
  suppliers: { id: string; name: string }[];
  canManage: boolean;
  canSeeCosts: boolean;
  actions?: ProductLinesActions;
}) {
  const t = useTranslations("engine");
  const tc = useTranslations("common");
  const { fmt } = useFormatter();
  const { run, pending, fieldText } = useActionRunner();
  const [family, setFamily] = React.useState<ProductFamily>("paint");
  const [query, setQuery] = React.useState("");
  const [lineDialog, setLineDialog] = React.useState<ProductLine | "new" | null>(null);
  const [newCat, setNewCat] = React.useState<ProductCategory | null>(null);
  const [brandFor, setBrandFor] = React.useState<ProductLine | null>(null);
  const [packFor, setPackFor] = React.useState<{ line: ProductLine; brand: LineBrand } | null>(null);
  const [priceFor, setPriceFor] = React.useState<{ line: ProductLine; brand: LineBrand; pack: LinePack } | null>(null);
  const [coverageFor, setCoverageFor] = React.useState<{ line: ProductLine; brand: LineBrand } | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const qn = (x: number) => fmt.number(x, Number.isInteger(x) ? 0 : Number.isInteger(x * 10) ? 1 : 2);
  const unitLabel = (u: PurchaseUnit) => t(`unit_${u}`);
  const brandName = (b: LineBrand) => b.brand ?? t("genericBrand");

  if (lines.length === 0) {
    return (
      <EmptyState
        icon={<Boxes />}
        title={t("emptyTitle")}
        description={t("emptyBody")}
        action={
          canManage &&
          canSeeCosts && (
            <Button loading={pending} onClick={() => run(actions?.seed)}>
              <Sparkles /> {t("seed")}
            </Button>
          )
        }
      />
    );
  }

  const q = query.trim().toLowerCase();
  const visible = lines.filter(
    (l) => familyOf(l.category) === family && (!q || [l.name, ...l.brands.map((b) => b.brand ?? "")].some((v) => v.toLowerCase().includes(q))),
  );

  /** "يغطي 6.67 م² للتر للوجه" / "عود 3 م" / … */
  function spec(l: ProductLine) {
    const kind = CATEGORY_SPEC[l.category].kind;
    if (kind === "coverage") return l.coverage_per_unit ? t("perUnitLine", { area: qn(l.coverage_per_unit), unit: unitLabel(l.unit) }) : null;
    if (kind === "board") return l.area_m2 ? t("boardLine", { area: qn(l.area_m2) }) : null;
    if (kind === "bar") return l.length_m ? t("barLine", { length: qn(l.length_m) }) : null;
    if (kind === "contents") return l.contents_per_pack ? `${t(`contents_${CATEGORY_SPEC[l.category].contents}`)}: ${qn(l.contents_per_pack)}` : null;
    return t(`priceOf_unit`, { unit: unitLabel(l.unit) });
  }

  /** Paint: cost per m² for one coat with this brand's best-value pack. */
  function perM2(l: ProductLine, b: LineBrand) {
    const cov = brandCoverage(l, b);
    const perUnit = b.packs.filter((k) => k.best != null).map((k) => k.best! / k.size);
    if (!cov || !perUnit.length) return null;
    return Math.min(...perUnit) / cov;
  }

  const supplierSelect = (name: string, id: string) => (
    <Field id={id} label={t("supplier")} optional={tc("optional")}>
      <NativeSelect name={name} defaultValue="">
        <option value="">—</option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );

  // --- Product (line) dialog: type + coverage, entered once ---------------------------
  function lineForm() {
    const l = lineDialog === "new" ? undefined : lineDialog!;
    const cat = l?.category ?? newCat ?? DEFAULT_CAT[family];
    const kind = CATEGORY_SPEC[cat].kind;
    const unit = unitLabel(l?.unit ?? CATEGORY_SPEC[cat].unit);
    const close = () => {
      setLineDialog(null);
      setNewCat(null);
      setErrors({});
    };
    // Coverage is asked the way it's printed on the pack: "18 L covers 120 m²" → stored per litre.
    const refSize = l?.brands.flatMap((b) => b.packs.map((k) => k.size))[0] ?? (CATEGORY_SPEC[cat].unit === "kg" ? 20 : 18);
    return (
      <FormDialog
        open
        onOpenChange={(v) => !v && close()}
        title={l ? t("editLine") : t("newLine")}
        description={t("lineHint")}
        pending={pending}
        onSubmit={(fd) => {
          const size = toNumber(str(fd, "ref_size"));
          const area = toNumber(str(fd, "ref_area"));
          const perUnit = typeof size === "number" && typeof area === "number" && size > 0 ? area / size : "";
          run(
            actions &&
              (() =>
                actions.saveLine({
                  ...(l?.id ? { id: l.id } : {}),
                  name: str(fd, "name"),
                  category: cat,
                  coverage_per_unit: kind === "coverage" ? perUnit : "",
                  length_m: str(fd, "length_m"),
                  contents_per_pack: str(fd, "contents_per_pack"),
                  area_m2: str(fd, "area_m2"),
                  colour_specific: kind === "coverage" ? bool(fd, "colour_specific") : false,
                  waste_percent: str(fd, "waste_percent"),
                  ...(l ? {} : { role: str(fd, "role") || null }),
                })),
            {
              onFieldErrors: (e) => setErrors(e.coverage_per_unit ? { ...e, ref_area: e.coverage_per_unit } : e),
              onSuccess: close,
            },
          );
        }}
      >
        {!l && (
          <Field id="ln-cat" label={t("whatProduct")}>
            <NativeSelect value={cat} onChange={(e) => setNewCat(e.target.value as ProductCategory)}>
              {(["paint", "gypsum", "other"] as const).map((f) => (
                <optgroup key={f} label={t(f === "paint" ? "familyPaint" : f === "gypsum" ? "familyGypsum" : "familyOther")}>
                  {CATEGORIES_BY_FAMILY[f].map((c) => (
                    <option key={c} value={c}>
                      {t(`cat_${c}`)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </NativeSelect>
          </Field>
        )}
        {!l && rolesFor(cat).length > 1 && (
          <Field id="ln-role" label={t("lineRole")}>
            <NativeSelect name="role" key={cat} defaultValue={rolesFor(cat)[0]}>
              {rolesFor(cat).map((r) => (
                <option key={r} value={r}>
                  {t.has(`role_${r}`) ? t(`role_${r}`) : r.replace("hatch_", "").replace("x", "×")}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field id="ln-name" label={t("productName")} error={fieldText(errors.name)}>
          <Input name="name" defaultValue={l?.name ?? t(`cat_${cat}`)} />
        </Field>

        <div className="grid gap-4 rounded-2xl bg-surface-sunken/70 p-4">
          <p className="text-[13px] text-muted-foreground">{t(`lineKindHint_${kind}`)}</p>
          {kind === "coverage" && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field id="ln-ref" label={t("refPackSizeQ", { unit })}>
                  <NumberInput name="ref_size" defaultValue={refSize} suffix={unit} />
                </Field>
                <Field id="ln-area" label={t("coversQ")} error={fieldText(errors.ref_area)}>
                  <NumberInput name="ref_area" defaultValue={l?.coverage_per_unit ? Math.round(l.coverage_per_unit * refSize * 100) / 100 : ""} suffix="m²" />
                </Field>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3">
                <span className="text-[14px]">
                  {t("colourSpecific")}
                  <span className="block text-[12px] text-muted-foreground">{t("colourSpecificHint")}</span>
                </span>
                <SwitchField name="colour_specific" defaultChecked={l?.colour_specific ?? ["finish_paint", "ceiling_paint", "moisture_paint", "decorative", "exterior_paint", "spray_paint", "profile_texture"].includes(cat)} />
              </label>
            </>
          )}
          {kind === "board" && (
            <Field id="ln-areab" label={t("boardArea")} hint={t("boardAreaHint")} error={fieldText(errors.area_m2)}>
              <NumberInput name="area_m2" defaultValue={l?.area_m2 ?? 2.88} suffix="m²" />
            </Field>
          )}
          {kind === "bar" && (
            <Field id="ln-len" label={t("length")} error={fieldText(errors.length_m)}>
              <NumberInput name="length_m" defaultValue={l?.length_m ?? 3} suffix="m" />
            </Field>
          )}
          {kind === "contents" && (
            <Field id="ln-cont" label={t(`contents_${CATEGORY_SPEC[cat].contents}`)} error={fieldText(errors.contents_per_pack)}>
              <NumberInput name="contents_per_pack" defaultValue={l?.contents_per_pack ?? ""} />
            </Field>
          )}
        </div>
        <Field id="ln-waste" label={t("waste")} hint={t("wasteDefault")} error={fieldText(errors.waste_percent)}>
          <NumberInput name="waste_percent" defaultValue={l?.waste_percent ?? ""} suffix="%" />
        </Field>
      </FormDialog>
    );
  }

  // --- Add a brand under a product -------------------------------------------------
  function brandForm(l: ProductLine) {
    const kind = CATEGORY_SPEC[l.category].kind;
    const fam = familyOf(l.category);
    const taken = new Set(l.brands.filter((b) => b.is_active).map((b) => b.brand_id));
    const options = brands.filter((b) => b.families.includes(fam) && !taken.has(b.id));
    const unit = unitLabel(l.unit);
    return (
      <FormDialog
        open
        onOpenChange={(v) => !v && (setBrandFor(null), setErrors({}))}
        title={t("addBrandTo", { product: l.name })}
        description={kind === "coverage" && l.coverage_per_unit ? t("addBrandHint", { area: qn(l.coverage_per_unit), unit }) : undefined}
        pending={pending}
        onSubmit={(fd) =>
          run(
            actions &&
              (() =>
                actions.addBrand({
                  line_id: l.id,
                  brand_id: str(fd, "brand_id"),
                  new_brand: str(fd, "new_brand") || null,
                  pack_size: kind === "coverage" ? str(fd, "pack_size") : "",
                  pack_label: null,
                  unit_price: canSeeCosts ? str(fd, "unit_price") : "",
                  supplier_id: canSeeCosts ? str(fd, "supplier_id") : "",
                  coverage_per_unit: "",
                })),
            { onFieldErrors: setErrors, onSuccess: () => (setBrandFor(null), setErrors({})) },
          )
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field id="br-brand" label={t("brand")}>
            <NativeSelect name="brand_id" defaultValue={options[0]?.id ?? ""}>
              <option value="">{t("genericBrand")}</option>
              {options.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="br-new" label={t("newBrand")} optional={tc("optional")}>
            <Input name="new_brand" placeholder={t(fam === "gypsum" ? "newBrandPhGypsum" : "newBrandPh")} />
          </Field>
          {kind === "coverage" && (
            <Field id="br-size" label={t("packSizeIn", { unit })} error={fieldText(errors.pack_size)}>
              <NumberInput name="pack_size" defaultValue={l.unit === "kg" ? 20 : 18} suffix={unit} />
            </Field>
          )}
          {canSeeCosts && (
            <Field id="br-price" label={t(`priceOf_${kind}`, { unit })} optional={tc("optional")} error={fieldText(errors.unit_price)}>
              <NumberInput name="unit_price" suffix={t("sar")} />
            </Field>
          )}
          {canSeeCosts && supplierSelect("supplier_id", "br-sup")}
        </div>
      </FormDialog>
    );
  }

  function packForm({ line, brand }: { line: ProductLine; brand: LineBrand }) {
    const unit = unitLabel(line.unit);
    const cov = brandCoverage(line, brand);
    return (
      <FormDialog
        open
        onOpenChange={(v) => !v && setPackFor(null)}
        title={t("addPack")}
        description={`${line.name} — ${brandName(brand)}`}
        pending={pending}
        onSubmit={(fd) =>
          run(
            actions &&
              (() =>
                actions.addPack({
                  product_id: brand.id,
                  size: str(fd, "size"),
                  label: null,
                  unit_price: canSeeCosts ? str(fd, "unit_price") : "",
                  supplier_id: canSeeCosts ? str(fd, "supplier_id") : "",
                })),
            { onFieldErrors: setErrors, onSuccess: () => setPackFor(null) },
          )
        }
      >
        {cov && <p className="text-[13px] text-muted-foreground">{t("packCoverageAuto", { area: qn(cov), unit })}</p>}
        <div className="grid grid-cols-2 gap-4">
          <Field id="pk-size" label={t("packSizeIn", { unit })} error={fieldText(errors.size)}>
            <NumberInput name="size" suffix={unit} />
          </Field>
          {canSeeCosts && (
            <Field id="pk-price" label={t("packPrice")} optional={tc("optional")} error={fieldText(errors.unit_price)}>
              <NumberInput name="unit_price" suffix={t("sar")} />
            </Field>
          )}
          {canSeeCosts && supplierSelect("supplier_id", "pk-sup")}
        </div>
      </FormDialog>
    );
  }

  function priceForm({ line, brand, pack }: { line: ProductLine; brand: LineBrand; pack: LinePack }) {
    return (
      <FormDialog
        open
        onOpenChange={(v) => !v && setPriceFor(null)}
        title={t("newPrice")}
        description={`${line.name} — ${brandName(brand)} · ${pack.label ?? `${qn(pack.size)} ${unitLabel(line.unit)}`}`}
        pending={pending}
        onSubmit={(fd) =>
          run(
            actions &&
              (() =>
                actions.addPrice({
                  product_id: brand.id,
                  pack_id: pack.id,
                  unit_price: str(fd, "unit_price"),
                  supplier_id: str(fd, "supplier_id"),
                  source: str(fd, "source") || null,
                })),
            { onFieldErrors: setErrors, onSuccess: () => setPriceFor(null) },
          )
        }
      >
        {pack.prices.length > 0 && (
          <ul className="grid gap-1.5 rounded-xl bg-surface-sunken p-3 text-[13px]">
            {pack.prices.map((x, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{x.supplier_name ?? t("noSupplier")}</span>
                <span className="font-latin tabular-nums">{fmt.money(x.unit_price)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field id="pp-price" label={t("packPrice")} error={fieldText(errors.unit_price)}>
            <NumberInput name="unit_price" suffix={t("sar")} autoFocus />
          </Field>
          {supplierSelect("supplier_id", "pp-sup")}
        </div>
        <Field id="pp-src" label={t("priceSource")} optional={tc("optional")}>
          <Input name="source" placeholder={t("priceSourcePh")} />
        </Field>
      </FormDialog>
    );
  }

  function coverageForm({ line, brand }: { line: ProductLine; brand: LineBrand }) {
    const unit = unitLabel(line.unit);
    const ref = brand.packs[0]?.size ?? 18;
    return (
      <FormDialog
        open
        onOpenChange={(v) => !v && setCoverageFor(null)}
        title={t("brandCoverageTitle", { brand: brandName(brand) })}
        description={line.coverage_per_unit ? t("brandCoverageHint", { area: qn(line.coverage_per_unit), unit }) : undefined}
        pending={pending}
        onSubmit={(fd) => {
          const area = toNumber(str(fd, "ref_area"));
          const size = toNumber(str(fd, "ref_size"));
          const perUnit = typeof area === "number" && typeof size === "number" && size > 0 ? area / size : null;
          run(actions && (() => actions.updateBrand({ id: brand.id, coverage_per_unit: perUnit })), { onSuccess: () => setCoverageFor(null) });
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field id="bc-size" label={t("refPackSizeQ", { unit })}>
            <NumberInput name="ref_size" defaultValue={ref} suffix={unit} />
          </Field>
          <Field id="bc-area" label={t("coversQ")} hint={t("brandCoverageEmpty")}>
            <NumberInput name="ref_area" defaultValue={brand.coverage_per_unit ? Math.round(brand.coverage_per_unit * ref * 100) / 100 : ""} suffix="m²" />
          </Field>
        </div>
      </FormDialog>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          name={t("family")}
          value={family}
          onChange={setFamily}
          options={[
            { value: "paint", label: t("familyPaint"), icon: <PaintBucket /> },
            { value: "gypsum", label: t("familyGypsum"), icon: <Boxes /> },
            { value: "other", label: t("familyOther"), icon: <Tag /> },
          ]}
        />
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4 text-subtle-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} className="ps-10" aria-label={t("search")} />
        </div>
        {canManage && (
          <Button onClick={() => setLineDialog("new")}>
            <Plus /> {t("newLine")}
          </Button>
        )}
      </div>

      {unlinked.length > 0 && canManage && (
        <section className="rounded-2xl border border-danger/30 bg-danger-soft/40 p-4">
          <p className="mb-2 flex items-center gap-2 text-[14px] font-bold text-danger">
            <AlertTriangle className="size-4" /> {t("unlinkedTitle")}
          </p>
          <ul className="grid gap-2">
            {unlinked.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2">
                <span className="text-[14px]">
                  {b.name} <Badge className="ms-1">{brandName(b)}</Badge>
                </span>
                <NativeSelect
                  aria-label={t("attachTo")}
                  className="h-9 w-auto text-[13px]"
                  defaultValue=""
                  onChange={(e) => e.target.value && run(actions && (() => actions.updateBrand({ id: b.id, line_id: e.target.value })))}
                >
                  <option value="">{t("attachTo")}</option>
                  {lines.filter((l) => l.id).map((l) => (
                    <option key={l.id!} value={l.id!}>
                      {l.name}
                    </option>
                  ))}
                </NativeSelect>
              </li>
            ))}
          </ul>
        </section>
      )}

      {visible.length === 0 && <p className="py-10 text-center text-muted-foreground">{t("noResults")}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {visible.map((l) => {
          const missing = lineMissing(l);
          const kind = CATEGORY_SPEC[l.category].kind;
          const active = l.brands.filter((b) => b.is_active);
          return (
            <section key={l.id ?? l.name} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
              <header className="flex items-start justify-between gap-3 border-b border-border bg-surface-sunken/50 px-5 py-3">
                <div className="min-w-0">
                  <h3 className="text-[16px] font-bold">{l.name}</h3>
                  <p className="text-[13px] text-muted-foreground">{spec(l) ?? t("specMissing")}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {l.colour_specific && <Badge tone="info">{t("perColour")}</Badge>}
                    {l.waste_percent != null && <Badge tone="warning">{t("wasteBadge", { n: qn(l.waste_percent) })}</Badge>}
                    {missing.map((m) => (
                      <Badge key={m} tone="danger">
                        {t(`lineMissing_${m}`)}
                      </Badge>
                    ))}
                  </div>
                </div>
                {canManage && (
                  <Button variant="ghost" size="icon-sm" aria-label={t("editLine")} onClick={() => setLineDialog(l)}>
                    <Pencil />
                  </Button>
                )}
              </header>

              <ul className="flex-1 divide-y divide-border">
                {active.length === 0 && <li className="px-5 py-4 text-[13px] text-muted-foreground">{t("noBrandsYet")}</li>}
                {active.map((b) => {
                  const m2 = canSeeCosts && kind === "coverage" ? perM2(l, b) : null;
                  const cov = brandCoverage(l, b);
                  return (
                    <li key={b.id} className="grid gap-2 px-5 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-[14px] font-bold">{brandName(b)}</span>
                          {b.coverage_per_unit && (
                            <button
                              type="button"
                              disabled={!canManage}
                              onClick={() => setCoverageFor({ line: l, brand: b })}
                              className="rounded-full bg-info-soft px-2 py-0.5 text-[11px] text-info"
                            >
                              {t("ownCoverage", { area: qn(b.coverage_per_unit), unit: unitLabel(l.unit) })}
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {m2 != null && (
                            <span className="me-1 text-end">
                              <span className="block font-latin text-[15px] font-bold tabular-nums">{fmt.money(m2)}</span>
                              <span className="block text-[11px] text-muted-foreground">{t("perM2Coat")}</span>
                            </span>
                          )}
                          {canManage && kind === "coverage" && !b.coverage_per_unit && (
                            <Button variant="ghost" size="icon-sm" aria-label={t("brandCoverageTitle", { brand: brandName(b) })} onClick={() => setCoverageFor({ line: l, brand: b })}>
                              <Pencil />
                            </Button>
                          )}
                          {canManage && (
                            <Button variant="ghost" size="icon-sm" aria-label={t("hideBrand")} onClick={() => run(actions && (() => actions.updateBrand({ id: b.id, is_active: false })))}>
                              <EyeOff />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {b.packs.map((k) => (
                          <span key={k.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 ps-3 pe-1 text-[13px]">
                            <span>
                              {k.label ?? `${qn(k.size)} ${unitLabel(l.unit)}`}
                              {kind === "coverage" && cov && <span className="text-muted-foreground"> · {t("packCovers", { area: qn(cov * k.size) })}</span>}
                            </span>
                            {canSeeCosts && (
                              <button
                                type="button"
                                disabled={!canManage}
                                onClick={() => setPriceFor({ line: l, brand: b, pack: k })}
                                className={cn(
                                  "rounded-full px-2 py-0.5 font-latin tabular-nums",
                                  k.best == null ? "bg-warning-soft text-[color-mix(in_oklch,var(--warning)_70%,var(--foreground))]" : "bg-primary-soft text-primary",
                                  canManage && "hover:ring-2 hover:ring-primary/30",
                                )}
                                aria-label={t("newPrice")}
                              >
                                {k.best == null ? t("noPrice") : fmt.money(k.best)}
                              </button>
                            )}
                            {canManage && b.packs.length > 1 && (
                              <button type="button" aria-label={t("deletePack")} className="rounded-full p-1 text-subtle-foreground hover:text-danger" onClick={() => run(actions && (() => actions.deletePack({ id: k.id })))}>
                                <Trash2 className="size-3.5" />
                              </button>
                            )}
                          </span>
                        ))}
                        {canManage && kind === "coverage" && (
                          <button type="button" onClick={() => setPackFor({ line: l, brand: b })} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-[13px] text-muted-foreground hover:text-foreground">
                            <Plus className="size-3.5" /> {t("addPack")}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {canManage && l.id && (
                <footer className="border-t border-border px-5 py-2.5">
                  <Button variant="ghost" size="sm" onClick={() => setBrandFor(l)}>
                    <Plus /> {t("addBrand")}
                  </Button>
                </footer>
              )}
            </section>
          );
        })}
      </div>

      {lineDialog && lineForm()}
      {brandFor && brandForm(brandFor)}
      {packFor && packForm(packFor)}
      {priceFor && priceForm(priceFor)}
      {coverageFor && coverageForm(coverageFor)}
    </div>
  );
}
