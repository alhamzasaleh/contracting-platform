"use client";

import { useTranslations } from "next-intl";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { idDigits, idNumberComplete, idNumberValid } from "@/lib/validation/national-id";

/** The client's ID number, asked on his page only when his record has none (owner, Nov 2026). */
export function idNumberReady(value: string): boolean {
  return idNumberComplete(value);
}

export function IdNumberField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const t = useTranslations("portal");
  const d = String(idDigits(value));
  // more than 10 digits can't be right; a failed check digit is only a warning (a commercial
  // registration has none)
  const wrong = d.length > 10;
  const check = d.length === 10 && !idNumberValid(d);
  return (
    <Field id={id} label={t("idNumber")} hint={check ? t("idNumberCheck") : t("idNumberHint")} error={wrong ? t("errIdInvalid") : undefined}>
      <Input value={value} onChange={(e) => onChange(e.target.value)} inputMode="numeric" dir="ltr" maxLength={14} autoComplete="off" className="font-latin rtl:text-right" />
    </Field>
  );
}
