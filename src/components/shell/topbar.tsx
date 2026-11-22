"use client";
import { Languages, LogOut, Menu, Monitor, Moon, Search, Settings2, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import * as React from "react";
import { updatePreferences } from "@/app/actions/preferences";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useFormatter } from "@/components/formatter-provider";
import { CommandMenu } from "./command-menu";
import { OrgMark } from "./org-mark";
import { SidebarBrand, SidebarNav } from "./sidebar";
import type { ShellData } from "./types";

export function Topbar({ data }: { data: ShellData }) {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const { fmt } = useFormatter();
  const { theme, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [cmdOpen, setCmdOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const base = data.basePath ?? "";
  const preview = Boolean(data.basePath);

  const switchLocale = () =>
    startTransition(async () => {
      await updatePreferences({ locale: locale === "ar" ? "en" : "ar" });
      router.refresh();
    });

  const changeTheme = (v: string) => {
    setTheme(v);
    if (!preview) void updatePreferences({ theme: v as "system" | "light" | "dark" });
  };

  return (
    <header className="glass sticky top-0 z-30 border-b border-border/70 pt-[env(safe-area-inset-top)]">
      <div className="flex h-16 items-center gap-2 px-4 sm:px-6">
        {/* Mobile: menu + company */}
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={() => setMenuOpen(true)}
          aria-label={t("nav.openMenu")}
        >
          <Menu className="!size-5" />
        </Button>
        <div className="flex min-w-0 items-center gap-2.5 lg:hidden">
          <OrgMark name={data.org.name} logoUrl={data.org.logoUrl} className="size-8" />
          <span className="truncate text-[15px] font-semibold">{data.org.name}</span>
        </div>

        {/* Search */}
        <button
          type="button"
          onClick={() => setCmdOpen(true)}
          className="ms-auto flex size-10 items-center justify-center gap-2.5 rounded-lg text-sm text-subtle-foreground transition-colors hover:text-foreground sm:ms-0 sm:h-11 sm:w-full sm:max-w-sm sm:justify-start sm:rounded-full sm:border sm:border-border sm:bg-surface sm:px-4 sm:hover:border-border-strong lg:max-w-md"
          aria-label={t("nav.commandHint")}
        >
          <Search className="size-4 shrink-0" />
          <span className="hidden flex-1 text-start sm:inline">{t("nav.commandPlaceholder")}</span>
          <kbd className="hidden rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-latin text-[11px] text-muted-foreground sm:inline ltr-inline">
            ⌘K
          </kbd>
        </button>

        <div className="flex items-center gap-1 sm:ms-auto">
          <Tooltip content={t("nav.switchLanguage")}>
            <Button variant="ghost" size="icon" onClick={switchLocale} loading={pending} aria-label={t("nav.switchLanguage")}>
              {!pending && <Languages />}
            </Button>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ms-1 flex items-center gap-2.5 rounded-full p-0.5 transition-shadow hover:ring-4 hover:ring-primary-soft focus-visible:outline-2"
                aria-label={t("user.profile")}
              >
                <Avatar name={data.user.name} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <div className="flex items-center gap-3 px-2.5 py-2">
                <Avatar name={data.user.name} className="size-10" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{data.user.name ?? "—"}</p>
                  {data.user.phone && (
                    <p className="ltr-inline text-xs text-muted-foreground">{fmt.digits(`+${data.user.phone}`)}</p>
                  )}
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t("settings.theme")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={theme} onValueChange={changeTheme}>
                <DropdownMenuRadioItem value="system">
                  <Monitor /> {t("settings.themeSystem")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="light">
                  <Sun /> {t("settings.themeLight")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <Moon /> {t("settings.themeDark")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={`${base}/settings/preferences`}>
                  <Settings2 /> {t("user.preferences")}
                </Link>
              </DropdownMenuItem>
              {!preview && (
                <form action="/auth/signout" method="post">
                  <DropdownMenuItem asChild destructive>
                    <button type="submit" className="w-full">
                      <LogOut className="rtl:-scale-x-100" /> {t("user.signOut")}
                    </button>
                  </DropdownMenuItem>
                </form>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent
          side="start"
          closeLabel={t("common.close")}
          aria-describedby={undefined}
          className="flex flex-col border-ink-3 bg-ink text-ink-foreground [&>button:last-child]:text-ink-muted [&>button:last-child]:hover:bg-ink-2"
        >
          <SidebarBrand data={data} />
          <div className="flex-1 overflow-y-auto px-3 py-4">
            <span className="sr-only" id="mobile-nav-title">{t("nav.menu")}</span>
            <SidebarNav data={data} onNavigate={() => setMenuOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>

      <CommandMenu data={data} open={cmdOpen} onOpenChange={setCmdOpen} />
    </header>
  );
}
