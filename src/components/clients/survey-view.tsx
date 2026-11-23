"use client";
import { ArrowLeft, Copy, Hammer, PaintBucket, PaintRoller, Pencil, Plus, Ruler, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { FormDialog, NumberInput, str, useActionRunner } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import type { ActionResult } from "@/lib/actions";
import type { SurveyDetail } from "@/lib/data/clients";
import { PRESETS, type Quantities, type ServiceKind } from "@/lib/pricing";
import { roomCeiling, roomWalls, surveyGaps, surveyQuantities, type BoardType, type SurveyMode, type SurveyRoom, type SurveyTotals, type WallZone } from "@/lib/survey";
import { toNumber } from "@/lib/validation/numbers";
import { cn } from "@/lib/utils";

type Act = (i: Record<string, unknown>) => Promise<ActionResult>;

function Pills<T extends string>({ value, options, onChange, render, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; render: (v: T) => string; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
          className={cn("min-h-9 rounded-full border px-3 text-[13px]", o === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted-foreground")}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}

export function SurveyView({
  detail,
  canManage,
  canQuote,
  actions,
  base = "",
}: {
  base?: string;
  detail: SurveyDetail;
  canManage: boolean;
  canQuote: boolean;
  actions?: { saveSurvey: Act; saveRoom: Act; deleteRoom: Act };
}) {
  const t = useTranslations("survey");
  const tc = useTranslations("common");
  const { fmt } = useFormatter();
  const router = useRouter();
  const { run, pending, fieldText } = useActionRunner();
  const { survey, client, rooms } = detail;

  const [mode, setMode] = React.useState<SurveyMode>(survey.mode);
  const [totals, setTotals] = React.useState<SurveyTotals>(survey.totals);
  const [meta, setMeta] = React.useState({ title: survey.title ?? "", visit_date: survey.visit_date ?? "", notes: survey.notes ?? "" });
  const [dirty, setDirty] = React.useState(false);
  const [room, setRoom] = React.useState<Partial<SurveyRoom> | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const setTotal = (k: keyof SurveyTotals) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = toNumber(e.target.value);
    setTotals((s) => ({ ...s, [k]: typeof n === "number" && n >= 0 ? n : undefined }));
    setDirty(true);
  };
  const tot = (k: Exclude<keyof SurveyTotals, "hatches" | "gypsumRooms">, label: string, suffix?: string, integer?: boolean) => (
    <Field id={`t-${k}`} label={label}>
      <NumberInput id={`t-${k}`} defaultValue={(totals[k] as number | undefined) ?? ""} onChange={setTotal(k)} suffix={suffix} disabled={!canManage} inputMode={integer ? "numeric" : "decimal"} />
    </Field>
  );

  const saveSurvey = () =>
    run(
      actions &&
        (() =>
          actions.saveSurvey({
            id: survey.id,
            title: meta.title || null,
            mode,
            visit_date: meta.visit_date || null,
            notes: meta.notes || null,
            totals: Object.fromEntries(Object.entries(totals).filter(([, v]) => v !== undefined && v !== null)),
          })),
      { onSuccess: () => setDirty(false) },
    );

  const quantities: Record<ServiceKind, Quantities> = {
    gypsum: surveyQuantities("gypsum", mode, rooms, totals),
    interior: surveyQuantities("interior", mode, rooms, totals),
    exterior: surveyQuantities("exterior", mode, rooms, totals),
  };

  function roomDialog() {
    const r = room!;
    return (
      <FormDialog
        open
        onOpenChange={(v) => !v && (setRoom(null), setErrors({}))}
        title={r.id ? t("editRoom") : t("newRoom")}
        pending={pending}
        onSubmit={(fd) =>
          run(
            actions &&
              (() =>
                actions.saveRoom({
                  ...(r.id ? { id: r.id } : {}),
                  survey_id: survey.id,
                  name: str(fd, "name"),
                  unit_label: str(fd, "unit_label") || null,
                  length_m: str(fd, "length_m"),
                  width_m: str(fd, "width_m"),
                  height_m: str(fd, "height_m"),
                  openings_m2: str(fd, "openings_m2") || "0",
                  gypsum_ceiling: !!r.gypsum_ceiling,
                  ceiling_board: r.ceiling_board ?? "normal",
                  paint_walls: r.paint_walls ?? true,
                  paint_ceiling: r.paint_ceiling ?? true,
                  wall_zone: r.wall_zone ?? "normal",
                  sort_order: r.id ? undefined : rooms.length,
                })),
            { onFieldErrors: setErrors, onSuccess: () => (setRoom(null), setErrors({})) },
          )
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field id="rm-name" label={t("roomName")} error={fieldText(errors.name)}>
            <Input name="name" defaultValue={r.name ?? ""} placeholder={t("roomNamePh")} autoFocus />
          </Field>
          <Field id="rm-unit" label={t("unitLabel")} optional={tc("optional")}>
            <Input name="unit_label" defaultValue={r.unit_label ?? ""} placeholder={t("unitLabelPh")} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field id="rm-l" label={t("length")} error={fieldText(errors.length_m)}>
            <NumberInput name="length_m" defaultValue={r.length_m ?? ""} suffix="m" />
          </Field>
          <Field id="rm-w" label={t("width")} error={fieldText(errors.width_m)}>
            <NumberInput name="width_m" defaultValue={r.width_m ?? ""} suffix="m" />
          </Field>
          <Field id="rm-h" label={t("height")} error={fieldText(errors.height_m)}>
            <NumberInput name="height_m" defaultValue={r.height_m ?? 3} suffix="m" />
          </Field>
        </div>
        <Field id="rm-o" label={t("openings")} hint={t("openingsHint")} error={fieldText(errors.openings_m2)}>
          <NumberInput name="openings_m2" defaultValue={r.openings_m2 ?? ""} suffix="m²" />
        </Field>

        <div className="grid gap-3 rounded-2xl bg-surface-sunken/70 p-4">
          <p className="text-[13px] font-bold">{t("appliesHere")}</p>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="rm-g" className="text-[14px]">
              {t("gypsumCeiling")}
            </label>
            <Switch id="rm-g" checked={!!r.gypsum_ceiling} onCheckedChange={(v) => setRoom({ ...r, gypsum_ceiling: v })} />
          </div>
          {r.gypsum_ceiling && (
            <Pills label={t("boardType")} value={(r.ceiling_board ?? "normal") as BoardType} options={["normal", "moisture", "fire"] as const} render={(b) => t(`board_${b}`)} onChange={(b) => setRoom({ ...r, ceiling_board: b })} />
          )}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <label htmlFor="rm-pw" className="text-[14px]">
              {t("paintWalls")}
            </label>
            <Switch id="rm-pw" checked={r.paint_walls ?? true} onCheckedChange={(v) => setRoom({ ...r, paint_walls: v })} />
          </div>
          {(r.paint_walls ?? true) && (
            <Pills label={t("wallZone")} value={(r.wall_zone ?? "normal") as WallZone} options={["normal", "wet", "decorative"] as const} render={(z) => t(`zone_${z}`)} onChange={(z) => setRoom({ ...r, wall_zone: z })} />
          )}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <label htmlFor="rm-pc" className="text-[14px]">
              {t("paintCeiling")}
            </label>
            <Switch id="rm-pc" checked={r.paint_ceiling ?? true} onCheckedChange={(v) => setRoom({ ...r, paint_ceiling: v })} />
          </div>
        </div>
      </FormDialog>
    );
  }

  const SERVICES: { kind: ServiceKind; icon: React.ReactNode }[] = [
    { kind: "gypsum", icon: <Hammer className="size-4" /> },
    { kind: "interior", icon: <PaintRoller className="size-4" /> },
    { kind: "exterior", icon: <PaintBucket className="size-4" /> },
  ];

  return (
    <div className="grid gap-6">
      <Link href={`${base}/clients/${client.number}`} className="inline-flex w-fit items-center gap-1.5 text-[14px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:rotate-180" /> {client.name}
      </Link>

      <section className="grid gap-4 rounded-3xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-latin text-[12px] text-muted-foreground"><bdi dir="ltr" className="whitespace-nowrap">{survey.number}</bdi></p>
          <Segmented
            name={t("mode")}
            value={mode}
            onChange={(m) => (setMode(m), setDirty(true))}
            options={[
              { value: "rooms", label: t("modeRooms") },
              { value: "total", label: t("modeTotal") },
            ]}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field id="sv-title" label={t("title")} optional={tc("optional")}>
            <Input value={meta.title} onChange={(e) => (setMeta({ ...meta, title: e.target.value }), setDirty(true))} placeholder={t("titlePh")} disabled={!canManage} />
          </Field>
          <Field id="sv-date" label={t("visitDate")}>
            <Input type="date" value={meta.visit_date} onChange={(e) => (setMeta({ ...meta, visit_date: e.target.value }), setDirty(true))} disabled={!canManage} />
          </Field>
        </div>
      </section>

      {mode === "rooms" && (
        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-[17px] font-bold">
              <Ruler className="size-5 text-muted-foreground" /> {t("rooms")}
            </h3>
            {canManage && (
              <Button size="sm" onClick={() => setRoom({ height_m: rooms.at(-1)?.height_m ?? 3, paint_walls: true, paint_ceiling: true })}>
                <Plus /> {t("addRoom")}
              </Button>
            )}
          </div>
          {rooms.length === 0 && <p className="rounded-2xl border border-dashed border-border p-6 text-center text-muted-foreground">{t("noRooms")}</p>}
          <ul className="grid gap-2 md:grid-cols-2">
            {rooms.map((r) => (
              <li key={r.id} className="grid gap-2 rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[15px] font-bold">
                      {r.name}
                      {r.unit_label && <span className="ms-2 text-[12px] font-normal text-muted-foreground">{r.unit_label}</span>}
                    </p>
                    <p className="font-latin text-[13px] text-muted-foreground" dir="ltr">
                      {fmt.number(r.length_m, 2)} × {fmt.number(r.width_m, 2)} × {fmt.number(r.height_m, 2)} m
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex">
                      <Button variant="ghost" size="icon-sm" aria-label={t("editRoom")} onClick={() => setRoom(r)}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={t("duplicateRoom")} onClick={() => setRoom({ ...r, id: undefined, name: `${r.name} 2` })}>
                        <Copy />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={t("deleteRoom")} onClick={() => run(actions && (() => actions.deleteRoom({ id: r.id })))}>
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.gypsum_ceiling && <Badge tone="primary">{t("gypsumBadge", { type: t(`board_${r.ceiling_board}`) })}</Badge>}
                  {r.paint_walls && <Badge tone={r.wall_zone === "normal" ? "neutral" : "info"}>{t("wallsBadge", { area: fmt.number(roomWalls(r), 1), zone: t(`zone_${r.wall_zone}`) })}</Badge>}
                  {r.paint_ceiling && <Badge>{t("ceilingBadge", { area: fmt.number(roomCeiling(r), 1) })}</Badge>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-4 rounded-3xl border border-border bg-surface p-5">
        <h3 className="text-[17px] font-bold">{mode === "rooms" ? t("extrasTitle") : t("totalsTitle")}</h3>
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="grid content-start gap-3">
            <p className="flex items-center gap-2 text-[14px] font-bold"><Hammer className="size-4" /> {t("svc_gypsum")}</p>
            {mode === "total" && (
              <div className="grid grid-cols-3 gap-2">
                {tot("ceilNormal", t("board_normal"), "m²")}
                {tot("ceilMoisture", t("board_moisture"), "m²")}
                {tot("ceilFire", t("board_fire"), "m²")}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {tot("partitions", t("partitions"), "m²")}
              {tot("troughM", t("trough"), "m")}
              {tot("shadowM", t("shadow"), "m")}
            </div>
            <p className="text-[12px] text-muted-foreground">{t("hatches")}</p>
            <div className="grid grid-cols-5 gap-1.5">
              {PRESETS.hatches.map((h) => (
                <Field key={h} id={`h-${h}`} label={h.replace("x", "×")}>
                  <NumberInput
                    id={`h-${h}`}
                    defaultValue={totals.hatches?.[h] || ""}
                    disabled={!canManage}
                    onChange={(e) => {
                      const v = toNumber(e.target.value);
                      setTotals((s) => ({ ...s, hatches: { ...(s.hatches ?? {}), [h]: typeof v === "number" ? Math.max(0, Math.round(v)) : 0 } }));
                      setDirty(true);
                    }}
                  />
                </Field>
              ))}
            </div>
          </div>
          <div className="grid content-start gap-3">
            <p className="flex items-center gap-2 text-[14px] font-bold"><PaintRoller className="size-4" /> {t("svc_interior")}</p>
            {mode === "total" && (
              <div className="grid grid-cols-2 gap-2">
                {tot("walls", t("walls"), "m²")}
                {tot("ceilings", t("ceilings"), "m²")}
                {tot("wet", t("wet"), "m²")}
                {tot("decorative", t("decorative"), "m²")}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {tot("colours", t("colours"), undefined, true)}
              {tot("ceilingColours", t("ceilingColours"), undefined, true)}
              {tot("crackM", t("cracks"), "m")}
            </div>
          </div>
          <div className="grid content-start gap-3">
            <p className="flex items-center gap-2 text-[14px] font-bold"><PaintBucket className="size-4" /> {t("svc_exterior")}</p>
            <div className="grid grid-cols-2 gap-2">
              {tot("facade", t("facade"), "m²")}
              {tot("extColours", t("colours"), undefined, true)}
              {tot("scaffoldDays", t("scaffoldDays"), undefined, true)}
            </div>
          </div>
        </div>
        <Field id="sv-notes" label={t("notes")} optional={tc("optional")}>
          <Textarea value={meta.notes} onChange={(e) => (setMeta({ ...meta, notes: e.target.value }), setDirty(true))} rows={2} disabled={!canManage} />
        </Field>
        {canManage && (
          <div className="flex items-center gap-3">
            <Button loading={pending} onClick={saveSurvey} disabled={!dirty}>
              {t("save")}
            </Button>
            {dirty && <span className="text-[13px] text-warning">{t("unsaved")}</span>}
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <h3 className="text-[17px] font-bold">{t("summary")}</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {SERVICES.map(({ kind, icon }) => {
            const q = quantities[kind];
            const gaps = surveyGaps(kind, q);
            const rows: [string, number, string][] =
              kind === "gypsum"
                ? [[t("board_normal"), q.ceilNormal, "m²"], [t("board_moisture"), q.ceilMoisture, "m²"], [t("board_fire"), q.ceilFire, "m²"], [t("partitions"), q.partitions, "m²"]]
                : kind === "interior"
                  ? [[t("walls"), q.walls, "m²"], [t("ceilings"), q.ceilings, "m²"], [t("wet"), q.wet, "m²"], [t("decorative"), q.decorative, "m²"]]
                  : [[t("facade"), q.facade, "m²"]];
            return (
              <div key={kind} className={cn("grid content-start gap-2 rounded-2xl border bg-surface p-4", gaps.length ? "border-border opacity-70" : "border-primary/30")}>
                <p className="flex items-center gap-2 text-[15px] font-bold">
                  {icon} {t(`svc_${kind}`)}
                </p>
                <dl className="grid gap-1 text-[13px]">
                  {rows.map(([label, v, u]) => (
                    <div key={label} className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-latin tabular-nums">
                        {fmt.number(v, 1)} {u}
                      </dd>
                    </div>
                  ))}
                </dl>
                {canQuote && !gaps.length && (
                  <Button
                    size="sm"
                    className="mt-1"
                    disabled={dirty}
                    title={dirty ? t("saveFirst") : undefined}
                    onClick={() => router.push(`${base}/quotations/new?survey=${survey.number}&service=${kind}`)}
                  >
                    {t("priceIt", { service: t(`svc_${kind}`) })}
                  </Button>
                )}
                {gaps.length > 0 && <p className="text-[12px] text-muted-foreground">{t(`gap_${gaps[0]}`)}</p>}
              </div>
            );
          })}
        </div>
      </section>

      {room && roomDialog()}
    </div>
  );
}
