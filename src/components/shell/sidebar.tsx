"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { NAV, isActive, type NavItem } from "./nav";
import { OrgMark } from "./org-mark";
import type { ShellData } from "./types";

export function SidebarNav({ data, onNavigate }: { data: ShellData; onNavigate?: () => void }) {
  const t = useTranslations();
  const pathname = usePathname();
  const base = data.basePath ?? "";
  const rel = base && pathname.startsWith(base) ? pathname.slice(base.length) || "/" : pathname;

  const visible = (item: NavItem) => !item.permission || data.permissions.includes(item.permission);

  return (
    <nav className="flex flex-col gap-6" aria-label={t("nav.menu")}>
      {NAV.map((group, gi) => {
        const items = group.items.filter(visible);
        if (items.length === 0) return null;
        return (
          <div key={group.key ?? gi} className="flex flex-col gap-0.5">
            {group.key && (
              <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wide text-subtle-foreground uppercase">
                {t(`nav.${group.key}`)}
              </p>
            )}
            {items.map((item) => {
              const active = isActive(rel, item.href);
              const soon = Boolean(item.phase);
              const Icon = item.icon;
              const content = (
                <>
                  {active && (
                    <motion.span
                      layoutId="sidebar-active"
                      className="absolute inset-0 rounded-lg bg-surface shadow-sm ring-1 ring-border"
                      transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                    />
                  )}
                  <Icon
                    className={cn(
                      "relative size-[18px] shrink-0 transition-colors",
                      active ? "text-primary" : "text-subtle-foreground group-hover:text-muted-foreground",
                    )}
                    strokeWidth={1.75}
                  />
                  <span className="relative flex-1 truncate">{t(`nav.${item.key}`)}</span>
                  {soon && (
                    <Badge className="relative px-1.5 py-0 text-[10px] font-normal">{t("common.soon")}</Badge>
                  )}
                </>
              );
              const cls = cn(
                "group relative flex h-10 items-center gap-3 rounded-lg px-3 text-[14px] font-medium transition-colors lg:h-9",
                active ? "text-foreground" : "text-muted-foreground hover:bg-surface-2/70 hover:text-foreground",
                soon && "cursor-default opacity-60 hover:bg-transparent hover:text-muted-foreground",
              );
              return soon ? (
                <span key={item.key} className={cls} aria-disabled>
                  {content}
                </span>
              ) : (
                <Link
                  key={item.key}
                  href={`${base}${item.href === "/" && base ? "" : item.href}`}
                  className={cls}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                >
                  {content}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar({ data }: { data: ShellData }) {
  const t = useTranslations("roles");
  return (
    <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col border-e border-border bg-surface-sunken/60 lg:flex">
      <div className="flex h-16 items-center gap-3 px-5">
        <OrgMark name={data.org.name} logoUrl={data.org.logoUrl} />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold leading-tight">{data.org.name}</p>
          <p className="truncate text-xs text-muted-foreground">{t(data.role)}</p>
        </div>
      </div>
      <div className="scrollbar-none flex-1 overflow-y-auto px-3 pt-3 pb-6">
        <SidebarNav data={data} />
      </div>
    </aside>
  );
}
