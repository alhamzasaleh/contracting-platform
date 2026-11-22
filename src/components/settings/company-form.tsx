"use client";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import type { CompanyInput } from "@/lib/validation/company";

export type CompanyValues = {
  name: string;
  legal_name: string | null;
  cr_number: string | null;
  vat_number: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
};

export function CompanyForm({
  values,
  canEdit,
  onSave,
}: {
  values: CompanyValues;
  canEdit: boolean;
  onSave?: (input: CompanyInput) => Promise<ActionResult>;
}) {
  const t = useTranslations();
  const [pending, startTransition] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);

  const msg = (key?: string) => {
    if (!key) return undefined;
    if (key === "required") return t("common.required");
    if (key === "phoneInvalid") return t("auth.phoneInvalid");
    return t(`settings.${key}` as "settings.crInvalid");
  };

  const submit = (fd: FormData) => {
    if (!onSave) {
      toast(t("preview.banner"));
      return;
    }
    const input = Object.fromEntries(
      ["name", "legal_name", "cr_number", "vat_number", "phone", "email", "city", "address"].map((k) => [k, String(fd.get(k) ?? "")]),
    ) as CompanyInput;
    startTransition(async () => {
      const r = await onSave(input);
      if (r.ok) {
        setErrors({});
        setDirty(false);
        toast.success(t("common.saved"));
      } else {
        setErrors(r.fieldErrors ?? {});
        if (!r.fieldErrors) toast.error(r.error === "noAccess" ? t("common.noAccess") : t("common.error"));
      }
    });
  };

  const field = (name: keyof CompanyValues, opts: { ltr?: boolean; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; optional?: boolean; autoComplete?: string; hint?: string } = {}) => (
    <Field id={`company-${name}`} label={t(`settings.${name === "legal_name" ? "legalName" : name === "cr_number" ? "crNumber" : name === "vat_number" ? "vatNumber" : name}`)} error={msg(errors[name])} hint={opts.hint} optional={opts.optional ? t("common.optional") : undefined}>
      <Input
        name={name}
        defaultValue={values[name] ?? ""}
        disabled={!canEdit}
        dir={opts.ltr ? "ltr" : undefined}
        inputMode={opts.inputMode}
        autoComplete={opts.autoComplete ?? "off"}
        className={opts.ltr ? "font-latin rtl:text-right" : undefined}
      />
    </Field>
  );

  return (
    <form action={submit} onChange={() => setDirty(true)} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.companyTitle")}</CardTitle>
          <CardDescription>{t("settings.companyHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          {field("name", { autoComplete: "organization" })}
          {field("legal_name", { optional: true })}
          {field("cr_number", { ltr: true, inputMode: "numeric" })}
          {field("vat_number", { ltr: true, inputMode: "numeric", optional: true, hint: t("settings.vatHint") })}
          {field("phone", { ltr: true, inputMode: "tel", optional: true })}
          {field("email", { ltr: true, inputMode: "email", optional: true })}
          {field("city", { optional: true })}
          <Field id="company-address" label={t("settings.address")} optional={t("common.optional")} className="sm:col-span-2" error={msg(errors.address)}>
            <Textarea name="address" defaultValue={values.address ?? ""} disabled={!canEdit} rows={2} />
          </Field>
        </CardContent>
        {canEdit && (
          <CardFooter>
            <Button type="submit" loading={pending} disabled={!dirty}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  );
}
