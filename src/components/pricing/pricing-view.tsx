"use client";
import { commissionOnNet } from "@/lib/marketers";
import {
  AlertTriangle,
  Hammer,
  History,
  Lock,
  PaintBucket,
  PaintRoller,
  RotateCcw,
  Save,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { NumberInput, useActionRunner, useListSep } from "@/components/forms/form-kit";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import type { ActionResult } from "@/lib/actions";
import type { PastStats } from "@/lib/pricing/history";
import { workItemLabel } from "@/components/quotes/quote-document";
import {
  defaultSelection,
  EMPTY_QUANTITIES,
  PRESETS,
  priceSelection,
  MAX_MARGIN_AND_REWARD,
  STEPS,
  stepBrands,
  stepIncluded,
  stepLines,
  type Labour,
  type Options,
  type PricingContext,
  type PricingOutcome,
  type Quantities,
  type Selection,
  type ServiceKind,
  type StepChoice,
  type StepDef,
} from "@/lib/pricing";
import { toNumber } from "@/lib/validation/numbers";
import { cn } from "@/lib/utils";
import { Kpi, LinesTable } from "./results";

/** Small pill buttons for a set of standard choices. */
function Chips<T extends string | number>({
  value,
  options,
  onChange,
  label,
  render,
  modified,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  label: string;
  render?: (v: T) => React.ReactNode;
  modified?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-1.5"
    >
      {options.map((o) => {
        const on = o === value;
        return (
          <button
            key={String(o)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o)}
            className={cn(
              "min-h-9 min-w-11 rounded-full border px-3 text-[13px] font-medium transition",
              on
                ? modified
                  ? "border-warning bg-warning-soft text-foreground"
                  : "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface text-muted-foreground hover:text-foreground",
            )}
          >
            {render ? render(o) : String(o)}
          </button>
        );
      })}
    </div>
  );
}

const SAMPLE_Q: Record<ServiceKind, Partial<Quantities>> = {
  gypsum: { ceilNormal: 345, ceilMoisture: 30, ceilFire: 25, partitions: 40 },
  interior: { walls: 600, ceilings: 250, wet: 40, decorative: 30, colours: 2 },
  exterior: { facade: 300 },
};

/**
 * The pricing screen (owner-agreed): every step is chosen here — product,
 * brand and coats — starting from the service template. Changes from the
 * template are highlighted; anything chosen that can't be priced is shown
 * with its reason.
 */
export function PricingView({
  ctx,
  templates,
  canManage,
  canSeeCrewCost,
  onSaveTemplate,
  quote,
}: {
  /** Quote mode: one service, quantities from the survey, and the quote's own actions. */
  quote?: {
    kind: ServiceKind;
    quantities: Quantities;
    initial?: Selection | null;
    quantitiesPanel: React.ReactNode;
    renderActions: (sel: Selection, outcome: PricingOutcome) => React.ReactNode;
    /** suggestions from the company's past quotes for this service */
    history?: PastStats | null;
    /** the success partner's reward on this quote — the price carries it (internal only) */
    commission?: { name: string; percent: number; discountPercent: number } | null;
  };
  ctx: PricingContext;
  templates: Partial<Record<ServiceKind, Partial<Selection>>>;
  canManage: boolean;
  canSeeCrewCost: boolean;
  onSaveTemplate?: (i: Selection) => Promise<ActionResult>;
}) {
  const t = useTranslations("pricing");
  const te = useTranslations("engine");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const c = ctx.catalogue;

  const [kind, setKind] = React.useState<ServiceKind>(
    quote?.kind ?? "exterior",
  );
  const base = React.useMemo(
    () =>
      Object.fromEntries(
        (["gypsum", "interior", "exterior"] as const).map((k) => [
          k,
          defaultSelection(k, c, templates[k]),
        ]),
      ) as Record<ServiceKind, Selection>,
    [c, templates],
  );
  const [sels, setSels] = React.useState<Record<ServiceKind, Selection>>(() =>
    quote?.initial ? { ...base, [quote.kind]: quote.initial } : base,
  );
  const [qs, setQs] = React.useState<Record<ServiceKind, Quantities>>(() => {
    const sample = {
      gypsum: { ...EMPTY_QUANTITIES, ...SAMPLE_Q.gypsum },
      interior: { ...EMPTY_QUANTITIES, ...SAMPLE_Q.interior },
      exterior: { ...EMPTY_QUANTITIES, ...SAMPLE_Q.exterior },
    };
    return quote ? { ...sample, [quote.kind]: quote.quantities } : sample;
  });
  const sel = sels[kind];
  const tpl = base[kind];
  // re-mounts the margin input when a suggestion is applied
  const [marginKey, setMarginKey] = React.useState(0);
  const q = qs[kind];

  const setSel = (f: (s: Selection) => Selection) =>
    setSels((all) => ({ ...all, [kind]: f(all[kind]) }));
  const setStep = (key: string, patch: Partial<StepChoice>) =>
    setSel((s) => ({
      ...s,
      steps: { ...s.steps, [key]: { ...s.steps[key], ...patch } },
    }));
  const setOpt = <K extends keyof Options>(k: K, v: Options[K]) =>
    setSel((s) => ({ ...s, options: { ...s.options, [k]: v } }));
  const setQ =
    (k: keyof Quantities) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const n = toNumber(
        e.target.value.replace(/[٠-٩]/g, (d) =>
          String("٠١٢٣٤٥٦٧٨٩".indexOf(d)),
        ),
      );
      setQs((all) => ({
        ...all,
        [kind]: { ...all[kind], [k]: typeof n === "number" && n >= 0 ? n : 0 },
      }));
    };

  const outcome = React.useMemo(
    () => priceSelection(sel, q, ctx, { commissionPercent: quote?.commission?.percent ?? 0 }),
    [sel, q, ctx, quote?.commission?.percent],
  );
  const { price } = outcome;

  const brandName = (b: string | null) => b ?? te("genericBrand");
  const visibleSteps = STEPS[kind].filter(
    (s) => !s.when || s.when(sel.options),
  );
  const changed = (a: unknown, b: unknown) =>
    JSON.stringify(a) !== JSON.stringify(b);

  const qty = (k: keyof Quantities, label: string, suffix?: string) => (
    <Field id={`q-${k}`} label={label}>
      <NumberInput
        id={`q-${k}`}
        defaultValue={(q[k] as number) || ""}
        key={`${kind}-${k}`}
        onChange={setQ(k)}
        suffix={suffix}
      />
    </Field>
  );

  function stepCard(s: StepDef) {
    const choice = sel.steps[s.key];
    const tplChoice = tpl.steps[s.key];
    const lines = stepLines(c, s);
    const brands = stepBrands(c, s, choice.lineId);
    const problems = outcome.problems.filter((p) => p.step === s.key);
    const off = s.toggle
      ? !choice.on
      : s.coats
        ? s.coats.every((k) => (choice.coats[k.key] ?? 0) === 0)
        : false;
    return (
      <li
        key={s.key}
        className={cn("grid gap-3 px-4 py-3.5", off && "bg-surface-sunken/40")}
      >
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              "text-[15px] font-bold",
              off && "text-muted-foreground",
            )}
          >
            {t(`step_${s.key}`)}
          </span>
          {s.toggle && (
            <Switch
              checked={choice.on}
              aria-label={t(`step_${s.key}`)}
              onCheckedChange={(v) => setStep(s.key, { on: v })}
              className={cn(
                changed(choice.on, tplChoice.on) && "ring-2 ring-warning",
              )}
            />
          )}
        </div>

        {!off && lines.length > 1 && !s.brandOnly && (
          <NativeSelect
            aria-label={t("product")}
            value={choice.lineId ?? ""}
            onChange={(e) => setStep(s.key, { lineId: e.target.value || null })}
            className={cn(
              "h-10 text-[14px]",
              changed(choice.lineId, tplChoice.lineId) && "border-warning",
            )}
          >
            {lines.map((l) => (
              <option key={l.lineId} value={l.lineId}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
        )}

        {!off && brands.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 shrink-0 text-[12px] text-muted-foreground">
              {te("brand")}
            </span>
            <Chips
              label={te("brand")}
              value={choice.brand ?? ("" as string)}
              options={brands.map((b) => b ?? "")}
              render={(b) => brandName(b || null)}
              onChange={(b) => setStep(s.key, { brand: b || null })}
              modified={changed(choice.brand, tplChoice.brand)}
            />
          </div>
        )}

        {(s.coats ?? []).map((slot) => {
          const v = choice.coats[slot.key] ?? 0;
          return (
            <div key={slot.key} className="flex flex-wrap items-center gap-2">
              <span className="w-14 shrink-0 text-[12px] text-muted-foreground">
                {t(`slot_${slot.key}`)}
              </span>
              <Chips
                label={`${t(`step_${s.key}`)} — ${t(`slot_${slot.key}`)}`}
                value={v}
                options={Array.from({ length: slot.max + 1 }, (_, i) => i)}
                render={(n) => (n === 0 ? t("none") : t("coats", { n }))}
                onChange={(n) =>
                  setStep(s.key, { coats: { ...choice.coats, [slot.key]: n } })
                }
                modified={v !== (tplChoice.coats[slot.key] ?? 0)}
              />
            </div>
          );
        })}

        {problems.map((p) => (
          <p
            key={p.role}
            className="flex gap-2 rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-danger"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {t(`problem_${p.reason}`, {
              product:
                p.product ??
                (te.has(`role_${p.role}`) ? te(`role_${p.role}`) : p.role),
            })}
          </p>
        ))}
      </li>
    );
  }

  function labourPanel() {
    const l = sel.labour;
    const external = ctx.external.filter(
      (e) => !e.service || e.service === kind,
    );
    const setLabour = (v: Labour) => setSel((s) => ({ ...s, labour: v }));
    return (
      <section className="grid gap-3 rounded-2xl border border-border p-4">
        <p className="text-[14px] font-bold">{t("labour")}</p>
        <Chips
          label={t("labour")}
          value={l.source}
          options={["rates", "inhouse", "external"] as const}
          render={(v) => t(`labour_${v}`)}
          onChange={(v) =>
            setLabour(
              v === "rates"
                ? { source: "rates" }
                : v === "external"
                  ? { source: "external", externalId: external[0]?.id ?? null }
                  : { source: "inhouse", crew: [] },
            )
          }
          modified={l.source !== tpl.labour.source}
        />
        {l.source === "rates" && (
          <p className="text-[12px] text-muted-foreground">
            {t("labourRatesHint")}
          </p>
        )}
        {l.source === "external" &&
          (external.length ? (
            <NativeSelect
              aria-label={t("labour_external")}
              value={l.externalId ?? ""}
              onChange={(e) =>
                setLabour({
                  source: "external",
                  externalId: e.target.value || null,
                })
              }
            >
              {external.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} —{" "}
                  {e.basis === "external_per_unit"
                    ? t("perM2", { rate: fmt.number(e.rate, 2) })
                    : t("lump", { rate: fmt.number(e.rate, 0) })}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <p className="text-[12px] text-danger">{t("noExternal")}</p>
          ))}
        {l.source === "inhouse" &&
          (!canSeeCrewCost ? (
            <p className="text-[12px] text-danger">{t("noCrewAccess")}</p>
          ) : ctx.crew.length === 0 ? (
            <p className="text-[12px] text-danger">{t("noCrew")}</p>
          ) : (
            <>
            {(ctx.teams?.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-muted-foreground">{t("pickTeam")}</span>
                {ctx.teams!.map((tm) => {
                  const same = tm.members.length === l.crew.length && tm.members.every((id) => l.crew.includes(id));
                  return (
                    <button
                      key={tm.id}
                      type="button"
                      aria-pressed={same}
                      onClick={() => setLabour({ source: "inhouse", crew: [...tm.members], teamId: tm.id })}
                      className={cn("min-h-9 rounded-full border px-3 text-[13px] font-semibold", same ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:border-primary/50")}
                    >
                      {tm.name}
                    </button>
                  );
                })}
              </div>
            )}
            <ul className="grid gap-1">
              {ctx.crew.map((m) => {
                const on = l.crew.includes(m.id);
                return (
                  <li
                    key={m.id}
                    className="flex min-h-10 items-center justify-between gap-3"
                  >
                    <label htmlFor={`crew-${m.id}`} className="text-[14px]">
                      {m.name}
                      {m.job && (
                        <span className="ms-1.5 text-[12px] text-muted-foreground">
                          · {m.job}
                        </span>
                      )}
                      <span className="ms-1.5 font-latin text-[12px] text-muted-foreground">
                        ·{" "}
                        {m.perDay != null
                          ? t("perDay", { cost: fmt.number(m.perDay, 0) })
                          : "—"}
                      </span>
                    </label>
                    <Switch
                      id={`crew-${m.id}`}
                      checked={on}
                      onCheckedChange={(v) =>
                        setLabour({
                          source: "inhouse",
                          crew: v
                            ? [...l.crew, m.id]
                            : l.crew.filter((x) => x !== m.id),
                          // a hand-picked crew is no longer the team picked with one tap
                          teamId: null,
                        })
                      }
                    />
                  </li>
                );
              })}
            </ul>
            </>
          ))}
        {outcome.labourNote && (
          <p className="text-[12px] text-danger">
            {t(`labourNote_${outcome.labourNote}`)}
          </p>
        )}
      </section>
    );
  }

  const GYPSUM_PARTS = [
    "c_channel",
    "omega",
    "rod",
    "washers",
    "vertical_hanger",
    "anchors",
    "clips",
    "edge_angle",
    "angle_screws",
    "board_screws",
    "joint_tape",
    "joint_compound",
    "stud",
    "track",
  ];
  const isModified = changed(
    { ...sel, labour: sel.labour.source },
    { ...tpl, labour: tpl.labour.source },
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,460px)_1fr]">
      <div className="grid content-start gap-5">
        {!quote && (
          <Segmented
            name={t("service")}
            value={kind}
            onChange={setKind}
            options={[
              { value: "gypsum", label: t("kind_gypsum"), icon: <Hammer /> },
              {
                value: "interior",
                label: t("kind_interior"),
                icon: <PaintRoller />,
              },
              {
                value: "exterior",
                label: t("kind_exterior"),
                icon: <PaintBucket />,
              },
            ]}
          />
        )}

        {/* 1 — quantities (from the survey in a quote) */}
        {quote ? (
          quote.quantitiesPanel
        ) : (
          <section className="grid gap-3 rounded-2xl border border-border bg-surface p-4">
            <p className="text-[14px] font-bold">{t("quantities")}</p>
            {kind === "gypsum" && (
              <div className="field-row grid grid-cols-2 gap-3">
                {qty("ceilNormal", te("boardNormal"), "m²")}
                {qty("ceilMoisture", te("boardMoisture"), "m²")}
                {qty("ceilFire", te("boardFire"), "m²")}
                {qty("partitions", te("partitions"), "m²")}
              </div>
            )}
            {kind === "interior" && (
              <>
                <div className="field-row grid-cols-2 gap-3">
                  {qty("walls", te("walls"), "m²")}
                  {qty("ceilings", te("ceilings"), "m²")}
                  {qty("wet", te("wetZone"), "m²")}
                  {qty("decorative", te("decorativeZone"), "m²")}
                </div>
                {/* three per row: no field left alone on a line */}
                <div className="field-row grid-cols-3 gap-2 sm:gap-3">
                  {qty("colours", te("wallColours"))}
                  {qty("ceilingColours", te("ceilingColours"))}
                  {qty("crackM", te("cracks"), "m")}
                </div>
              </>
            )}
            {kind === "exterior" && (
              <div className="field-row grid-cols-3 gap-2 sm:gap-3">
                {qty("facade", te("facadeArea"), "m²")}
                {qty("extColours", te("wallColours"))}
                {qty("scaffoldDays", te("scaffoldDays"))}
              </div>
            )}
          </section>
        )}

        {/* 2 — method / options as buttons */}
        <section className="grid gap-3 rounded-2xl border border-border bg-surface p-4">
          <p className="text-[14px] font-bold">{t("options")}</p>
          <Chips
            label={t("projectType")}
            value={sel.options.projectType ?? "full"}
            options={["full", "labour", "supply"] as const}
            render={(v) => t(`pt_${v}`)}
            onChange={(v) => setOpt("projectType", v)}
            modified={(sel.options.projectType ?? "full") !== (tpl.options.projectType ?? "full")}
          />
          {kind === "exterior" && (
            <Chips
              label={te("method")}
              value={sel.options.method}
              options={["roller", "profile", "spray"] as const}
              render={(m) => t(`method_${m}`)}
              onChange={(m) => setOpt("method", m)}
              modified={sel.options.method !== tpl.options.method}
            />
          )}
          {kind === "interior" && (
            <Chips
              label={te("system")}
              value={sel.options.variant}
              options={["new", "repaint"] as const}
              render={(m) => t(`variant_${m}`)}
              onChange={(m) => setOpt("variant", m)}
              modified={sel.options.variant !== tpl.options.variant}
            />
          )}
          {kind === "gypsum" && (
            <div className="grid gap-3">
              <OptionRow label={te("suspension")}>
                <Chips
                  label={te("suspension")}
                  value={sel.options.suspension}
                  options={["rod", "vertical_c"] as const}
                  render={(m) => t(`susp_${m}`)}
                  onChange={(m) => setOpt("suspension", m)}
                  modified={sel.options.suspension !== tpl.options.suspension}
                />
              </OptionRow>
              <OptionRow label={te("layers")}>
                <Chips
                  label={te("layers")}
                  value={sel.options.layers}
                  options={PRESETS.layers}
                  onChange={(m) => setOpt("layers", m)}
                  modified={sel.options.layers !== tpl.options.layers}
                />
              </OptionRow>
              <OptionRow label={t("hangingHeight")}>
                <Chips
                  label={t("hangingHeight")}
                  value={sel.options.hangingHeight}
                  options={PRESETS.hangingHeight}
                  render={(v) => `${Math.round(v * 100)}`}
                  onChange={(m) => setOpt("hangingHeight", m)}
                  modified={
                    sel.options.hangingHeight !== tpl.options.hangingHeight
                  }
                />
              </OptionRow>
              <OptionRow label={t("cSpacing")}>
                <Chips
                  label={t("cSpacing")}
                  value={sel.options.cSpacing}
                  options={PRESETS.cSpacing}
                  render={(v) => `${Math.round(v * 100)}`}
                  onChange={(m) => setOpt("cSpacing", m)}
                  modified={sel.options.cSpacing !== tpl.options.cSpacing}
                />
              </OptionRow>
              <OptionRow label={t("omegaSpacing")}>
                <Chips
                  label={t("omegaSpacing")}
                  value={sel.options.omegaSpacing}
                  options={PRESETS.omegaSpacing}
                  render={(v) => `${Math.round(v * 100)}`}
                  onChange={(m) => setOpt("omegaSpacing", m)}
                  modified={
                    sel.options.omegaSpacing !== tpl.options.omegaSpacing
                  }
                />
              </OptionRow>
              <p className="text-[11px] text-subtle-foreground">
                {t("cmNote")}
              </p>
              {!quote && (
                <div className="grid gap-2 border-t border-border pt-3">
                  <p className="text-[13px] font-bold">
                    {te("optionalFeatures")}
                  </p>
                  <div className="field-row grid grid-cols-2 gap-3">
                    {qty("troughM", te("trough"), "m")}
                    {qty("shadowM", te("shadow"), "m")}
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    {t("hatches")}
                  </p>
                  <div className="field-row grid-cols-5 gap-x-1.5 sm:gap-x-3">
                    {PRESETS.hatches.map((h) => (
                      <Field
                        key={h}
                        id={`hatch-${h}`}
                        label={h.replace("x", "×")}
                      >
                        <NumberInput
                          id={`hatch-${h}`}
                          defaultValue={q.hatches[h] || ""}
                          onChange={(e) => {
                            const n = toNumber(e.target.value);
                            setQs((all) => ({
                              ...all,
                              gypsum: {
                                ...all.gypsum,
                                hatches: {
                                  ...all.gypsum.hatches,
                                  [h]:
                                    typeof n === "number"
                                      ? Math.max(0, Math.round(n))
                                      : 0,
                                },
                              },
                            }));
                          }}
                        />
                      </Field>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 3 — steps: product, brand, coats */}
        <section className="overflow-hidden rounded-2xl border border-border bg-surface">
          <p className="border-b border-border px-4 py-3 text-[14px] font-bold">
            {t("steps")}
          </p>
          <ul className="divide-y divide-border">
            {visibleSteps.map(stepCard)}
          </ul>
          {kind === "gypsum" && (
            <details className="group border-t border-border px-4 py-3">
              <summary className="cursor-pointer list-none text-[13px] font-bold text-muted-foreground">
                {t("gypsumParts")}
              </summary>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {GYPSUM_PARTS.map((r) => {
                  const on = !sel.excluded.includes(r);
                  return (
                    <li
                      key={r}
                      className="flex min-h-10 items-center justify-between gap-2"
                    >
                      <label
                        htmlFor={`part-${r}`}
                        className={cn(
                          "text-[13px]",
                          !on && "text-muted-foreground line-through",
                        )}
                      >
                        {te.has(`role_${r}`) ? te(`role_${r}`) : r}
                      </label>
                      <Switch
                        id={`part-${r}`}
                        checked={on}
                        onCheckedChange={(v) =>
                          setSel((s) => ({
                            ...s,
                            excluded: v
                              ? s.excluded.filter((x) => x !== r)
                              : [...s.excluded, r],
                          }))
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </section>

        {labourPanel()}

        {quote?.history && (quote.history.won > 0 || quote.history.lost > 0) && (
          <PastSuggestions
            h={quote.history}
            service={kind}
            onApply={(m) => {
              setSel((s) => ({ ...s, marginPercent: m }));
              setMarginKey((k) => k + 1);
            }}
          />
        )}

        {/* items-start: the risk reserve carries a hint underneath; both fields still start on one line */}
        <section className="grid grid-cols-2 items-start gap-3">
          <Field id="margin" label={te("margin")}>
            <NumberInput
              id="margin"
              key={`m-${kind}-${marginKey}`}
              defaultValue={sel.marginPercent ?? ""}
              placeholder={String(
                c.rates["commercial.targetMarginPercent"] ?? 28,
              )}
              onChange={(e) => {
                const n = toNumber(e.target.value);
                setSel((s) => ({
                  ...s,
                  marginPercent: typeof n === "number" ? Math.min(90, n) : null,
                }));
              }}
              suffix="%"
            />
          </Field>
          <Field id="contingency" label={t("contingency")} hint={t("contingencyHint")}>
            <NumberInput
              id="contingency"
              key={`c-${kind}`}
              defaultValue={sel.contingencyPercent ?? ""}
              placeholder={String(c.rates["commercial.contingencyPercent"] ?? 5)}
              onChange={(e) => {
                const n = toNumber(e.target.value);
                setSel((s) => ({ ...s, contingencyPercent: typeof n === "number" ? Math.min(50, Math.max(0, n)) : null }));
              }}
              suffix="%"
            />
          </Field>
          <div className="col-span-2 flex gap-2">
            {isModified && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSels((all) => ({ ...all, [kind]: base[kind] }))
                }
              >
                <RotateCcw /> {t("reset")}
              </Button>
            )}
          </div>
        </section>
        {quote
          ? quote.renderActions(sel, outcome)
          : canManage && (
              <Button
                variant="secondary"
                loading={pending}
                onClick={() =>
                  run(onSaveTemplate && (() => onSaveTemplate(sel)))
                }
              >
                <Save /> {t("saveTemplate", { service: t(`kind_${kind}`) })}
              </Button>
            )}
      </div>

      {/* Results */}
      <div className="grid content-start gap-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi label={te("totalCost")} value={fmt.money(price.cost)} />
          <Kpi
            label={te("sellingPrice")}
            value={fmt.money(price.subtotal)}
            strong
          />
          <Kpi
            label={te("achievedMargin")}
            value={fmt.percent(price.marginPercent / 100)}
            sub={te("markup", { n: fmt.number(price.markupPercent, 1) })}
          />
        </div>

        <div className="@container overflow-hidden rounded-2xl border border-border bg-surface">
          {/* narrow (phone, half an iPad): one block per work type — five columns don't fit and the
              last ones (price per m², total) would be cut off */}
          <ul className="divide-y divide-border @2xl:hidden" data-testid="work-types-stacked">
            {price.byWorkType.map((w) => (
              <li key={w.workType} className="grid gap-2 px-4 py-3">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-bold">{te(`wt_${w.workType}`)}</span>
                  <span className="font-latin text-[13px] tabular-nums text-muted-foreground">
                    {te("area")} {fmt.number(w.area, 1)}
                  </span>
                </p>
                <dl className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2 text-[12px] [&_dd]:font-latin [&_dd]:text-[14px] [&_dd]:tabular-nums [&_dt]:text-muted-foreground">
                  <div className="grid gap-0.5">
                    <dt>{te("cost")}</dt>
                    <dd>{fmt.money(w.cost)}</dd>
                  </div>
                  <div className="grid gap-0.5">
                    <dt>{te("pricePerM2")}</dt>
                    <dd className="font-bold text-primary">{fmt.money(w.pricePerM2)}</dd>
                  </div>
                  <div className="grid gap-0.5">
                    <dt>{te("total")}</dt>
                    <dd>{fmt.money(w.total)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <table className="hidden w-full text-[14px] @2xl:table">
            <thead className="bg-surface-sunken/60 text-[12px] text-muted-foreground">
              <tr>
                <th className="whitespace-nowrap px-4 py-2.5 text-start font-bold">
                  {te("workType")}
                </th>
                <th className="px-4 py-2.5 text-end font-bold">{te("area")}</th>
                <th className="px-4 py-2.5 text-end font-bold">{te("cost")}</th>
                <th className="px-4 py-2.5 text-end font-bold">
                  {te("pricePerM2")}
                </th>
                <th className="px-4 py-2.5 text-end font-bold">
                  {te("total")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-latin tabular-nums">
              {price.byWorkType.map((w) => (
                <tr key={w.workType}>
                  <td className="px-4 py-3 font-sans font-bold">
                    {te(`wt_${w.workType}`)}
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
          {ctx.vatPercent > 0 && (
            <p className="flex justify-between border-t border-border px-4 py-3 text-[14px]">
              <span>{te("vatLine", { n: ctx.vatPercent })}</span>
              <span className="font-latin tabular-nums">
                {fmt.money(price.vat)}
              </span>
            </p>
          )}
        </div>

        {quote?.commission && quote.commission.percent > 0 && (
          <p className="flex flex-wrap justify-between gap-2 rounded-2xl border border-dashed border-primary/40 px-5 py-3 text-[13px]" data-testid="partner-reward-line">
            <span>{t("partnerReward", { name: quote.commission.name, percent: fmt.number(quote.commission.percent) })}</span>
            {/* on the net after the discount — exactly what the version saves */}
            <span className="font-latin font-bold tabular-nums">{fmt.money(commissionOnNet(price.subtotal, quote.commission.discountPercent, quote.commission.percent))}</span>
            <span className="w-full text-[12px] text-muted-foreground">{t("partnerRewardHint")}</span>
          </p>
        )}
        {outcome.problems.some((p) => p.reason === "margin") && (
          <p className="flex items-center gap-2 rounded-2xl bg-danger-soft px-5 py-3 text-[13px] text-danger" data-testid="margin-too-high">
            <AlertTriangle className="size-4 shrink-0" /> {t("problem_margin", { max: MAX_MARGIN_AND_REWARD })}
          </p>
        )}
        {(() => {
          const target = sel.marginPercent ?? c.rates["commercial.targetMarginPercent"] ?? 28;
          const step = c.rates["commercial.roundingStep"] ?? 1;
          return price.marginPercent - target > 0.1 ? (
            <p className="rounded-2xl bg-info-soft px-5 py-3 text-[13px] text-info">
              {t("roundingNote", { target: fmt.number(target, 1), achieved: fmt.number(price.marginPercent, 1), step: fmt.number(step, 2) })}
            </p>
          ) : null;
        })()}
        {outcome.problems.length > 0 && (
          <p className="flex items-center gap-2 rounded-2xl bg-danger-soft px-5 py-3 text-[13px] text-danger">
            <AlertTriangle className="size-4 shrink-0" />{" "}
            {t("problemsSummary", { n: outcome.problems.length })}
          </p>
        )}
        {isModified && (
          <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="inline-block size-3 rounded-full border border-warning bg-warning-soft" />{" "}
            {t("modifiedLegend")}
          </p>
        )}

        <ScopeSummary sel={sel} visible={visibleSteps} />
        <LinesTable
          lines={outcome.result.lines}
          explain={(role) => [
            t("problem_no_product", {
              product: te.has(`role_${role}`) ? te(`role_${role}`) : role,
            }),
          ]}
        />
      </div>
    </div>
  );
}

function OptionRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** What the quote will list as included / not included. */
function ScopeSummary({
  sel,
  visible,
}: {
  sel: Selection;
  visible: StepDef[];
}) {
  const sep = useListSep();
  const t = useTranslations("pricing");
  const included: string[] = [];
  const excluded: string[] = [];
  for (const s of visible) {
    // the same rule as the client's quote (parts the client supplies aren't included)
    (stepIncluded(s, sel.steps[s.key], sel.excluded) ? included : excluded).push(t(`step_${s.key}`));
  }
  return (
    <div className="grid gap-2 rounded-2xl border border-border bg-surface p-4 text-[13px] sm:grid-cols-2">
      <div>
        <p className="mb-1 font-bold text-primary">{t("included")}</p>
        <p className="leading-6">{included.join(sep) || "—"}</p>
      </div>
      <div>
        <p className="mb-1 flex items-center gap-1.5 font-bold text-muted-foreground">
          <Lock className="size-3.5" /> {t("notIncluded")}
        </p>
        <p className="leading-6 text-muted-foreground">
          {excluded.join(sep) || "—"}
        </p>
      </div>
    </div>
  );
}

/** §8.2: what the company's own past quotes for this service suggest. */
function PastSuggestions({ h, service, onApply }: { h: PastStats; service: ServiceKind; onApply: (margin: number) => void }) {
  const t = useTranslations("pricing");
  const td = useTranslations("doc");
  const { fmt } = useFormatter();
  return (
    <section className="grid gap-2 rounded-2xl border border-border bg-surface p-4 text-[13px]">
      <p className="flex items-center gap-2 text-[14px] font-bold">
        <History className="size-4 text-primary" /> {t("pastTitle")}
      </p>
      <p className="text-muted-foreground">
        {t("pastCounts", { won: h.won, lost: h.lost })}
        {h.winRate != null && ` · ${t("pastWinRate", { rate: fmt.number(h.winRate, 0) })}`}
      </p>
      {h.wonMargin != null && (
        <p>
          {t("pastWonMargin", { m: fmt.number(h.wonMargin, 1) })}
          {h.lostMargin != null && ` · ${t("pastLostMargin", { m: fmt.number(h.lostMargin, 1) })}`}
        </p>
      )}
      {h.pricePerM2.length > 0 && (
        <ul className="grid gap-0.5">
          {h.pricePerM2.map((p) => (
            <li key={p.workType} className="flex justify-between gap-2">
              <span>{workItemLabel(td, service, p.workType)}</span>
              <span className="font-latin tabular-nums">{t("pastPrice", { price: fmt.money(p.median), n: p.count })}</span>
            </li>
          ))}
        </ul>
      )}
      {h.durationFactor != null && h.durationFactor > 1.05 && <p className="text-warning-foreground">{t("pastSlower", { pct: fmt.number((h.durationFactor - 1) * 100, 0) })}</p>}
      {h.suggestedMargin != null ? (
        <Button size="sm" variant="secondary" className="justify-self-start" onClick={() => onApply(h.suggestedMargin!)}>
          {t("pastApply", { m: fmt.number(h.suggestedMargin, 1) })}
        </Button>
      ) : (
        <p className="text-muted-foreground">{t("pastFew")}</p>
      )}
    </section>
  );
}
