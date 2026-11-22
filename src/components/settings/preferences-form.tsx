"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import * as React from "react";
import { toast } from "sonner";
import { updatePreferences } from "@/app/actions/preferences";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";

type Prefs = { full_name: string | null; locale: "ar" | "en"; numerals: "latn" | "arab"; theme: "system" | "light" | "dark" };

export function PreferencesForm({ initial, preview }: { initial: Prefs; preview?: boolean }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const { setTheme } = useTheme();
  const [prefs, setPrefs] = React.useState(initial);
  const [pending, startTransition] = React.useTransition();

  const apply = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if (patch.theme) setTheme(patch.theme);
    if (patch.locale || patch.numerals || patch.theme) {
      startTransition(async () => {
        const { full_name: _ignored, ...rest } = patch;
        void _ignored;
        await updatePreferences(preview ? { locale: rest.locale, numerals: rest.numerals } : rest);
        router.refresh();
      });
    }
  };

  const saveName = () => {
    if (preview) return toast(tc("saved"));
    startTransition(async () => {
      const r = await updatePreferences({ full_name: prefs.full_name ?? "" });
      if (r.ok) {
        toast.success(tc("saved"));
        router.refresh();
      } else toast.error(tc("error"));
    });
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("prefsTitle")}</CardTitle>
          <CardDescription>{t("prefsHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <Row label={t("language")}>
            <Segmented
              name={t("language")}
              value={prefs.locale}
              onChange={(v) => apply({ locale: v })}
              options={[
                { value: "ar", label: "العربية" },
                { value: "en", label: "English" },
              ]}
            />
          </Row>
          <Row label={t("numerals")}>
            <Segmented
              name={t("numerals")}
              value={prefs.numerals}
              onChange={(v) => apply({ numerals: v })}
              options={[
                { value: "latn", label: <span className="font-latin">{t("numeralsLatn")}</span> },
                { value: "arab", label: t("numeralsArab") },
              ]}
            />
          </Row>
          <Row label={t("theme")}>
            <Segmented
              name={t("theme")}
              value={prefs.theme}
              onChange={(v) => apply({ theme: v })}
              options={[
                { value: "system", label: t("themeSystem"), icon: <Monitor /> },
                { value: "light", label: t("themeLight"), icon: <Sun /> },
                { value: "dark", label: t("themeDark"), icon: <Moon /> },
              ]}
            />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("fullName")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Field id="pref-name" label={t("fullName")} className="max-w-md">
            <Input value={prefs.full_name ?? ""} onChange={(e) => setPrefs((p) => ({ ...p, full_name: e.target.value }))} autoComplete="name" />
          </Field>
        </CardContent>
        <CardFooter>
          <Button onClick={saveName} loading={pending} disabled={(prefs.full_name ?? "").trim().length < 2 || prefs.full_name === initial.full_name}>
            {tc("save")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[14px] font-medium">{label}</p>
      {children}
    </div>
  );
}
