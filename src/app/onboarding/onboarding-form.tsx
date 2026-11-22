"use client";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createOrganization } from "./actions";

export function OnboardingForm({ defaultName }: { defaultName?: string | null }) {
  const t = useTranslations();
  const [pending, startTransition] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const submit = (fd: FormData) => {
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const r = await createOrganization({
        companyName: String(fd.get("companyName") ?? ""),
        fullName: String(fd.get("fullName") ?? ""),
      });
      if (r && !r.ok) {
        setErrors(r.fieldErrors ?? {});
        if (!r.fieldErrors) setFormError(r.error === "closed" ? t("onboarding.closedBody") : t("common.error"));
      }
    });
  };

  return (
    <form action={submit} className="flex flex-col gap-5" noValidate>
      <div>
        <h1 className="text-[28px] font-extrabold">{t("onboarding.title")}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">{t("onboarding.subtitle")}</p>
      </div>
      <Field id="fullName" label={t("onboarding.yourName")} error={errors.fullName ? t("common.required") : undefined}>
        <Input name="fullName" defaultValue={defaultName ?? ""} autoComplete="name" className="h-12" required />
      </Field>
      <Field id="companyName" label={t("onboarding.companyName")} error={errors.companyName ? t("common.required") : undefined}>
        <Input name="companyName" placeholder={t("onboarding.companyNamePlaceholder")} autoComplete="organization" className="h-12" required />
      </Field>
      {formError && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {formError}
        </p>
      )}
      <Button type="submit" size="xl" loading={pending}>
        {t("onboarding.create")}
        {!pending && <ArrowLeft className="ltr:rotate-180" />}
      </Button>
    </form>
  );
}
