"use client";
import {
  Boxes,
  ChevronDown,
  PaintBucket,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import {
  FormDialog,
  NumberInput,
  bool,
  str,
  useActionRunner,
} from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import type { ActionResult } from "@/lib/actions";
import {
  CATEGORIES_BY_FAMILY,
  CATEGORY_SPEC,
  DEFAULT_ROLE,
} from "@/lib/catalogue/product-kinds";
import {
  familyOf,
  type ProductCategory,
  type ProductFamily,
  type PurchaseUnit,
} from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { SwitchField } from "./services-view";

export type ProductPack = {
  id: string;
  size: number;
  label: string | null;
  prices: {
    supplier_id: string | null;
    supplier_name: string | null;
    unit_price: number;
    since: string;
  }[];
  best: number | null;
};

export type ProductItem = {
  id: string;
  name: string;
  brand_id: string | null;
  brand: string | null;
  group_id: string | null;
  group_name: string | null;
  role: string | null;
  category: ProductCategory;
  purchase_unit: PurchaseUnit;
  ref_pack_size: number | null;
  coverage_per_pack: number | null;
  surface_factor: number;
  length_m: number | null;
  contents_per_pack: number | null;
  area_m2: number | null;
  colour_specific: boolean;
  application: "interior" | "exterior" | "both";
  waste_percent: number | null;
  notes: string | null;
  is_active: boolean;
  packs: ProductPack[];
};

export type ProductsActions = {
  seed: () => Promise<ActionResult>;
  saveProduct: (i: Record<string, unknown>) => Promise<ActionResult>;
  addPack: (i: Record<string, unknown>) => Promise<ActionResult>;
  deletePack: (i: Record<string, unknown>) => Promise<ActionResult>;
  addPrice: (i: Record<string, unknown>) => Promise<ActionResult>;
};

export type Family = ProductFamily;
const DEFAULT_CAT: Record<Family, ProductCategory> = {
  paint: "finish_paint",
  gypsum: "gypsum_board",
  other: "other",
};

export function ProductsView({
  products,
  brands,
  groups,
  suppliers,
  canManage,
  canSeeCosts,
  actions,
}: {
  products: ProductItem[];
  brands: { id: string; name: string; families: Family[] }[];
  groups: { id: string; role: string; name: string }[];
  suppliers: { id: string; name: string }[];
  canManage: boolean;
  canSeeCosts: boolean;
  actions?: ProductsActions;
}) {
  const t = useTranslations();
  const { fmt } = useFormatter();
  const { run, pending, fieldText } = useActionRunner();
  const [family, setFamily] = React.useState<Family>("paint");
  const [dialogCat, setDialogCat] = React.useState<ProductCategory | null>(
    null,
  );
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<ProductItem | "new" | null>(
    null,
  );
  const [packFor, setPackFor] = React.useState<ProductItem | null>(null);
  const [priceFor, setPriceFor] = React.useState<{
    product: ProductItem;
    pack: ProductPack;
  } | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  if (products.length === 0) {
    return (
      <EmptyState
        icon={<Boxes />}
        title={t("engine.emptyTitle")}
        description={t("engine.emptyBody")}
        action={
          canManage &&
          canSeeCosts && (
            <Button loading={pending} onClick={() => run(actions?.seed)}>
              <Sparkles /> {t("engine.seed")}
            </Button>
          )
        }
      />
    );
  }

  const q = query.trim().toLowerCase();
  const visible = products.filter(
    (p) =>
      familyOf(p.category) === family &&
      (!q ||
        [p.name, p.brand, p.group_name].some((v) =>
          v?.toLowerCase().includes(q),
        )),
  );
  // Group by equivalence group so brands that do the same job sit together.
  const sections = new Map<string, { title: string; items: ProductItem[] }>();
  for (const p of visible) {
    const key = p.group_id ?? "none";
    if (!sections.has(key))
      sections.set(key, {
        title: p.group_name ?? t("engine.ungrouped"),
        items: [],
      });
    sections.get(key)!.items.push(p);
  }

  const unitLabel = (u: PurchaseUnit) => t(`engine.unit_${u}`);
  /** 18 → "18", 2.88 → "2.88" (no trailing zeros). */
  const qn = (x: number) =>
    fmt.number(x, Number.isInteger(x) ? 0 : Number.isInteger(x * 10) ? 1 : 2);

  function describe(p: ProductItem) {
    if (p.coverage_per_pack && p.ref_pack_size)
      return t("engine.coverageLine", {
        size: qn(p.ref_pack_size),
        unit: unitLabel(p.purchase_unit),
        area: qn(p.coverage_per_pack),
      });
    if (p.area_m2) return t("engine.boardLine", { area: qn(p.area_m2) });
    if (p.length_m) return t("engine.barLine", { length: qn(p.length_m) });
    if (p.contents_per_pack)
      return t("engine.contentsLine", { n: qn(p.contents_per_pack) });
    return unitLabel(p.purchase_unit);
  }

  /** Paint: cost per m² for one coat with the best-value pack. */
  function perM2(p: ProductItem) {
    if (!p.coverage_per_pack || !p.ref_pack_size) return null;
    const perUnit = p.packs
      .filter((k) => k.best != null)
      .map((k) => k.best! / k.size);
    if (!perUnit.length) return null;
    return (
      (Math.min(...perUnit) * p.ref_pack_size) /
      (p.coverage_per_pack * p.surface_factor)
    );
  }

  function productDialog() {
    const p = editing === "new" ? undefined : editing!;
    const cat = dialogCat ?? p?.category ?? DEFAULT_CAT[family];
    const spec = CATEGORY_SPEC[cat];
    const fam = familyOf(cat);
    // Only brands that actually make this kind of product (paint brands don't make boards).
    const brandOptions = brands.filter(
      (b) => b.families.includes(fam) || b.id === p?.brand_id,
    );
    // Only "roles" that hold this category, so a board can't be filed under wall paint.
    const groupCats = new Map<string, Set<ProductCategory>>();
    for (const x of products)
      if (x.group_id)
        groupCats.set(
          x.group_id,
          (groupCats.get(x.group_id) ?? new Set()).add(x.category),
        );
    const groupOptions = groups.filter(
      (g) =>
        !groupCats.has(g.id) ||
        groupCats.get(g.id)!.has(cat) ||
        g.id === p?.group_id,
    );
    const unit = unitLabel(spec.unit);
    const close = () => {
      setEditing(null);
      setDialogCat(null);
      setErrors({});
    };
    return (
      <FormDialog
        open
        wide
        onOpenChange={(v) => !v && close()}
        title={p ? t("engine.editProduct") : t("engine.newProduct")}
        pending={pending}
        onSubmit={(fd) =>
          run(
            actions &&
              (() =>
                actions.saveProduct({
                  ...(p ? { id: p.id } : {}),
                  name: str(fd, "name"),
                  brand_id: str(fd, "brand_id"),
                  new_brand: str(fd, "new_brand") || null,
                  equivalence_group_id: str(fd, "equivalence_group_id"),
                  category: cat,
                  purchase_unit: spec.unit,
                  ref_pack_size: str(fd, "ref_pack_size"),
                  coverage_per_pack: str(fd, "coverage_per_pack"),
                  surface_factor: str(fd, "surface_factor") || "1",
                  length_m: str(fd, "length_m"),
                  contents_per_pack: str(fd, "contents_per_pack"),
                  area_m2: str(fd, "area_m2"),
                  colour_specific: bool(fd, "colour_specific"),
                  application:
                    str(fd, "application") ||
                    (fam === "paint" ? "interior" : "both"),
                  waste_percent: str(fd, "waste_percent"),
                  notes: str(fd, "notes") || null,
                  is_active: p ? bool(fd, "is_active") : true,
                  ...(p
                    ? {}
                    : {
                        initial_price: canSeeCosts
                          ? str(fd, "initial_price")
                          : "",
                        initial_supplier_id: canSeeCosts
                          ? str(fd, "initial_supplier_id")
                          : "",
                      }),
                })),
            { onFieldErrors: setErrors, onSuccess: close },
          )
        }
      >
        {/* 1 — what is it? Everything below depends on this. */}
        <Field id="pr-cat" label={t("engine.whatProduct")}>
          <NativeSelect
            name="category"
            value={cat}
            onChange={(e) => setDialogCat(e.target.value as ProductCategory)}
          >
            {(["paint", "gypsum", "other"] as const).map((f) => (
              <optgroup
                key={f}
                label={t(
                  f === "paint"
                    ? "engine.familyPaint"
                    : f === "gypsum"
                      ? "engine.familyGypsum"
                      : "engine.familyOther",
                )}
              >
                {CATEGORIES_BY_FAMILY[f].map((c) => (
                  <option key={c} value={c}>
                    {t(`engine.cat_${c}`)}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
        </Field>

        <Field
          id="pr-name"
          label={t("engine.productName")}
          error={fieldText(errors.name)}
        >
          <Input
            name="name"
            defaultValue={p?.name}
            placeholder={t(`engine.namePh_${spec.kind}`)}
          />
        </Field>

        {/* Which calculation line this product feeds (brands doing the same job share it). */}
        <Field
          id="pr-group"
          label={t("engine.group")}
          hint={t("engine.groupHint")}
          error={errors.equivalence_group_id ? t("engine.groupRequired") : undefined}
        >
          <NativeSelect
            key={cat}
            name="equivalence_group_id"
            defaultValue={p?.group_id ?? groups.find((g) => g.role === DEFAULT_ROLE[cat])?.id ?? ""}
          >
            <option value="">{t("engine.ungrouped")}</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pr-brand" label={t("engine.brand")}>
            <NativeSelect
              key={fam}
              name="brand_id"
              defaultValue={p?.brand_id ?? ""}
            >
              <option value="">{t("engine.genericBrand")}</option>
              {brandOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            id="pr-newbrand"
            label={t("engine.newBrand")}
            optional={t("common.optional")}
          >
            <Input
              name="new_brand"
              placeholder={t(
                fam === "gypsum"
                  ? "engine.newBrandPhGypsum"
                  : "engine.newBrandPh",
              )}
            />
          </Field>
        </div>

        {/* 2 — only the numbers this kind of product needs */}
        <fieldset className="grid gap-4 rounded-2xl bg-surface-sunken/70 p-4">
          <legend className="sr-only">{t("engine.howCalculated")}</legend>
          <p className="text-[13px] text-muted-foreground">
            {t(`engine.kindHint_${spec.kind}`)}
          </p>
          {spec.kind === "coverage" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="pr-ref"
                  label={t("engine.packSizeIn", { unit })}
                  error={fieldText(errors.ref_pack_size)}
                >
                  <NumberInput
                    key={cat}
                    name="ref_pack_size"
                    defaultValue={p?.ref_pack_size ?? ""}
                    placeholder={spec.unit === "kg" ? "20" : "18"}
                    suffix={unit}
                  />
                </Field>
                <Field
                  id="pr-cov"
                  label={t("engine.coverage")}
                  hint={t("engine.coverageHint")}
                  error={fieldText(errors.coverage_per_pack)}
                >
                  <NumberInput
                    name="coverage_per_pack"
                    defaultValue={p?.coverage_per_pack ?? ""}
                    placeholder="120"
                    suffix="m²"
                  />
                </Field>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3">
                <span className="text-[14px]">
                  {t("engine.colourSpecific")}
                  <span className="block text-[12px] text-muted-foreground">
                    {t("engine.colourSpecificHint")}
                  </span>
                </span>
                <SwitchField
                  name="colour_specific"
                  defaultChecked={
                    p?.colour_specific ??
                    [
                      "finish_paint",
                      "ceiling_paint",
                      "moisture_paint",
                      "decorative",
                      "exterior_paint",
                      "spray_paint",
                      "profile_texture",
                    ].includes(cat)
                  }
                />
              </label>
            </>
          )}
          {spec.kind === "board" && (
            <Field
              id="pr-area"
              label={t("engine.boardArea")}
              hint={t("engine.boardAreaHint")}
              error={fieldText(errors.area_m2)}
            >
              <NumberInput
                name="area_m2"
                defaultValue={p?.area_m2 ?? 2.88}
                suffix="m²"
              />
            </Field>
          )}
          {spec.kind === "bar" && (
            <Field
              id="pr-len"
              label={t("engine.length")}
              error={fieldText(errors.length_m)}
            >
              <NumberInput
                name="length_m"
                defaultValue={p?.length_m ?? 3}
                suffix="m"
              />
            </Field>
          )}
          {spec.kind === "contents" && (
            <Field
              id="pr-cont"
              label={t(`engine.contents_${spec.contents}`)}
              error={fieldText(errors.contents_per_pack)}
            >
              <NumberInput
                name="contents_per_pack"
                defaultValue={p?.contents_per_pack ?? ""}
              />
            </Field>
          )}
        </fieldset>

        {!p && canSeeCosts && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="pr-iprice"
              label={t(`engine.priceOf_${spec.kind}`, { unit })}
              optional={t("common.optional")}
              error={fieldText(errors.initial_price)}
            >
              <NumberInput name="initial_price" suffix={t("engine.sar")} />
            </Field>
            <Field
              id="pr-isup"
              label={t("engine.supplier")}
              optional={t("common.optional")}
            >
              <NativeSelect name="initial_supplier_id" defaultValue="">
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        )}

        {/* 3 — rarely needed */}
        <details className="group rounded-2xl border border-border px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[14px] font-bold">
            {t("engine.moreOptions")}
            <ChevronDown className="size-4 transition group-open:rotate-180" />
          </summary>
          <div className="mt-4 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="pr-waste"
                label={t("engine.waste")}
                hint={t("engine.wasteDefault")}
                error={fieldText(errors.waste_percent)}
              >
                <NumberInput
                  name="waste_percent"
                  defaultValue={p?.waste_percent ?? ""}
                  suffix="%"
                />
              </Field>
              {spec.kind === "coverage" && (
                <Field
                  id="pr-sf"
                  label={t("engine.surfaceFactor")}
                  hint={t("engine.surfaceFactorHint")}
                  error={fieldText(errors.surface_factor)}
                >
                  <NumberInput
                    name="surface_factor"
                    defaultValue={p?.surface_factor ?? 1}
                  />
                </Field>
              )}
              {fam === "paint" && (
                <Field id="pr-app" label={t("engine.application")}>
                  <NativeSelect
                    name="application"
                    defaultValue={
                      p?.application ??
                      (cat.startsWith("exterior") ||
                      cat === "profile_texture" ||
                      cat === "spray_paint"
                        ? "exterior"
                        : "interior")
                    }
                  >
                    {(["interior", "exterior", "both"] as const).map((a) => (
                      <option key={a} value={a}>
                        {t(`engine.app_${a}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </div>
            <Field
              id="pr-notes"
              label={t("catalogue.notes")}
              optional={t("common.optional")}
            >
              <Textarea name="notes" defaultValue={p?.notes ?? ""} rows={2} />
            </Field>
            {p && (
              <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
                <span className="text-[14px]">{t("catalogue.active")}</span>
                <SwitchField name="is_active" defaultChecked={p.is_active} />
              </label>
            )}
          </div>
        </details>
      </FormDialog>
    );
  }

  function packDialog(p: ProductItem) {
    return (
      <FormDialog
        open
        onOpenChange={(v) => !v && setPackFor(null)}
        title={t("engine.addPack")}
        description={p.name}
        pending={pending}
        onSubmit={(fd) =>
          run(
            actions &&
              (() =>
                actions.addPack({
                  product_id: p.id,
                  size: str(fd, "size"),
                  label: str(fd, "label") || null,
                  unit_price: canSeeCosts ? str(fd, "unit_price") : "",
                  supplier_id: canSeeCosts ? str(fd, "supplier_id") : "",
                })),
            { onFieldErrors: setErrors, onSuccess: () => setPackFor(null) },
          )
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field
            id="pk-size"
            label={t("engine.packSize")}
            hint={t("engine.packSizeHint")}
            error={fieldText(errors.size)}
          >
            <NumberInput name="size" suffix={unitLabel(p.purchase_unit)} />
          </Field>
          <Field
            id="pk-label"
            label={t("engine.packLabel")}
            optional={t("common.optional")}
          >
            <Input name="label" placeholder={t("engine.packLabelPh")} />
          </Field>
          {canSeeCosts && (
            <>
              <Field
                id="pk-price"
                label={t("engine.packPrice")}
                optional={t("common.optional")}
                error={fieldText(errors.unit_price)}
              >
                <NumberInput name="unit_price" suffix={t("engine.sar")} />
              </Field>
              <Field
                id="pk-sup"
                label={t("engine.supplier")}
                optional={t("common.optional")}
              >
                <NativeSelect name="supplier_id" defaultValue="">
                  <option value="">—</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </>
          )}
        </div>
      </FormDialog>
    );
  }

  function priceDialog({
    product,
    pack,
  }: {
    product: ProductItem;
    pack: ProductPack;
  }) {
    return (
      <FormDialog
        open
        onOpenChange={(v) => !v && setPriceFor(null)}
        title={t("engine.newPrice")}
        description={`${product.name} · ${pack.label ?? qn(pack.size)}`}
        pending={pending}
        onSubmit={(fd) =>
          run(
            actions &&
              (() =>
                actions.addPrice({
                  product_id: product.id,
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
                <span>{x.supplier_name ?? t("engine.noSupplier")}</span>
                <span className="font-latin tabular-nums">
                  {fmt.money(x.unit_price)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field
            id="pp-price"
            label={t("engine.packPrice")}
            error={fieldText(errors.unit_price)}
          >
            <NumberInput name="unit_price" suffix={t("engine.sar")} autoFocus />
          </Field>
          <Field
            id="pp-sup"
            label={t("engine.supplier")}
            optional={t("common.optional")}
          >
            <NativeSelect name="supplier_id" defaultValue="">
              <option value="">—</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field
          id="pp-src"
          label={t("engine.priceSource")}
          optional={t("common.optional")}
        >
          <Input name="source" placeholder={t("engine.priceSourcePh")} />
        </Field>
      </FormDialog>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          name={t("engine.family")}
          value={family}
          onChange={setFamily}
          options={[
            {
              value: "paint",
              label: t("engine.familyPaint"),
              icon: <PaintBucket />,
            },
            {
              value: "gypsum",
              label: t("engine.familyGypsum"),
              icon: <Boxes />,
            },
            { value: "other", label: t("engine.familyOther"), icon: <Tag /> },
          ]}
        />
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4 text-subtle-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("engine.search")}
            className="ps-10"
            aria-label={t("engine.search")}
          />
        </div>
        {canManage && (
          <Button onClick={() => setEditing("new")}>
            <Plus /> {t("engine.newProduct")}
          </Button>
        )}
      </div>

      {sections.size === 0 && (
        <p className="py-10 text-center text-muted-foreground">
          {t("engine.noResults")}
        </p>
      )}

      {[...sections.entries()].map(([key, s]) => (
        <section
          key={key}
          className="overflow-hidden rounded-2xl border border-border bg-surface"
        >
          <header className="flex items-center justify-between gap-3 border-b border-border bg-surface-sunken/60 px-5 py-2.5">
            <h3 className="text-[14px] font-bold">{s.title}</h3>
            {s.items.length > 1 && (
              <Badge tone="primary">
                {t("engine.alternatives", { n: s.items.length })}
              </Badge>
            )}
          </header>
          <ul className="divide-y divide-border">
            {s.items.map((p) => {
              const m2 = canSeeCosts ? perM2(p) : null;
              return (
                <li
                  key={p.id}
                  className={cn(
                    "grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto]",
                    !p.is_active && "opacity-55",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[15px] font-bold">{p.name}</p>
                      <Badge>{p.brand ?? t("engine.genericBrand")}</Badge>
                      {!p.group_id && <Badge tone="danger">{t("engine.notLinked")}</Badge>}
                      {p.colour_specific && (
                        <Badge tone="info">{t("engine.perColour")}</Badge>
                      )}
                      {p.waste_percent != null && (
                        <Badge tone="warning">
                          {t("engine.wasteBadge", { n: qn(p.waste_percent) })}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {describe(p)}
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {p.packs.map((k) => (
                        <span
                          key={k.id}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface ps-3 pe-1 py-1 text-[13px]"
                        >
                          <span>
                            {k.label ??
                              `${qn(k.size)} ${unitLabel(p.purchase_unit)}`}
                          </span>
                          {canSeeCosts && (
                            <button
                              type="button"
                              disabled={!canManage}
                              onClick={() =>
                                setPriceFor({ product: p, pack: k })
                              }
                              className={cn(
                                "rounded-full px-2 py-0.5 font-latin tabular-nums",
                                k.best == null
                                  ? "bg-warning-soft text-[color-mix(in_oklch,var(--warning)_70%,var(--foreground))]"
                                  : "bg-primary-soft text-primary",
                                canManage &&
                                  "hover:ring-2 hover:ring-primary/30",
                              )}
                              aria-label={t("engine.newPrice")}
                            >
                              {k.best == null
                                ? t("engine.noPrice")
                                : fmt.money(k.best)}
                            </button>
                          )}
                          {canManage && p.packs.length > 1 && (
                            <button
                              type="button"
                              aria-label={t("engine.deletePack")}
                              className="rounded-full p-1 text-subtle-foreground hover:text-danger"
                              onClick={() =>
                                run(
                                  actions &&
                                    (() => actions.deletePack({ id: k.id })),
                                )
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </span>
                      ))}
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => setPackFor(p)}
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-[13px] text-muted-foreground hover:text-foreground"
                        >
                          <Plus className="size-3.5" /> {t("engine.addPack")}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-2 sm:flex-col sm:items-end">
                    {m2 != null && (
                      <div className="text-end">
                        <p className="font-latin text-[17px] font-bold tabular-nums">
                          {fmt.money(m2)}
                        </p>
                        <p className="text-[12px] text-muted-foreground">
                          {t("engine.perM2Coat")}
                        </p>
                      </div>
                    )}
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("engine.editProduct")}
                        onClick={() => setEditing(p)}
                        className="ms-auto"
                      >
                        <Pencil />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {editing && productDialog()}
      {packFor && packDialog(packFor)}
      {priceFor && priceDialog(priceFor)}
    </div>
  );
}
