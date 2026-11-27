"use client";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { errorHomeHref, retryOf } from "@/lib/error-page";

/**
 * A failure in a layout (e.g. the app shell, the floating assistant) or in a page outside the app
 * group (client page, partner page, print, sign-in): said plainly in the user's language instead
 * of Next's English page. Details stay in the server logs.
 */
export default function RootError(props: { error: unknown; retry?: () => void; unstable_retry?: () => void; reset?: () => void }) {
  const t = useTranslations("errorPage");
  const home = errorHomeHref(usePathname());
  return (
    <div className="mx-auto grid min-h-dvh max-w-md content-center justify-items-center gap-3 px-4 text-center">
      <p className="text-[22px] font-bold">{t("title")}</p>
      <p className="text-[14px] text-muted-foreground">{t("body")}</p>
      <div className="flex gap-2">
        <Button onClick={retryOf(props)}>
          <RefreshCw /> {t("retry")}
        </Button>
        {home && (
          <Button variant="secondary" asChild>
            <Link href={home}>{t("home")}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
