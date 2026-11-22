import { ArrowLeft, Database } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { isDesignPreviewEnabled, isSupabaseConfigured } from "@/env";

export default async function SetupPage() {
  if (isSupabaseConfigured()) redirect("/");
  const t = await getTranslations("setup");
  return (
    <AuthLayout>
      <div className="flex flex-col gap-5">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Database className="size-6" />
        </span>
        <h1 className="text-[26px] leading-snug font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-[15px] text-muted-foreground">{t("body")}</p>
        <ol className="grid gap-3">
          {(["step1", "step2", "step3"] as const).map((s, i) => (
            <li key={s} className="flex items-start gap-3 text-[14px]">
              <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold ring-1 ring-border">
                {i + 1}
              </span>
              {t(s)}
            </li>
          ))}
        </ol>
        {isDesignPreviewEnabled() && (
          <Button asChild variant="secondary" size="lg" className="mt-2">
            <Link href="/dev/preview">
              {t("preview")} <ArrowLeft className="ltr:rotate-180" />
            </Link>
          </Button>
        )}
      </div>
    </AuthLayout>
  );
}
