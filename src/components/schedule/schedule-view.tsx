"use client";
import { DocNo } from "@/components/doc-no";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Pencil, Plus, Sparkles, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { FormDialog, useActionRunner, useListSep } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import type { ActionResult } from "@/lib/actions";
import type { ScheduleData, ScheduleEntry, ScheduleProject, ScheduleTeam } from "@/lib/data/schedule";
import type { ServiceKind } from "@/lib/pricing";
import { addDays, conflicts, daysBetween, earliestStart, overlaps, weekStart, windowDays, type Day } from "@/lib/schedule";
import { cn, ltr } from "@/lib/utils";

type Save = (i: Record<string, unknown>) => Promise<ActionResult<{ id: string }>>;
export type ScheduleActions = { saveTeam: Save; saveEntry: Save; deleteEntry: (i: { id: string }) => Promise<ActionResult> };

const SERVICES: ServiceKind[] = ["gypsum", "interior", "exterior"];
const COLORS = ["#9A5231", "#22262A", "#55654F", "#3B5B7A", "#6B4E71", "#75654E"];
const DAYS = 35; // five weeks
const COL = 40; // px per day
const LANE = 30; // px per stacked bar

/** Put overlapping bars on separate lanes so none hides another. */
function lanes<T extends { start: Day; end: Day }>(items: T[]): { item: T; lane: number }[] {
  const ends: Day[] = [];
  return [...items]
    .sort((a, b) => (a.start < b.start ? -1 : 1))
    .map((item) => {
      let lane = ends.findIndex((e) => e < item.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = item.end;
      return { item, lane };
    });
}

export function ScheduleView({
  data,
  today,
  actions,
  openContract,
  openTeam,
}: {
  data: ScheduleData;
  today: Day;
  actions?: ScheduleActions;
  /** contract number to book straight away (from the contract page) */
  openContract?: string;
  /** the team chosen when pricing (from the contract page) — pre-selected in the booking */
  openTeam?: string;
}) {
  const t = useTranslations("schedule");
  const [tab, setTab] = React.useState<"timeline" | "teams">(data.teams.length ? "timeline" : "teams");
  const preset = openContract ? data.projects.find((p) => p.number === openContract) : undefined;
  const [entry, setEntry] = React.useState<Partial<ScheduleEntry> | null>(
    preset && data.canManage && data.teams.length
      ? { kind: "work", contract_id: preset.id, start: preset.start, end: preset.end, ...(openTeam && data.teams.some((x) => x.id === openTeam && x.is_active) ? { team_id: openTeam } : {}) }
      : null,
  );
  const [team, setTeam] = React.useState<Partial<ScheduleTeam> | null>(null);

  return (
    <div className="grid min-w-0 gap-5 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          name={t("view")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "timeline", label: t("tabTimeline"), icon: <CalendarDays /> },
            { value: "teams", label: t("tabTeams"), icon: <Users /> },
          ]}
        />
        {data.canManage && (
          <div className="flex gap-2">
            {tab === "teams" ? (
              <Button onClick={() => setTeam({ kind: "inhouse", services: [], color: COLORS[data.teams.length % COLORS.length], is_active: true, members: [] })}>
                <Plus /> {t("newTeam")}
              </Button>
            ) : (
              data.teams.length > 0 && (
                <Button onClick={() => setEntry({ kind: "work", start: today, end: addDays(today, 6) })}>
                  <Plus /> {t("newEntry")}
                </Button>
              )
            )}
          </div>
        )}
      </div>

      {tab === "timeline" ? (
        <Timeline data={data} today={today} onEntry={data.canManage ? setEntry : undefined} onNeedTeams={() => setTab("teams")} />
      ) : (
        <Teams data={data} onEdit={data.canManage ? setTeam : undefined} />
      )}

      {entry && <EntryDialog data={data} today={today} initial={entry} onClose={() => setEntry(null)} actions={actions} />}
      {team && <TeamDialog data={data} initial={team} onClose={() => setTeam(null)} actions={actions} />}
    </div>
  );
}

// --- Timeline ----------------------------------------------------------------------

function Timeline({ data, today, onEntry, onNeedTeams }: { data: ScheduleData; today: Day; onEntry?: (e: Partial<ScheduleEntry>) => void; onNeedTeams: () => void }) {
  const t = useTranslations("schedule");
  const tp = useTranslations("pricing");
  const { fmt } = useFormatter();
  const [from, setFrom] = React.useState(() => weekStart(today));
  const days = windowDays(from, DAYS);
  const view = { start: from, end: days[days.length - 1] };
  const projects = data.projects.filter((p) => overlaps(p, view));
  const booked = new Set(data.entries.filter((e) => e.kind === "work").map((e) => e.contract_id));
  const unassigned = data.projects.filter((p) => p.status !== "draft" && !booked.has(p.id) && p.end >= today);
  const projectOf = new Map(data.projects.map((p) => [p.id, p]));
  const activeTeams = data.teams.filter((x) => x.is_active || data.entries.some((e) => e.team_id === x.id && overlaps(e, view)));

  // position of a span inside the window, clipped at both ends
  const place = (s: { start: Day; end: Day }) => {
    const a = Math.max(0, daysBetween(from, s.start));
    const b = Math.min(DAYS - 1, daysBetween(from, s.end));
    return { insetInlineStart: a * COL + 2, width: (b - a + 1) * COL - 4 };
  };

  return (
    <div className="grid min-w-0 gap-4 [&>*]:min-w-0">
      {unassigned.length > 0 && (
        <section className="grid gap-2 rounded-3xl border border-warning/40 bg-warning-soft/60 p-4">
          <p className="flex items-center gap-2 text-[14px] font-bold">
            <AlertTriangle className="size-4" /> {t("unassigned", { n: unassigned.length })}
          </p>
          <ul className="flex flex-wrap gap-2">
            {unassigned.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={!onEntry || !data.teams.length}
                  onClick={() => onEntry?.({ kind: "work", contract_id: p.id, start: p.start, end: p.end })}
                  className="rounded-full bg-surface px-3 py-1.5 text-[13px] ring-1 ring-border hover:ring-primary disabled:cursor-default"
                >
                  <DocNo>{p.number}</DocNo> · {p.client} · {fmt.dayMonth(p.start)} · {t("deliveryShort", { date: fmt.dayMonth(p.delivery) })}
                </button>
              </li>
            ))}
          </ul>
          {!data.teams.length && (
            <Button size="sm" variant="secondary" className="justify-self-start" onClick={onNeedTeams}>
              {t("setupTeams")}
            </Button>
          )}
        </section>
      )}

      <section className="min-w-0 overflow-hidden rounded-3xl border border-border bg-surface">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <p className="text-[15px] font-bold">
            {fmt.dayMonth(from)} – {fmt.date(view.end)}
          </p>
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" aria-label={t("prev")} onClick={() => setFrom(addDays(from, -7))}>
              <ChevronRight className="rtl:rotate-0 ltr:rotate-180" />
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setFrom(weekStart(today))}>
              {t("today")}
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={t("next")} onClick={() => setFrom(addDays(from, 7))}>
              <ChevronLeft className="rtl:rotate-0 ltr:rotate-180" />
            </Button>
          </div>
        </div>

        <div className="max-w-full overflow-x-auto overscroll-x-contain">
          {/* a narrower name column on phones, so the days (and the bars) get most of the screen */}
          <div className="grid w-max [--label-col:112px] sm:[--label-col:160px]" style={{ gridTemplateColumns: `var(--label-col) ${DAYS * COL}px` }}>
            {/* header */}
            <div className="sticky start-0 z-20 border-b border-border bg-surface" />
            <div className="flex border-b border-border">
              {days.map((d) => {
                const fri = new Date(`${d}T00:00:00Z`).getUTCDay() === 5;
                return (
                  <div
                    key={d}
                    style={{ width: COL }}
                    className={cn("flex shrink-0 flex-col items-center py-1.5 text-[11px]", fri && "bg-surface-sunken", d === today && "text-primary")}
                  >
                    <span className="text-subtle-foreground">{fmt.weekday(d)}</span>
                    <span className={cn("font-latin text-[13px] font-bold tabular-nums", d === today && "flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground")}>
                      {Number(d.slice(8))}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* projects */}
            <RowLabel>{t("projects")}</RowLabel>
            <Lane days={days} today={today} rows={Math.max(1, lanes(projects).reduce((m, x) => Math.max(m, x.lane + 1), 0))}>
              {lanes(projects).map(({ item: p, lane }) => (
                <button
                  key={p.id}
                  type="button"
                  title={`${ltr(p.number)} · ${p.client} · ${t("barDates", { last: fmt.date(p.end), delivery: fmt.date(p.delivery) })}`}
                  disabled={!onEntry || !data.teams.length}
                  onClick={() => onEntry?.({ kind: "work", contract_id: p.id, start: p.start, end: p.end })}
                  style={{ ...place(p), top: lane * LANE + 4 }}
                  className={cn(
                    "absolute flex h-[24px] items-center gap-1 truncate rounded-full px-2.5 text-[12px] font-bold",
                    p.status === "accepted" ? "bg-ink text-ink-foreground" : "border border-dashed border-ink/50 bg-surface text-foreground",
                    !booked.has(p.id) && "ring-2 ring-warning",
                  )}
                >
                  <span className="truncate">
                    {p.client} · {tp(`kind_${p.service}`)}
                  </span>
                </button>
              ))}
            </Lane>

            {/* teams */}
            {activeTeams.length === 0 && (
              <>
                <RowLabel>{t("tabTeams")}</RowLabel>
                <div className="p-3 text-[13px] text-muted-foreground">{t("noTeamsYet")}</div>
              </>
            )}
            {activeTeams.map((team) => {
              const own = data.entries.filter((e) => e.team_id === team.id && overlaps(e, view));
              const placed = lanes(own);
              const all = data.entries.filter((e) => e.team_id === team.id);
              return (
                <React.Fragment key={team.id}>
                  <RowLabel>
                    <span className="flex min-w-0 items-center gap-2" title={team.name}>
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: team.color }} />
                      <span className="line-clamp-2 min-w-0 break-words">{team.name}</span>
                    </span>
                  </RowLabel>
                  <Lane days={days} today={today} rows={Math.max(1, placed.reduce((m, x) => Math.max(m, x.lane + 1), 0))}>
                    {placed.map(({ item: e, lane }) => {
                      const p = e.contract_id ? projectOf.get(e.contract_id) : undefined;
                      const clash = conflicts(all, e).length > 0;
                      const label = e.kind === "work" ? (p ? `${p.client} · ${ltr(p.number)}` : "—") : e.title || t(`kind_${e.kind}`);
                      return (
                        <button
                          key={e.id}
                          type="button"
                          title={label}
                          disabled={!onEntry}
                          onClick={() => onEntry?.(e)}
                          style={{ ...place(e), top: lane * LANE + 4, ...(e.kind === "work" ? { background: team.color } : {}) }}
                          className={cn(
                            "absolute flex h-[24px] items-center gap-1 rounded-full px-2.5 text-[12px] font-bold",
                            e.kind === "work" ? "text-gypsum" : "bg-[repeating-linear-gradient(135deg,var(--surface-sunken)_0_6px,var(--surface)_6px_12px)] text-muted-foreground ring-1 ring-border",
                            clash && "ring-2 ring-danger",
                          )}
                        >
                          {clash && <AlertTriangle className="size-3.5 shrink-0" />}
                          <span className="truncate">{label}</span>
                        </button>
                      );
                    })}
                  </Lane>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </section>
      <p className="text-[12px] text-muted-foreground">{t("legend")}</p>
    </div>
  );
}

function RowLabel({ children }: { children: React.ReactNode }) {
  return <div className="sticky start-0 z-10 flex min-w-0 items-center overflow-hidden border-b border-border bg-surface px-3 py-2 text-[13px] leading-snug font-bold sm:px-4">{children}</div>;
}

function Lane({ days, today, rows, children }: { days: Day[]; today: Day; rows: number; children: React.ReactNode }) {
  return (
    <div className="relative border-b border-border" style={{ height: rows * LANE + 8 }}>
      <div className="absolute inset-0 flex" aria-hidden>
        {days.map((d) => (
          <div
            key={d}
            style={{ width: COL }}
            className={cn("shrink-0 border-e border-border/50", new Date(`${d}T00:00:00Z`).getUTCDay() === 5 && "bg-surface-sunken/70", d === today && "bg-primary/5")}
          />
        ))}
      </div>
      {children}
    </div>
  );
}

// --- Booking dialog -------------------------------------------------------------------

function EntryDialog({ data, today, initial, onClose, actions }: { data: ScheduleData; today: Day; initial: Partial<ScheduleEntry>; onClose: () => void; actions?: ScheduleActions }) {
  const t = useTranslations("schedule");
  const tp = useTranslations("pricing");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const teams = data.teams.filter((x) => x.is_active || x.id === initial.team_id);
  const [kind, setKind] = React.useState<ScheduleEntry["kind"]>(initial.kind ?? "work");
  const [contractId, setContractId] = React.useState(initial.contract_id ?? "");
  const project = data.projects.find((p) => p.id === contractId) as ScheduleProject | undefined;
  const pickTeam = (svc?: ServiceKind) => teams.find((x) => svc && x.services.includes(svc))?.id ?? teams[0]?.id ?? "";
  const [teamId, setTeamId] = React.useState(initial.team_id ?? pickTeam(project?.service));
  const [start, setStart] = React.useState(initial.start ?? today);
  const [end, setEnd] = React.useState(initial.end ?? today);
  const [title, setTitle] = React.useState(initial.title ?? "");
  const [notes, setNotes] = React.useState(initial.notes ?? "");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const length = Math.max(1, daysBetween(start, end) + 1);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && end >= start;
  const clashes = valid && teamId ? conflicts(data.entries, { id: initial.id, team_id: teamId, start, end }) : [];
  const busy = data.entries.filter((e) => e.team_id === teamId && e.id !== initial.id);
  const earliest = valid && teamId ? earliestStart(busy, start < today ? today : start, length) : null;
  const team = teams.find((x) => x.id === teamId);
  const wrongService = kind === "work" && project && team && team.services.length > 0 && !team.services.includes(project.service);
  const projectOf = new Map(data.projects.map((p) => [p.id, p]));

  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={initial.id ? t("editEntry") : t("newEntry")}
      pending={pending}
      footerExtra={
        initial.id && actions ? (
          <Button type="button" variant="ghost" className="text-danger" onClick={() => run(() => actions.deleteEntry({ id: initial.id! }), { onSuccess: onClose })}>
            <Trash2 /> {t("delete")}
          </Button>
        ) : undefined
      }
      onSubmit={() =>
        run(
          actions &&
            (() =>
              actions.saveEntry({
                ...(initial.id ? { id: initial.id } : {}),
                team_id: teamId,
                kind,
                contract_id: kind === "work" ? contractId || null : null,
                title: kind === "work" ? null : title.trim() || null,
                start_date: start,
                end_date: end,
                notes: notes.trim() || null,
              })),
          { onFieldErrors: setErrors, onSuccess: onClose },
        )
      }
    >
      <Segmented
        name={t("kind")}
        value={kind}
        onChange={setKind}
        options={(["work", "leave", "other"] as const).map((k) => ({ value: k, label: t(`kind_${k}`) }))}
      />
      {kind === "work" ? (
        <Field
          id="se-contract"
          label={t("project")}
          hint={project ? t("projectDates", { start: fmt.date(project.start), last: fmt.date(project.end), delivery: fmt.date(project.delivery) }) : undefined}
          error={errors.contract_id ? t("contractRequired") : undefined}
        >
          <NativeSelect
            value={contractId}
            onChange={(e) => {
              const p = data.projects.find((x) => x.id === e.target.value);
              setContractId(e.target.value);
              if (p && !initial.id) {
                setStart(p.start < today ? today : p.start);
                setEnd(addDays(p.start < today ? today : p.start, p.days - 1));
                setTeamId(pickTeam(p.service));
              }
            }}
          >
            <option value="">{t("pickProject")}</option>
            {data.projects
              .filter((p) => p.status !== "cancelled")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {ltr(p.number)} · {p.client} · {tp(`kind_${p.service}`)}
                </option>
              ))}
          </NativeSelect>
        </Field>
      ) : (
        <Field id="se-title" label={t("title")} optional={t("optional")}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t(`kind_${kind}`)} />
        </Field>
      )}
      <Field id="se-team" label={t("team")}>
        <NativeSelect value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          {teams.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="field-row grid items-start gap-4 sm:grid-cols-2">
        <Field id="se-start" label={t("from")}>
          <Input
            type="date"
            value={start}
            onChange={(e) => {
              const v = e.target.value;
              if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setEnd(addDays(v, length - 1)); // keep the length
              setStart(v);
            }}
          />
        </Field>
        <Field id="se-end" label={t("to")} hint={t("lengthDays", { n: length })} error={errors.end_date ? t("endBeforeStart") : undefined}>
          <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>

      {wrongService && (
        <p className="flex gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {t("wrongService", { team: team!.name, service: tp(`kind_${project!.service}`) })}
        </p>
      )}
      {clashes.length > 0 && (
        <div className="grid gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-[13px]">
          <p className="flex gap-2 font-bold">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {t("clash", { team: team?.name ?? "" })}
          </p>
          <ul className="grid gap-0.5 ps-6">
            {clashes.map((c) => {
              const p = c.contract_id ? projectOf.get(c.contract_id) : undefined;
              return (
                <li key={c.id}>
                  {p ? `${p.client} · ${ltr(p.number)}` : c.title || t(`kind_${c.kind ?? "other"}`)} — {fmt.dayMonth(c.start)} → {fmt.dayMonth(c.end)}
                </li>
              );
            })}
          </ul>
          {earliest && earliest !== start && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="justify-self-start"
              onClick={() => {
                setStart(earliest);
                setEnd(addDays(earliest, length - 1));
              }}
            >
              <Sparkles /> {t("useEarliest", { date: fmt.date(earliest) })}
            </Button>
          )}
          <p className="text-muted-foreground">{t("clashHint")}</p>
        </div>
      )}
      <Field id="se-notes" label={t("notes")} optional={t("optional")}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
    </FormDialog>
  );
}

// --- Teams -------------------------------------------------------------------------

function Teams({ data, onEdit }: { data: ScheduleData; onEdit?: (t: Partial<ScheduleTeam>) => void }) {
  const sep = useListSep();
  const t = useTranslations("schedule");
  const tp = useTranslations("pricing");
  const names = new Map(data.roster.map((r) => [r.id, r.full_name]));
  if (!data.teams.length)
    return (
      <EmptyState
        icon={<Users />}
        title={t("noTeamsTitle")}
        description={t("noTeamsBody")}
        action={
          onEdit && (
            <Button onClick={() => onEdit({ kind: "inhouse", services: [], color: COLORS[0], is_active: true, members: [] })}>
              <Plus /> {t("newTeam")}
            </Button>
          )
        }
      />
    );
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {data.teams.map((team) => (
        <li key={team.id} className={cn("grid content-start gap-3 rounded-3xl border border-border bg-surface p-5", !team.is_active && "opacity-60")}>
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-center gap-2 text-[16px] font-bold">
              <span className="size-3 rounded-full" style={{ background: team.color }} />
              {team.name}
            </p>
            {onEdit && (
              <Button size="icon-sm" variant="ghost" aria-label={t("editTeam")} onClick={() => onEdit(team)}>
                <Pencil />
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={team.kind === "inhouse" ? "primary" : "info"}>{t(`teamKind_${team.kind}`)}</Badge>
            {team.subcontractor_id && <Badge>{t("linkedSub")}</Badge>}
            {team.services.map((s) => (
              <Badge key={s}>{tp(`kind_${s}`)}</Badge>
            ))}
            {!team.is_active && <Badge tone="danger">{t("inactive")}</Badge>}
          </div>
          {team.kind === "inhouse" ? (
            <p className="text-[13px] text-muted-foreground">
              {team.members.length ? team.members.map((m) => names.get(m) ?? "—").join(sep) : t("noMembers")}
            </p>
          ) : (
            team.contact_phone && <p className="font-latin text-[13px] text-muted-foreground">0{team.contact_phone.slice(3)}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function TeamDialog({ data, initial, onClose, actions }: { data: ScheduleData; initial: Partial<ScheduleTeam>; onClose: () => void; actions?: ScheduleActions }) {
  const t = useTranslations("schedule");
  const tp = useTranslations("pricing");
  const router = useRouter();
  const { run, pending, fieldText } = useActionRunner();
  const [name, setName] = React.useState(initial.name ?? "");
  const [kind, setKind] = React.useState<ScheduleTeam["kind"]>(initial.kind ?? "inhouse");
  const [services, setServices] = React.useState<ServiceKind[]>(initial.services ?? []);
  const [color, setColor] = React.useState(initial.color ?? COLORS[0]);
  const [phone, setPhone] = React.useState(initial.contact_phone ? `0${initial.contact_phone.slice(3)}` : "");
  const [members, setMembers] = React.useState<string[]>(initial.members ?? []);
  const [active, setActive] = React.useState(initial.is_active ?? true);
  const [notes, setNotes] = React.useState(initial.notes ?? "");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <FormDialog
      open
      wide
      onOpenChange={(v) => !v && onClose()}
      title={initial.id ? t("editTeam") : t("newTeam")}
      pending={pending}
      onSubmit={() =>
        run(
          actions &&
            (() =>
              actions.saveTeam({
                ...(initial.id ? { id: initial.id } : {}),
                name,
                kind,
                services,
                color,
                contact_phone: kind === "external" ? phone : null,
                is_active: active,
                notes: notes.trim() || null,
                members: kind === "inhouse" ? members : [],
              })),
          {
            onFieldErrors: setErrors,
            onSuccess: () => {
              onClose();
              router.refresh();
            },
          },
        )
      }
    >
      <Field id="tm-name" label={t("teamName")} error={fieldText(errors.name)}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("teamNameHint")} autoFocus />
      </Field>
      <Segmented
        name={t("teamKind")}
        value={kind}
        onChange={setKind}
        options={[
          { value: "inhouse", label: t("teamKind_inhouse") },
          { value: "external", label: t("teamKind_external") },
        ]}
      />
      <div className="grid gap-2">
        <p className="text-[13px] font-bold">{t("services")}</p>
        <div className="flex flex-wrap gap-2">
          {SERVICES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={services.includes(s)}
              onClick={() => setServices(toggle(services, s))}
              className={cn("h-10 rounded-full px-4 text-[14px] ring-1", services.includes(s) ? "bg-primary text-primary-foreground ring-primary" : "bg-surface ring-border")}
            >
              {tp(`kind_${s}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <p className="text-[13px] font-bold">{t("color")}</p>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={cn("size-9 rounded-full ring-offset-2 ring-offset-surface", color === c && "ring-2 ring-foreground")}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      {kind === "inhouse" ? (
        <div className="grid gap-2">
          <p className="text-[13px] font-bold">{t("members")}</p>
          {data.roster.length ? (
            <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-2xl bg-surface-sunken/60 p-2 sm:grid-cols-2">
              {data.roster.map((r) => (
                <li key={r.id}>
                  <label className="flex min-h-11 items-center gap-3 rounded-xl px-2 text-[14px] hover:bg-surface">
                    <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={members.includes(r.id)} onChange={() => setMembers(toggle(members, r.id))} />
                    <span>
                      {r.full_name}
                      {r.job_title && <span className="text-muted-foreground"> · {r.job_title}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">{t("noRoster")}</p>
          )}
        </div>
      ) : (
        <Field id="tm-phone" label={t("contactPhone")} optional={t("optional")} error={errors.contact_phone ? t("phoneInvalid") : undefined}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" placeholder="05xxxxxxxx" className="font-latin rtl:text-right" />
        </Field>
      )}
      <label className="flex items-center justify-between gap-3 text-[14px]">
        <span>{t("active")}</span>
        <Switch checked={active} onCheckedChange={setActive} />
      </label>
      <Field id="tm-notes" label={t("notes")} optional={t("optional")}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
    </FormDialog>
  );
}
