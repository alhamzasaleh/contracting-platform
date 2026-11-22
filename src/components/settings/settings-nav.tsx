"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { SETTINGS_NAV } from "@/components/shell/nav";
import type { Permission } from "@/lib/auth/permissions";

export function SettingsNav({ permissions, basePath = "" }: { permissions: Permission[]; basePath?: string }) {
  const t = useTranslations("settings");
  const pathname = usePathname();
  const rel = basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;
  const items = SETTINGS_NAV.filter((i) => !i.permission || permissions.includes(i.permission));
  return (
    <nav
      className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0 lg:sticky lg:top-24 lg:flex-col lg:gap-0.5 lg:self-start lg:border-0"
      aria-label={t("title")}
    >
      {items.map((i) => {
        const active = rel === i.href;
        return (
          <Link
            key={i.key}
            href={`${basePath}${i.href}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-11 shrink-0 items-center gap-2.5 px-3 text-[14px] font-medium whitespace-nowrap transition-colors lg:h-9 lg:rounded-lg",
              active
                ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary lg:bg-surface lg:shadow-sm lg:ring-1 lg:ring-border lg:after:hidden"
                : "text-muted-foreground hover:text-foreground lg:hover:bg-surface-2/70",
            )}
          >
            <i.icon className={cn("hidden size-4 lg:block", active ? "text-primary" : "text-subtle-foreground")} strokeWidth={1.75} />
            {t(i.key)}
          </Link>
        );
      })}
    </nav>
  );
}

export function SettingsFrame({
  permissions,
  basePath,
  title,
  description,
  children,
}: {
  permissions: Permission[];
  basePath?: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        <p className="mt-1.5 text-[15px] text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
        <SettingsNav permissions={permissions} basePath={basePath} />
        <div className="min-w-0 animate-fade-up">{children}</div>
      </div>
    </div>
  );
}
