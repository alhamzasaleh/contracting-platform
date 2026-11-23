"use client";
import { Command } from "cmdk";
import { CornerDownLeft, Languages, Moon, Search, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { updatePreferences } from "@/app/actions/preferences";
import { NAV } from "./nav";
import type { ShellData } from "./types";

export function CommandMenu({ data, open, onOpenChange }: { data: ShellData; open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const { resolvedTheme, setTheme } = useTheme();
  const base = data.basePath ?? "";

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const items = NAV.flatMap((g) => g.items).filter(
    (i) => !i.phase && (!i.permission || data.permissions.includes(i.permission)),
  );

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-basalt/35 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_0.15s_ease-out]" />
        <D.Content
          className="fixed start-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-lg ltr:-translate-x-1/2 rtl:translate-x-1/2 data-[state=open]:animate-[dialog-in_0.2s_var(--ease-out-expo)]"
          aria-describedby={undefined}
        >
          <D.Title className="sr-only">{t("nav.commandHint")}</D.Title>
          <Command loop className="flex flex-col">
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="size-4 text-subtle-foreground" />
              <Command.Input
                autoFocus
                placeholder={t("nav.commandPlaceholder")}
                className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle-foreground"
              />
            </div>
            <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-subtle-foreground">
              <Command.Empty className="py-10 text-center text-sm text-muted-foreground">
                {t("nav.commandEmpty")}
              </Command.Empty>
              <Command.Group heading={t("nav.goTo")}>
                {items.map((i) => (
                  <Item key={i.key} onSelect={() => run(() => router.push(`${base}${i.href === "/" && base ? "" : i.href}`))}>
                    <i.icon />
                    {t(`nav.${i.key}`)}
                  </Item>
                ))}
              </Command.Group>
              <Command.Group heading={t("nav.quickActions")}>
                <Item onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
                  {resolvedTheme === "dark" ? <Sun /> : <Moon />}
                  {t("nav.toggleTheme")}
                </Item>
                <Item
                  onSelect={() =>
                    run(async () => {
                      await updatePreferences({ locale: locale === "ar" ? "en" : "ar" });
                      router.refresh();
                    })
                  }
                >
                  <Languages />
                  {t("nav.switchLanguage")}
                </Item>
              </Command.Group>
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function Item({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="group flex h-11 cursor-default items-center gap-3 rounded-lg px-2.5 text-[14px] data-[selected=true]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-subtle-foreground"
    >
      {children}
      <CornerDownLeft className="ms-auto opacity-0 group-data-[selected=true]:opacity-100 rtl:-scale-x-100" />
    </Command.Item>
  );
}
