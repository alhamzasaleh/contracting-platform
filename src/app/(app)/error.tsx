"use client";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/** Something failed while loading a page: say so plainly and offer a retry (details stay in the server logs). */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errorPage");
  return (
    <div className="mx-auto grid max-w-md justify-items-center gap-3 py-16 text-center">
      <p className="text-[22px] font-bold">{t("title")}</p>
      <p className="text-[14px] text-muted-foreground">{t("body")}</p>
      <div className="flex gap-2">
        <Button onClick={reset}>
          <RefreshCw /> {t("retry")}
        </Button>
        <Button variant="secondary" asChild>
          <Link href="/">{t("home")}</Link>
        </Button>
      </div>
    </div>
  );
}
