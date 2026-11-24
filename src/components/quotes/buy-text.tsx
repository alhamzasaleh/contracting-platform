"use client";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { useUnitText } from "@/components/forms/form-kit";
import type { BuyPart } from "@/lib/quotes/materials";

/** 18 → "18", 3.6 → "3.6", 0.333 → "0.33" */
export function useQtyNumber() {
  const { fmt } = useFormatter();
  return React.useCallback((x: number) => fmt.number(x, Number.isInteger(x) ? 0 : Number.isInteger(x * 10) ? 1 : 2), [fmt]);
}

/** «2 عبوة × 18 لتر + 1 عبوة × 4 لتر» — what to buy, with units, in the reader's language. */
export function useBuyText() {
  const t = useTranslations("engine");
  const unitText = useUnitText();
  const qn = useQtyNumber();
  return React.useCallback(
    (parts: BuyPart[]) =>
      parts
        .map((p) =>
          p.size != null
            ? t("buyPart", { count: qn(p.count), unit: unitText(p.unit), size: qn(p.size), sizeUnit: unitText(p.sizeUnit) })
            : t("buyCount", { count: qn(p.count), unit: unitText(p.unit) }),
        )
        .join(" + "),
    [t, unitText, qn],
  );
}
