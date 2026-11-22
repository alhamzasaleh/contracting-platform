"use client";
import { History, Package, Pencil, Plus, Search, TrendingDown, TrendingUp } from "lucide-react";
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
import type { ActionResult } from "@/lib/actions";
import { MATERIAL_UNITS, type MaterialUnit } from "@/lib/supabase/database.types";
import { SwitchField } from "./services-view";

export type MaterialItem = {
  id: string;
  name_ar: string;
  name_en: string | null;
  category: string | null;
  unit: MaterialUnit;
  scope: "general" | "project";
  sku: string | null;
  is_active: boolean;
  price: number | null;
  priceSince: string | null;
  history: { unit_price: number; effective_from: string; source: string | null }[];
};

export type MaterialsActions = {
  saveMaterial: (i: Record<string, unknown>) => Promise<ActionResult>;
  addPrice: (i: Record<string, unknown>) => Promise<ActionResult>;
};

export function MaterialsView({
  materials,
  canManage,
  canSeeCosts,
  actions,
}: {
  materials: MaterialItem[];
  canManage: boolean;
  canSeeCosts: boolean;
  actions?: MaterialsActions;
}) {
  const t = useTranslations();
  const { fmt } = useFormatter();
  const { run, pending, fieldText } = useActionRunner();
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<MaterialItem | "new" | null>(null);
  const [pricing, setPricing] = React.useState<MaterialItem | null>(null);
  const [history, setHistory] = React.useState<MaterialItem | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const q = query.trim().toLowerCase();
  const filtered = q
    ? materials.filter((m) => [m.name_ar, m.name_en, m.category, m.sku].some((v) => v?.toLowerCase().includes(q)))
    : materials;
  const categories = [...new Set(materials.map((m) => m.category).filter(Boolean))] as string[];

  if (materials.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Package />}
          title={t("catalogue.emptyMaterialsTitle")}
          description={t("catalogue.emptyMaterialsBody")}
          action={
            canManage && (
              <Button onClick={() => setEditing("new")}>
                <Plus /> {t("catalogue.newMaterial")}
              </Button>
            )
          }
        />
        {editing && materialDialog()}
      </>
    );
  }

  function materialDialog() {
    const m = editing === "new" ? undefined : editing!;
    return (
      <FormDialog
        open
        onOpenChange={(v) => !v && setEditing(null)}
        title={m ? t("catalogue.editMaterial") : t("catalogue.newMaterial")}
        pending={pending}
        onSubmit={(fd) =>
          run(
            actions &&
              (() =>
                actions.saveMaterial({
                  ...(m ? { id: m.id } : {}),
                  name_ar: str(fd, "name_ar"),
                  name_en: str(fd, "name_en") || null,
                  category: str(fd, "category") || null,
                  unit: str(fd, "unit"),
                  scope: str(fd, "scope"),
                  sku: str(fd, "sku") || null,
                  is_active: m ? bool(fd, "is_active") : true,
                  ...(m ? {} : { initial_price: str(fd, "initial_price") }),
                })),
            { onFieldErrors: setErrors, onSuccess: () => setEditing(null) },
          )
        }
      >
        <Field id="mt-name" label={t("catalogue.nameAr")} error={fieldText(errors.name_ar)}>
          <Input name="name_ar" defaultValue={m?.name_ar} />
        </Field>
        <Field id="mt-name-en" label={t("catalogue.nameEn")} optional={t("common.optional")}>
          <Input name="name_en" defaultValue={m?.name_en ?? ""} dir="ltr" className="font-latin rtl:text-right" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field id="mt-unit" label={t("catalogue.unit")}>
            <NativeSelect name="unit" defaultValue={m?.unit ?? "piece"}>
              {MATERIAL_UNITS.map((u) => (
                <option key={u} value={u}>
                  {t(`units.${u}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="mt-cat" label={t("catalogue.category")} optional={t("common.optional")}>
            <Input name="category" defaultValue={m?.category ?? ""} list="material-categories" />
          </Field>
        </div>
        <datalist id="material-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Field id="mt-scope" label={t("catalogue.scope")}>
          <NativeSelect name="scope" defaultValue={m?.scope ?? "general"}>
            <option value="general">{t("catalogue.scopeGeneral")}</option>
            <option value="project">{t("catalogue.scopeProject")}</option>
          </NativeSelect>
        </Field>
        <Field id="mt-sku" label={t("catalogue.sku")} optional={t("common.optional")}>
          <Input name="sku" defaultValue={m?.sku ?? ""} dir="ltr" className="font-latin rtl:text-right" />
        </Field>
        {!m && canSeeCosts && (
          <Field id="mt-price" label={t("catalogue.initialPrice")} error={fieldText(errors.initial_price)}>
            <NumberInput name="initial_price" suffix={t("dashboard.sar")} />
          </Field>
        )}
        {m && (
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
            <span className="text-[14px]">{t("catalogue.active")}</span>
            <SwitchField name="is_active" defaultChecked={m.is_active} />
          </label>
        )}
      </FormDialog>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("catalogue.searchMaterials")} className="ps-11" />
        </div>
        {canManage && (
          <Button onClick={() => setEditing("new")}>
            <Plus /> {t("catalogue.newMaterial")}
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <ul className="divide-y divide-border">
          {filtered.map((m) => {
            const prev = m.history[1]?.unit_price;
            const trend = m.price != null && prev != null ? Math.sign(m.price - prev) : 0;
            return (
              <li key={m.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 ${m.is_active ? "" : "opacity-55"}`}>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="truncate text-[15px] font-bold">{m.name_ar}</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
                    <span>{t(`units.${m.unit}`)}</span>
                    {m.category && <>· <span>{m.category}</span></>}
                    {m.scope === "project" && <Badge tone="info">{t("catalogue.scopeProject").split(" (")[0]}</Badge>}
                  </p>
                </div>
                {canSeeCosts && (
                  <div className="text-end">
                    {m.price != null ? (
                      <>
                        <p className="num flex items-center justify-end gap-1.5 text-[16px] font-extrabold">
                          {trend > 0 && <TrendingUp className="size-4 text-danger" />}
                          {trend < 0 && <TrendingDown className="size-4 text-success" />}
                          {fmt.money(m.price)}
                        </p>
                        {m.priceSince && <p className="num text-xs text-subtle-foreground">{t("catalogue.since", { date: fmt.date(m.priceSince) })}</p>}
                      </>
                    ) : (
                      <Badge tone="warning">{t("catalogue.noPrice")}</Badge>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  {canManage && canSeeCosts && (
                    <Button size="sm" variant="soft" onClick={() => setPricing(m)}>
                      {t("catalogue.updatePrice")}
                    </Button>
                  )}
                  {canSeeCosts && m.history.length > 0 && (
                    <Button variant="ghost" size="icon-sm" aria-label={t("catalogue.priceHistory")} onClick={() => setHistory(m)}>
                      <History />
                    </Button>
                  )}
                  {canManage && (
                    <Button variant="ghost" size="icon-sm" aria-label={t("catalogue.editMaterial")} onClick={() => setEditing(m)}>
                      <Pencil />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {editing && materialDialog()}

      {pricing && (
        <FormDialog
          open
          onOpenChange={(v) => !v && setPricing(null)}
          title={`${t("catalogue.updatePrice")} — ${pricing.name_ar}`}
          description={t("catalogue.priceHint")}
          pending={pending}
          onSubmit={(fd) =>
            run(
              actions &&
                (() =>
                  actions.addPrice({
                    material_id: pricing.id,
                    unit_price: str(fd, "unit_price"),
                    effective_from: str(fd, "effective_from"),
                    source: str(fd, "source") || null,
                  })),
              { onFieldErrors: setErrors, onSuccess: () => setPricing(null) },
            )
          }
        >
          <Field id="pr-price" label={`${t("catalogue.unitPrice")} (${t(`units.${pricing.unit}`)})`} error={fieldText(errors.unit_price)}>
            <NumberInput name="unit_price" defaultValue={pricing.price ?? ""} suffix={t("dashboard.sar")} autoFocus />
          </Field>
          <Field id="pr-date" label={t("catalogue.effectiveFrom")} error={fieldText(errors.effective_from)}>
            <Input name="effective_from" type="date" defaultValue={new Date().toISOString().slice(0, 10)} dir="ltr" />
          </Field>
          <Field id="pr-source" label={t("catalogue.source")} optional={t("common.optional")}>
            <Input name="source" />
          </Field>
        </FormDialog>
      )}

      {history && (
        <FormDialog
          open
          onOpenChange={(v) => !v && setHistory(null)}
          title={`${t("catalogue.priceHistory")} — ${history.name_ar}`}
          onSubmit={() => setHistory(null)}
          submitLabel={t("common.close")}
        >
          <ol className="divide-y divide-border rounded-xl border border-border">
            {history.history.map((h, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="num text-[14px]">{fmt.date(h.effective_from)}</p>
                  {h.source && <p className="text-xs text-muted-foreground">{h.source}</p>}
                </div>
                <span className="num text-[15px] font-bold">{fmt.money(h.unit_price)}</span>
              </li>
            ))}
          </ol>
        </FormDialog>
      )}
    </div>
  );
}
