"use client";
import { useTranslations } from "next-intl";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FormatterProvider } from "@/components/formatter-provider";
import type { Locale, Numerals } from "@/i18n/config";

export function Providers({
  children,
  nonce,
  locale,
  numerals,
}: {
  children: React.ReactNode;
  nonce?: string;
  locale: Locale;
  numerals: Numerals;
}) {
  const t = useTranslations("notify");
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
      <FormatterProvider locale={locale} numerals={numerals}>
        <TooltipProvider delayDuration={250}>
          {children}
          <Toaster
            position={locale === "ar" ? "bottom-left" : "bottom-right"}
            dir={locale === "ar" ? "rtl" : "ltr"}
            // the toast region is announced by screen readers: name it in the reader's language
            containerAriaLabel={t("title")}
            toastOptions={{
              classNames: {
                toast: "!rounded-xl !border-border !bg-surface !text-foreground !shadow-lg !font-[inherit]",
                description: "!text-muted-foreground",
              },
            }}
          />
        </TooltipProvider>
      </FormatterProvider>
    </ThemeProvider>
  );
}
