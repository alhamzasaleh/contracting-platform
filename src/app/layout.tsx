import "@fontsource/ibm-plex-sans-arabic/300.css";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "@fontsource-variable/inter/index.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { Providers } from "@/components/providers";
import { dirOf } from "@/i18n/config";
import { getLocaleSettings } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: { default: t("name"), template: `%s · ${t("name")}` },
    description: t("tagline"),
    applicationName: t("name"),
    robots: { index: false, follow: false },
    appleWebApp: { capable: true, statusBarStyle: "default", title: t("name") },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfa" },
    { media: "(prefers-color-scheme: dark)", color: "#141418" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [{ locale, numerals }, messages, h] = await Promise.all([getLocaleSettings(), getMessages(), headers()]);
  const nonce = h.get("x-nonce") ?? undefined;

  return (
    <html lang={locale} dir={dirOf(locale)} suppressHydrationWarning className="h-full">
      <body className="min-h-full">
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Riyadh">
          <Providers nonce={nonce} locale={locale} numerals={numerals}>
            {children}
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
