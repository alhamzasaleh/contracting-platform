"use client";
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
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
      <FormatterProvider locale={locale} numerals={numerals}>
        <TooltipProvider delayDuration={250}>
          {children}
          <Toaster
            position={locale === "ar" ? "bottom-left" : "bottom-right"}
            dir={locale === "ar" ? "rtl" : "ltr"}
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
