import { getTranslations } from "next-intl/server";
import { OfflineRetry } from "@/components/shell/offline-retry";

export const dynamic = "force-static";

/** Shown by the service worker when there is no connection. */
export default async function OfflinePage() {
  const t = await getTranslations("offline");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="grid max-w-sm gap-3 text-center">
        <p className="text-[22px] font-bold">{t("title")}</p>
        <p className="text-[14px] text-muted-foreground">{t("body")}</p>
        <OfflineRetry label={t("retry")} />
      </div>
    </main>
  );
}
