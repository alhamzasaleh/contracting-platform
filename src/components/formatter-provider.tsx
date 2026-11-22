"use client";
import { createContext, useContext, useMemo } from "react";
import { createFormatter, type Formatter } from "@/lib/format";
import type { Locale, Numerals } from "@/i18n/config";

const Ctx = createContext<{ fmt: Formatter; locale: Locale; numerals: Numerals } | null>(null);

export function FormatterProvider({
  locale,
  numerals,
  children,
}: {
  locale: Locale;
  numerals: Numerals;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ fmt: createFormatter(locale, numerals), locale, numerals }), [locale, numerals]);
  return <Ctx value={value}>{children}</Ctx>;
}

export function useFormatter() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFormatter must be used inside FormatterProvider");
  return v;
}
