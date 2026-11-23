"use client";
import { Gauge } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { useActionRunner } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { ActionResult } from "@/lib/actions";
import { MIN_PROJECTS } from "@/lib/calibration";
import type { CalibrationData } from "@/lib/data/calibration";
import { cn, ltr } from "@/lib/utils";

/** A.8: planned vs actual material per product across handed-over projects; suggestions need the owner's approval. */
export function CalibrationView({ data, apply }: { data: CalibrationData; apply?: (i: Record<string, unknown>) => Promise<ActionResult> }) {
  const t = useTranslations("engine");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const [done, setDone] = React.useState<Set<string>>(new Set());
  const pct = (v: number) => `${v > 0 ? "+" : ""}${fmt.number(v * 100, 0)}%`;

  if (data.rows.length === 0)
    return <EmptyState icon={<Gauge />} title={t("calEmptyTitle")} description={t("calEmptyBody", { n: MIN_PROJECTS, projects: data.projects })} />;

  return (
    <div className="grid gap-4">
      <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[13px] text-muted-foreground">{t("calIntro", { projects: data.projects, n: MIN_PROJECTS })}</p>
      <ul className="grid gap-3">
        {data.rows.map((r) => (
          <li key={r.productId} className={cn("grid gap-3 rounded-2xl border bg-surface p-4", r.consistent ? "border-warning/60" : "border-border")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">{r.label}</p>
              <span className="flex flex-wrap items-center gap-2 text-[13px]">
                <Badge>{t("calProjects", { n: r.projects.length })}</Badge>
                {r.variance != null && (
                  <Badge tone={r.consistent ? "warning" : "neutral"}>
                    {r.variance > 0 ? t("calMore", { pct: pct(r.variance) }) : t("calLess", { pct: pct(r.variance) })}
                  </Badge>
                )}
              </span>
            </div>
            <details className="text-[13px]">
              <summary className="cursor-pointer text-muted-foreground">{t("calDetails")}</summary>
              <ul className="mt-2 grid gap-1">
                {r.projects.map((p) => (
                  <li key={p.contract} className="flex flex-wrap justify-between gap-2">
                    <span className="font-latin">{ltr(p.contract)}</span>
                    <span className="tabular-nums">{t("calPlannedActual", { planned: fmt.number(p.planned, 1), actual: fmt.number(p.actual, 1), pct: pct(p.variance) })}</span>
                  </li>
                ))}
              </ul>
            </details>
            {r.consistent && r.group?.suggested != null ? (
              done.has(r.group.id) ? (
                <p className="text-[13px] font-semibold text-success">{t("calApplied")}</p>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-warning-soft px-3 py-2 text-[13px]">
                  <span>{t("calSuggest", { line: r.group.name, from: fmt.number(r.group.coverage, 2), to: fmt.number(r.group.suggested, 2) })}</span>
                  {data.canApply && (
                    <Button
                      size="sm"
                      loading={pending}
                      onClick={() =>
                        run(apply && (() => apply({ group_id: r.group!.id, coverage_per_unit: r.group!.suggested })), {
                          onSuccess: () => setDone((s) => new Set(s).add(r.group!.id)),
                        })
                      }
                    >
                      {t("calApprove")}
                    </Button>
                  )}
                </div>
              )
            ) : r.consistent ? (
              <p className="rounded-xl bg-warning-soft px-3 py-2 text-[13px]">{t("calReviewRate")}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
