"use client";
import { ArrowDown, ArrowUp, Calculator, ChevronRight, Pencil, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { DeleteButton, FormDialog, NumberInput, bool, str, useActionRunner, useUnitText } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import type { ActionResult } from "@/lib/actions";
import { materialCostPerUnit, recipeQtyPerUnit, suggestedDurationDays } from "@/lib/costing";
import { cn } from "@/lib/utils";
import { ServiceDialog, SwitchField, type ServiceInput, type ServiceSummary } from "./services-view";

export type Stage = {
  id: string;
  kind: "prep" | "work" | "handover";
  name_ar: string;
  productivity_per_day: number | null;
  fixed_days: number;
  notes: string | null;
};
export type Spec = { id: string; title: string; body: string; is_default: boolean };
export type RecipeLine = {
  id: string;
  material_id: string;
  material_name: string;
  material_unit: string;
  material_brand: string | null;
  coverage_per_unit: number | null;
  calc_mode: "fixed" | "coverage";
  coats: number;
  qty_per_unit: number | null;
  waste_percent: number | null;
  unit_price: number | null; // null = no price or hidden
};
export type MaterialOption = { id: string; name_ar: string; unit: string; brand: string | null; coverage_per_unit: number | null };

export type ServiceDetailActions = {
  saveService: (i: ServiceInput) => Promise<ActionResult<{ code: string }>>;
  saveStage: (i: Record<string, unknown>) => Promise<ActionResult>;
  moveStage: (i: { id: string; direction: "up" | "down" }) => Promise<ActionResult>;
  deleteStage: (i: { id: string }) => Promise<ActionResult>;
  saveSpec: (i: Record<string, unknown>) => Promise<ActionResult>;
  deleteSpec: (i: { id: string }) => Promise<ActionResult>;
  saveRecipeLine: (i: Record<string, unknown>) => Promise<ActionResult>;
  deleteRecipeLine: (i: { id: string }) => Promise<ActionResult>;
};

export function ServiceDetailView({
  service,
  stages,
  specs,
  recipe,
  materials,
  defaultWastePercent,
  canManage,
  canSeeCosts,
  actions,
  basePath = "",
}: {
  service: ServiceSummary;
  stages: Stage[];
  specs: Spec[];
  recipe: RecipeLine[];
  materials: MaterialOption[];
  defaultWastePercent: number;
  canManage: boolean;
  canSeeCosts: boolean;
  actions?: ServiceDetailActions;
  basePath?: string;
}) {
  const t = useTranslations();
  const { fmt } = useFormatter();
  const { run, pending, fieldText } = useActionRunner();
  const [editService, setEditService] = React.useState(false);
  const [stageDialog, setStageDialog] = React.useState<Stage | "new" | null>(null);
  const [specDialog, setSpecDialog] = React.useState<Spec | "new" | null>(null);
  const [recipeDialog, setRecipeDialog] = React.useState<RecipeLine | "new" | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pickedMaterial, setPickedMaterial] = React.useState<string>("");

  const waste = service.waste_percent ?? defaultWastePercent;
  const qtyOf = (r: RecipeLine) => recipeQtyPerUnit(r);
  const cost = materialCostPerUnit(
    recipe.map((r) => ({ qty_per_unit: qtyOf(r), waste_percent: r.waste_percent ?? waste, unit_price: r.unit_price })),
    waste,
  );

  const kindTone = { prep: "info", work: "primary", handover: "success" } as const;
  const kindLabel = { prep: t("catalogue.kindPrep"), work: t("catalogue.kindWork"), handover: t("catalogue.kindHandover") };

  return (
    <div className="grid gap-6">
      {/* Header */}
      <div>
        <Link href={`${basePath}/catalogue`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronRight className="size-4 ltr:rotate-180" /> {t("catalogue.tabServices")}
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[28px] leading-tight font-extrabold sm:text-[36px]">{service.name_ar}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {service.name_en && <span className="font-latin">{service.name_en}</span>}
              <Badge>{t(`units.${service.unit}`)}</Badge>
              <Badge>{t("catalogue.waste")} <span className="num">{fmt.number(waste, 1)}%</span></Badge>
              {!service.is_active && <Badge tone="warning">{t("catalogue.inactive")}</Badge>}
            </div>
          </div>
          {canManage && (
            <Button variant="secondary" onClick={() => setEditService(true)}>
              <Pencil /> {t("catalogue.editService")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-6">
          {/* Stages */}
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{t("catalogue.stages")}</CardTitle>
                <CardDescription>{t("catalogue.stagesHint")}</CardDescription>
              </div>
              {canManage && (
                <Button size="sm" variant="soft" onClick={() => setStageDialog("new")}>
                  <Plus /> {t("catalogue.addStage")}
                </Button>
              )}
            </CardHeader>
            <CardContent className="px-0 sm:px-0">
              <ol className="divide-y divide-border">
                {stages.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                    <span className="num flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[13px] font-bold">
                      {fmt.number(i + 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-[15px] font-bold">
                        {s.name_ar}
                        <Badge tone={kindTone[s.kind]}>{kindLabel[s.kind]}</Badge>
                      </p>
                      <p className="num text-[13px] text-muted-foreground">
                        {s.productivity_per_day ? `${fmt.number(s.productivity_per_day, 0)} ${t("catalogue.perDay")}` : t("catalogue.noProductivity")}
                        {s.fixed_days > 0 && ` · +${fmt.number(s.fixed_days, 1)} ${t("catalogue.days")}`}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 items-center">
                        <Button variant="ghost" size="icon-sm" aria-label={t("catalogue.moveUp")} disabled={i === 0 || pending} onClick={() => run(actions && (() => actions.moveStage({ id: s.id, direction: "up" })), { silent: true })}>
                          <ArrowUp />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={t("catalogue.moveDown")} disabled={i === stages.length - 1 || pending} onClick={() => run(actions && (() => actions.moveStage({ id: s.id, direction: "down" })), { silent: true })}>
                          <ArrowDown />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={t("catalogue.editStage")} onClick={() => setStageDialog(s)}>
                          <Pencil />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {/* Recipe */}
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{t("catalogue.recipe")}</CardTitle>
                <CardDescription>{t("catalogue.recipeHint")}</CardDescription>
              </div>
              {canManage && materials.length > 0 && (
                <Button size="sm" variant="soft" onClick={() => setRecipeDialog("new")}>
                  <Plus /> {t("catalogue.addRecipeLine")}
                </Button>
              )}
            </CardHeader>
            <CardContent className="px-0 sm:px-0">
              {materials.length === 0 && recipe.length === 0 ? (
                <p className="px-6 pb-2 text-sm text-muted-foreground">
                  {t("catalogue.noMaterialsYet")} ·{" "}
                  <Link href={`${basePath}/catalogue/materials`} className="font-bold text-primary">
                    {t("catalogue.tabMaterials")}
                  </Link>
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {recipe.map((r) => {
                    const w = r.waste_percent ?? waste;
                    const q = qtyOf(r);
                    const lineCost = r.unit_price != null && q != null ? q * (1 + w / 100) * r.unit_price : null;
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() => setRecipeDialog(r)}
                          className="flex w-full items-center gap-3 px-5 py-3 text-start transition-colors enabled:hover:bg-surface-2/60 sm:px-6"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[15px] font-bold">
                              {r.material_name}
                              {r.material_brand && <span className="font-normal text-muted-foreground"> · {r.material_brand}</span>}
                            </p>
                            {r.calc_mode === "coverage" && (
                              <p className="num text-[13px] text-muted-foreground">
                                {t("catalogue.coatsCount", { n: fmt.number(r.coats, r.coats % 1 ? 1 : 0) })} ÷{" "}
                                {r.coverage_per_unit
                                  ? t("catalogue.coversPer", { area: fmt.number(r.coverage_per_unit, 2), unit: t(`units.${r.material_unit}`) })
                                  : t("catalogue.noCoverage")}
                              </p>
                            )}
                            <p className="num text-[13px] text-muted-foreground">
                              {q != null ? `${fmt.number(q, 4)} ${t(`units.${r.material_unit}`)} / ${t(`units.${service.unit}`)}` : "—"} · {t("catalogue.waste")} {fmt.number(w, 1)}%
                            </p>
                          </div>
                          {canSeeCosts && (
                            <span className={cn("num shrink-0 text-[15px] font-bold", lineCost == null && "text-warning")}>
                              {lineCost == null ? t("catalogue.noPrice") : fmt.money(lineCost)}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {canSeeCosts && recipe.length > 0 && (
                <div className="mx-5 mt-2 flex flex-col gap-2 rounded-xl bg-primary-softer px-4 py-3 sm:mx-6">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[14px] font-bold">{t("catalogue.materialCostPerUnit")}</span>
                    <span className="num text-[20px] font-extrabold text-primary">{fmt.money(cost.total)}</span>
                  </div>
                  {cost.missingPrices > 0 && (
                    <p className="flex items-center gap-1.5 text-[13px] text-warning">
                      <TriangleAlert className="size-3.5" /> {t("catalogue.missingPrices", { n: fmt.number(cost.missingPrices) })}
                    </p>
                  )}
                </div>
              )}
              {!canSeeCosts && recipe.length > 0 && <p className="px-6 pt-2 text-[13px] text-subtle-foreground">{t("catalogue.costHidden")}</p>}
            </CardContent>
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-6">
          <DurationCalculator stages={stages} />

          {/* Specs */}
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{t("catalogue.specs")}</CardTitle>
                <CardDescription>{t("catalogue.specsHint")}</CardDescription>
              </div>
              {canManage && (
                <Button size="sm" variant="soft" onClick={() => setSpecDialog("new")}>
                  <Plus /> {t("catalogue.addSpec")}
                </Button>
              )}
            </CardHeader>
            <CardContent className="grid gap-3">
              {specs.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={!canManage}
                  onClick={() => setSpecDialog(s)}
                  className="rounded-xl border border-border bg-surface-2/60 p-4 text-start transition-colors enabled:hover:border-primary/40"
                >
                  <p className="flex items-center gap-2 text-[15px] font-bold">
                    {s.title} {s.is_default && <Badge tone="primary">{t("catalogue.default")}</Badge>}
                  </p>
                  <p className="mt-1.5 text-[14px] leading-relaxed whitespace-pre-line text-muted-foreground">{s.body}</p>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <ServiceDialog open={editService} onOpenChange={setEditService} service={service} onSave={actions?.saveService} basePath={basePath} />

      {/* Stage dialog */}
      {stageDialog && (
        <FormDialog
          open
          onOpenChange={(v) => !v && setStageDialog(null)}
          title={stageDialog === "new" ? t("catalogue.addStage") : t("catalogue.editStage")}
          pending={pending}
          footerExtra={
            stageDialog !== "new" && (
              <DeleteButton pending={pending} onConfirm={() => run(actions && (() => actions.deleteStage({ id: stageDialog.id })), { onSuccess: () => setStageDialog(null) })} />
            )
          }
          onSubmit={(fd) =>
            run(
              actions &&
                (() =>
                  actions.saveStage({
                    ...(stageDialog !== "new" ? { id: stageDialog.id } : {}),
                    service_id: service.id,
                    kind: str(fd, "kind"),
                    name_ar: str(fd, "name_ar"),
                    productivity_per_day: str(fd, "productivity_per_day"),
                    fixed_days: str(fd, "fixed_days") || "0",
                    notes: str(fd, "notes") || null,
                  })),
              { onFieldErrors: setErrors, onSuccess: () => setStageDialog(null) },
            )
          }
        >
          {(() => {
            const s = stageDialog === "new" ? undefined : stageDialog;
            return (
              <>
                <Field id="st-name" label={t("catalogue.name")} error={fieldText(errors.name_ar)}>
                  <Input name="name_ar" defaultValue={s?.name_ar} />
                </Field>
                <Field id="st-kind" label={t("catalogue.kind")}>
                  <NativeSelect name="kind" defaultValue={s?.kind ?? "work"}>
                    <option value="prep">{t("catalogue.kindPrep")}</option>
                    <option value="work">{t("catalogue.kindWork")}</option>
                    <option value="handover">{t("catalogue.kindHandover")}</option>
                  </NativeSelect>
                </Field>
                <Field id="st-prod" label={t("catalogue.productivity")} hint={t("catalogue.productivityHint")} error={fieldText(errors.productivity_per_day)}>
                  <NumberInput name="productivity_per_day" defaultValue={s?.productivity_per_day ?? ""} suffix={t("catalogue.perDay")} />
                </Field>
                <Field id="st-fixed" label={t("catalogue.fixedDays")} hint={t("catalogue.fixedDaysHint")} error={fieldText(errors.fixed_days)}>
                  <NumberInput name="fixed_days" defaultValue={s?.fixed_days ?? 0} suffix={t("catalogue.days")} />
                </Field>
                <Field id="st-notes" label={t("catalogue.notes")} optional={t("common.optional")}>
                  <Textarea name="notes" defaultValue={s?.notes ?? ""} rows={2} />
                </Field>
              </>
            );
          })()}
        </FormDialog>
      )}

      {/* Spec dialog */}
      {specDialog && (
        <FormDialog
          open
          wide
          onOpenChange={(v) => !v && setSpecDialog(null)}
          title={specDialog === "new" ? t("catalogue.addSpec") : t("catalogue.editSpec")}
          pending={pending}
          footerExtra={
            specDialog !== "new" && (
              <DeleteButton pending={pending} onConfirm={() => run(actions && (() => actions.deleteSpec({ id: specDialog.id })), { onSuccess: () => setSpecDialog(null) })} />
            )
          }
          onSubmit={(fd) =>
            run(
              actions &&
                (() =>
                  actions.saveSpec({
                    ...(specDialog !== "new" ? { id: specDialog.id } : {}),
                    service_id: service.id,
                    title: str(fd, "title"),
                    body: str(fd, "body"),
                    is_default: bool(fd, "is_default"),
                  })),
              { onFieldErrors: setErrors, onSuccess: () => setSpecDialog(null) },
            )
          }
        >
          {(() => {
            const s = specDialog === "new" ? undefined : specDialog;
            return (
              <>
                <Field id="sp-title" label={t("catalogue.specTitle")} error={fieldText(errors.title)}>
                  <Input name="title" defaultValue={s?.title} />
                </Field>
                <Field id="sp-body" label={t("catalogue.specBody")} error={fieldText(errors.body)}>
                  <Textarea name="body" defaultValue={s?.body} rows={6} />
                </Field>
                <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
                  <span className="text-[14px]">{t("catalogue.isDefault")}</span>
                  <SwitchField name="is_default" defaultChecked={s?.is_default ?? specs.length === 0} />
                </label>
              </>
            );
          })()}
        </FormDialog>
      )}

      {/* Recipe dialog */}
      {recipeDialog && (
        <FormDialog
          open
          onOpenChange={(v) => !v && setRecipeDialog(null)}
          title={recipeDialog === "new" ? t("catalogue.addRecipeLine") : t("catalogue.editRecipeLine")}
          pending={pending}
          footerExtra={
            recipeDialog !== "new" && (
              <DeleteButton pending={pending} onConfirm={() => run(actions && (() => actions.deleteRecipeLine({ id: recipeDialog.id })), { onSuccess: () => setRecipeDialog(null) })} />
            )
          }
          onSubmit={(fd) =>
            run(
              actions &&
                (() =>
                  actions.saveRecipeLine({
                    ...(recipeDialog !== "new" ? { id: recipeDialog.id } : {}),
                    service_id: service.id,
                    material_id: recipeDialog !== "new" ? recipeDialog.material_id : str(fd, "material_id"),
                    calc_mode: str(fd, "calc_mode") || "fixed",
                    coats: str(fd, "coats") || "1",
                    qty_per_unit: str(fd, "qty_per_unit"),
                    waste_percent: str(fd, "waste_percent"),
                    notes: null,
                  })),
              { onFieldErrors: setErrors, onSuccess: () => setRecipeDialog(null) },
            )
          }
        >
          {(() => {
            const r = recipeDialog === "new" ? undefined : recipeDialog;
            const used = new Set(recipe.map((x) => x.material_id));
            return (
              <>
                <Field id="rc-mat" label={t("catalogue.material")} error={fieldText(errors.material_id)}>
                  {r ? (
                    <Input value={r.material_name} disabled readOnly />
                  ) : (
                    <NativeSelect name="material_id" defaultValue="" onChange={(e) => setPickedMaterial(e.target.value)}>
                      <option value="" disabled>
                        —
                      </option>
                      {materials
                        .filter((m) => !used.has(m.id))
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name_ar}
                            {m.brand ? ` — ${m.brand}` : ""} ({t(`units.${m.unit}`)})
                          </option>
                        ))}
                    </NativeSelect>
                  )}
                </Field>
                <RecipeQtyFields
                  key={r?.id ?? pickedMaterial}
                  line={r}
                  material={materials.find((m) => m.id === (r?.material_id ?? pickedMaterial))}
                  unitLabel={(u) => t(`units.${u}`)}
                  errors={errors}
                  fieldText={fieldText}
                />
                <Field id="rc-waste" label={t("catalogue.wastePercent")} hint={t("catalogue.wasteHint")} optional={t("common.optional")} error={fieldText(errors.waste_percent)}>
                  <NumberInput name="waste_percent" defaultValue={r?.waste_percent ?? ""} suffix="%" />
                </Field>
              </>
            );
          })()}
        </FormDialog>
      )}
    </div>
  );
}

function DurationCalculator({ stages }: { stages: Stage[] }) {
  const t = useTranslations("catalogue");
  const { fmt } = useFormatter();
  const [area, setArea] = React.useState("100");
  const [teams, setTeams] = React.useState("1");
  const a = Number(area.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))) || 0;
  const n = Math.max(1, Math.floor(Number(teams) || 1));
  const days = suggestedDurationDays(a, stages, n);
  const hasProductivity = stages.some((s) => s.productivity_per_day);

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="size-4 text-primary" /> {t("duration")}
        </CardTitle>
        <CardDescription>{t("durationHint")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="field-row grid gap-3 sm:grid-cols-2">
          <Field id="dc-area" label={t("area")}>
            <NumberInput value={area} onChange={(e) => setArea(e.target.value)} />
          </Field>
          <Field id="dc-teams" label={t("teams")}>
            <NumberInput value={teams} onChange={(e) => setTeams(e.target.value)} inputMode="numeric" />
          </Field>
        </div>
        <div className="flex items-baseline justify-between rounded-xl bg-ink px-4 py-3 text-ink-foreground">
          <span className="text-[14px]">{t("estimatedDays")}</span>
          {hasProductivity ? (
            <span className="num text-[24px] font-extrabold text-gypsum">
              {fmt.number(days, days % 1 ? 1 : 0)} <span className="text-[13px] font-normal text-ink-muted">{t("workingDays")}</span>
            </span>
          ) : (
            <span className="text-[13px] text-ink-muted">{t("missingProductivity")}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RecipeQtyFields({
  line,
  material,
  unitLabel,
  errors,
  fieldText,
}: {
  line?: RecipeLine;
  material?: MaterialOption;
  unitLabel: (u: string) => string;
  errors: Record<string, string>;
  fieldText: (k?: string) => string | undefined;
}) {
  const t = useTranslations("catalogue");
  const unitText = useUnitText();
  const { fmt } = useFormatter();
  const coverage = line?.coverage_per_unit ?? material?.coverage_per_unit ?? null;
  const [mode, setMode] = React.useState<"coverage" | "fixed">(line?.calc_mode ?? (coverage ? "coverage" : "fixed"));
  const [coats, setCoats] = React.useState(String(line?.coats ?? 1));
  const unit = unitLabel(line?.material_unit ?? material?.unit ?? "piece");
  const c = Number(coats) || 0;

  return (
    <>
      <input type="hidden" name="calc_mode" value={mode} />
      <div className="grid gap-2">
        <span className="text-[13px] font-medium">{t("calcMode")}</span>
        <Segmented
          name={t("calcMode")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "coverage", label: t("modeCoverage") },
            { value: "fixed", label: t("modeFixed") },
          ]}
          className="w-full"
        />
      </div>
      {mode === "coverage" ? (
        <>
          <Field id="rc-coats" label={t("coats")} hint={t("coatsHint")} error={fieldText(errors.coats)}>
            <NumberInput name="coats" value={coats} onChange={(e) => setCoats(e.target.value)} />
          </Field>
          <div className="rounded-xl bg-surface-2 px-4 py-3 text-[14px]">
            {coverage ? (
              <p className="num">
                {t("coversPer", { area: fmt.number(coverage, 2), unit })} → <b>{fmt.number(c / coverage, 4)} {unit}</b> / {unitText("m2")}
              </p>
            ) : (
              <p className="text-warning">{t("noCoverageHint")}</p>
            )}
          </div>
        </>
      ) : (
        <Field id="rc-qty" label={t("qtyPerUnit")} error={fieldText(errors.qty_per_unit)}>
          <NumberInput name="qty_per_unit" defaultValue={line?.qty_per_unit ?? ""} suffix={unit} />
        </Field>
      )}
    </>
  );
}
