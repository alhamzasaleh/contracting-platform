"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type SectionTab = { href: string; label: string; exact?: boolean };

/** Horizontal page-section tabs (scrolls on small screens). */
export function SectionTabs({ tabs, basePath = "" }: { tabs: SectionTab[]; basePath?: string }) {
  const pathname = usePathname();
  const rel = basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) || "/" : pathname;
  return (
    <nav className="scrollbar-none -mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0">
      {tabs.map((t) => {
        const active = t.exact ? rel === t.href : rel === t.href || rel.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={`${basePath}${t.href}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-11 shrink-0 items-center px-3 text-[14px] whitespace-nowrap transition-colors",
              active
                ? "font-bold text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
