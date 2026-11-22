"use client";
import { CheckCircle2, Info } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import * as React from "react";
import { NumberInput, str, useActionRunner } from "@/components/forms/form-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import type { ActionResult } from "@/lib/actions";
import type { PricingSettingsRow } from "@/lib/supabase/database.types";

const FIELDS = [
  ["overhead_percent", "overhead", "overheadHint", "%"],
  ["min_margin_percent", "minMargin", "minMarginHint", "%"],
  ["default_margin_percent", "defaultMargin", null, "%"],
  ["vat_percent", "vat", null, "%"],
  ["default_waste_percent", "defaultWaste", null, "%"],
  ["default_warranty_months", "warranty", null, null],
  ["purchase_approval_limit", "purchaseLimit", "purchaseLimitHint", "sar"],
  ["working_days_per_month", "workingDays", "workingDaysHint", null],
  ["first_payment_material_cover_percent", "firstPayment", "firstPaymentHint", "%"],
] as const;

export function PricingSettingsView({
  settings,
  vatRegistered,
  canManage,
  onSave,
  basePath = "",
}: {
  settings: PricingSettingsRow;
  vatRegistered: boolean;
  canManage: boolean;
  onSave?: (i: Record<string, unknown>) => Promise<ActionResult>;
  basePath?: string;
}) {
  const t = useTranslations();
  const { run, pending, fieldText } = useActionRunner();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);

  return (
    <form
      noValidate
      onChange={() => setDirty(true)}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        run(onSave && (() => onSave(Object.fromEntries(FIELDS.map(([k]) => [k, str(fd, k)])))), {
          onFieldErrors: setErrors,
          onSuccess: () => setDirty(false),
        });
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t("catalogue.settingsTitle")}</CardTitle>
          <CardDescription>{t("catalogue.settingsHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div
            className={`flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-[14px] ${vatRegistered ? "bg-success-soft text-success" : "bg-warning-soft"}`}
          >
            {vatRegistered ? <CheckCircle2 className="size-4 shrink-0" /> : <Info className="size-4 shrink-0 text-warning" />}
            <span className="flex-1">{vatRegistered ? t("catalogue.vatActive") : t("catalogue.vatInactive")}</span>
            {!vatRegistered && canManage && (
              <Button asChild size="sm" variant="secondary">
                <Link href={`${basePath}/settings`}>{t("catalogue.addVatNumber")}</Link>
              </Button>
            )}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {FIELDS.map(([key, label, hint, suffix]) => (
              <Field key={key} id={`ps-${key}`} label={t(`catalogue.${label}`)} hint={hint ? t(`catalogue.${hint}`) : undefined} error={fieldText(errors[key])}>
                <NumberInput
                  name={key}
                  defaultValue={settings[key] ?? ""}
                  disabled={!canManage}
                  suffix={suffix === "sar" ? t("dashboard.sar") : suffix ?? undefined}
                />
              </Field>
            ))}
          </div>
        </CardContent>
        {canManage && (
          <CardFooter>
            <Button type="submit" loading={pending} disabled={!dirty}>
              {t("common.save")}
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  );
}
