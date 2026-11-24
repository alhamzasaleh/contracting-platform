"use client";
import { CheckCircle2, Landmark, Sparkles, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { FormDialog, NumberInput, bool, str, useActionRunner } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import type { ActionResult } from "@/lib/actions";
import type { EmployeeCostItemRow } from "@/lib/supabase/database.types";
import { SwitchField } from "@/components/catalogue/services-view";

export type CostItemRow = Pick<EmployeeCostItemRow, "id" | "code" | "name_ar" | "applies_to" | "basis" | "value" | "amortize_months" | "is_active" | "is_provision" | "last_reviewed_at">;

export function CostItemsView({
  items,
  canManage,
  actions,
}: {
  items: CostItemRow[];
  canManage: boolean;
  actions?: { seed: () => Promise<ActionResult>; save: (i: Record<string, unknown>) => Promise<ActionResult> };
}) {
  const t = useTranslations("hr");
  const tc = useTranslations("dashboard");
  const { fmt } = useFormatter();
  const { run, pending, fieldText } = useActionRunner();
  const [editing, setEditing] = React.useState<CostItemRow | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const applies = { all: t("appliesAll"), saudi: t("appliesSaudi"), non_saudi: t("appliesNonSaudi") };
  const basisLabel = { percent: t("basisPercent"), monthly: t("basisMonthly"), annual: t("basisAnnual"), one_time: t("basisOneTime") };
  const display = (i: CostItemRow) =>
    i.basis === "percent" ? `${fmt.number(i.value, 2)}%` : fmt.money(i.value);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Landmark />}
        title={t("costsTitle")}
        description={t("emptyCostsBody")}
        action={
          canManage && (
            <Button onClick={() => run(actions?.seed)} loading={pending}>
              <Sparkles /> {t("seedCosts")}
            </Button>
          )
        }
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("costsTitle")}</CardTitle>
        <CardDescription>{t("costsHint")}</CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        <ul className="divide-y divide-border">
          {items.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => {
                  setErrors({});
                  setEditing(i);
                }}
                className={`flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5 text-start transition-colors enabled:hover:bg-surface-2/60 sm:px-6 ${i.is_active ? "" : "opacity-50"}`}
              >
                <div className="min-w-0 flex-1 basis-60">
                  <p className="text-[15px] font-bold">{i.name_ar}</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
                    <Badge tone={i.applies_to === "all" ? "primary" : "neutral"}>{applies[i.applies_to]}</Badge>
                    <span>{basisLabel[i.basis]}</span>
                    {i.basis === "one_time" && i.amortize_months && <span className="num">· {fmt.number(i.amortize_months)} {t("months")}</span>}
                    {i.is_provision && <Badge tone="neutral">{t("provision")}</Badge>}
                  </p>
                </div>
                <div className="text-end">
                  <p className="num text-[16px] font-extrabold">{i.value > 0 ? display(i) : "—"}</p>
                  {i.value > 0 && i.last_reviewed_at ? (
                    <p className="num flex items-center justify-end gap-1 text-xs text-success">
                      <CheckCircle2 className="size-3" /> {fmt.date(i.last_reviewed_at)}
                    </p>
                  ) : (
                    <p className="flex items-center justify-end gap-1 text-xs text-warning">
                      <TriangleAlert className="size-3" /> {t("needsReview")}
                    </p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </CardContent>

      {editing && (
        <FormDialog
          open
          onOpenChange={(v) => !v && setEditing(null)}
          title={editing.name_ar}
          description={`${applies[editing.applies_to]} · ${basisLabel[editing.basis]}`}
          pending={pending}
          onSubmit={(fd) =>
            run(
              actions &&
                (() =>
                  actions.save({
                    id: editing.id,
                    value: str(fd, "value"),
                    amortize_months: editing.basis === "one_time" ? str(fd, "amortize_months") : "",
                    is_active: bool(fd, "is_active"),
                    is_provision: bool(fd, "is_provision"),
                    mark_reviewed: true,
                  })),
              { onFieldErrors: setErrors, onSuccess: () => setEditing(null) },
            )
          }
        >
          <Field id="ci-value" label={t("value")} error={fieldText(errors.value)}>
            <NumberInput name="value" defaultValue={editing.value || ""} suffix={editing.basis === "percent" ? "%" : tc("sar")} autoFocus />
          </Field>
          {editing.basis === "one_time" && (
            <Field id="ci-amort" label={t("amortize")} error={fieldText(errors.amortize_months)}>
              <NumberInput name="amortize_months" defaultValue={editing.amortize_months ?? 24} inputMode="numeric" />
            </Field>
          )}
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
            <span className="text-[14px]">{t("statusActive")}</span>
            <SwitchField name="is_active" defaultChecked={editing.is_active} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[14px]">{t("provision")}</span>
              <span className="block text-[12px] text-muted-foreground">{t("provisionHint")}</span>
            </span>
            <SwitchField name="is_provision" defaultChecked={editing.is_provision} />
          </label>
          <p className="text-[13px] text-muted-foreground">{t("costsHint")}</p>
        </FormDialog>
      )}
    </Card>
  );
}
