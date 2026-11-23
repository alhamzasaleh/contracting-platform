import { useTranslations } from "next-intl";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";
import { OfflineSync } from "./offline-sync";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import type { ShellData } from "./types";

export function AppShell({ data, banner, children }: { data: ShellData; banner?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar data={data} />
      <div className="flex min-w-0 flex-1 flex-col">
        {banner}
        {!data.basePath && <OfflineSync />}
        <Topbar data={data} />
        <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 pt-6 pb-[calc(env(safe-area-inset-bottom)+6rem)] sm:px-6 lg:px-10 lg:pt-7">
          {children}
          <Rights name={data.org.name} />
        </main>
        {data.assistant && <AssistantLauncher ready={data.assistant.ready} preview={!!data.basePath} />}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-extrabold text-balance sm:text-[36px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground text-pretty">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

function Rights({ name }: { name: string }) {
  const t = useTranslations("common");
  return <p className="mt-12 text-center text-[12px] text-subtle-foreground">{t("rights", { year: new Date().getFullYear(), name })}</p>;
}
