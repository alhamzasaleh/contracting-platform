"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { NAV, isActive, type NavItem } from "./nav";
import { BrandLogo } from "@/components/brand-logo";
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
              <p className="px-3 pb-1.5 text-[11px] font-bold tracking-wide text-ink-muted">
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
                      className="absolute inset-0 rounded-xl bg-ink-2"
                      transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                    />
                  )}
                  <Icon
                    className={cn(
                      "relative size-[18px] shrink-0 transition-colors",
                      active ? "text-[var(--brand-dark)]" : "text-ink-muted group-hover:text-ink-foreground",
                    )}
                    strokeWidth={1.75}
                  />
                  <span className="relative flex-1 truncate">{t(`nav.${item.key}`)}</span>
                  {soon && (
                    <span className="relative rounded-full bg-ink-3 px-2 py-0.5 text-[10px] text-ink-muted">{t("common.soon")}</span>
                  )}
                </>
              );
              const cls = cn(
                "group relative flex h-11 items-center gap-3 rounded-xl px-3 text-[14px] transition-colors lg:h-10",
                active ? "font-bold text-gypsum" : "text-ink-foreground/80 hover:bg-ink-2/60 hover:text-gypsum",
                soon && "cursor-default opacity-55 hover:bg-transparent hover:text-ink-foreground/80",
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
    <aside className="sticky top-0 hidden h-dvh w-[256px] shrink-0 flex-col bg-ink text-ink-foreground lg:flex">
      <SidebarBrand data={data} />
      <div className="scrollbar-none flex-1 overflow-y-auto px-3 pt-4 pb-4">
        <SidebarNav data={data} />
      </div>
      <SidebarUser data={data} roleLabel={t(data.role)} />
    </aside>
  );
}

export function SidebarBrand({ data }: { data: ShellData }) {
  return (
    // The logo already carries the name (§6.1): shown alone, gypsum on basalt, no frame.
    <div className="flex min-h-20 items-center px-6 py-4 text-gypsum">
      {data.org.logoUrl ? (
        <BrandLogo src={data.org.logoUrl} label={data.org.name} className="w-[120px]" />
      ) : (
        <p className="min-w-0 truncate text-[17px] leading-tight font-extrabold">{data.org.name}</p>
      )}
    </div>
  );
}

function SidebarUser({ data, roleLabel }: { data: ShellData; roleLabel: string }) {
  return (
    <div className="m-3 flex items-center gap-3 rounded-2xl bg-ink-2 p-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-dark)] text-[13px] font-bold text-ink">
        {(data.user.name ?? "؟").trim().charAt(0)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-bold text-gypsum">{data.user.name ?? "—"}</p>
        <p className="truncate text-[11px] text-ink-muted">{roleLabel}</p>
      </div>
    </div>
  );
}
