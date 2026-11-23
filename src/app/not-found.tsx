import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("errorPage");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="grid max-w-sm justify-items-center gap-3 text-center">
        <p className="font-latin text-[40px] font-extrabold text-primary">404</p>
        <p className="text-[20px] font-bold">{t("notFound")}</p>
        <p className="text-[14px] text-muted-foreground">{t("notFoundBody")}</p>
        <Button asChild>
          <Link href="/">{t("home")}</Link>
        </Button>
      </div>
    </main>
  );
}
