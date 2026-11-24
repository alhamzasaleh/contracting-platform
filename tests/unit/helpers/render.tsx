import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import type * as React from "react";
import ar from "../../../messages/ar.json";
import { FormatterProvider } from "@/components/formatter-provider";

/**
 * Renders a page view to HTML with the app's providers (Arabic, Western digits), so tests can
 * check which links a view shows. Tests that render a view using `useRouter` mock
 * `next/navigation` themselves (vi.mock is hoisted per test file).
 */
export function render(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="ar" messages={ar} timeZone="Asia/Riyadh">
      <FormatterProvider locale="ar" numerals="latn">
        {node}
      </FormatterProvider>
    </NextIntlClientProvider>,
  );
}

/** Every href in the HTML. */
export const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
