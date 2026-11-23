"use client";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { saveNotificationPrefs } from "@/app/(app)/notifications/actions";
import { useFormatter } from "@/components/formatter-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { NotificationKind } from "@/lib/supabase/database.types";

type Pref = { kind: NotificationKind; in_app: boolean; whatsapp: boolean };

/** Each user picks which notifications reach them, in the app and/or on WhatsApp. */
export function NotificationPrefsView({ prefs: initial, phone, whatsappReady, preview }: { prefs: Pref[]; phone: string | null; whatsappReady: boolean; preview?: boolean }) {
  const t = useTranslations("notify");
  const tc = useTranslations("common");
  const { fmt } = useFormatter();
  const [prefs, setPrefs] = React.useState(initial);
  const [pending, startTransition] = React.useTransition();
  const set = (kind: NotificationKind, patch: Partial<Pref>) => setPrefs((xs) => xs.map((p) => (p.kind === kind ? { ...p, ...patch } : p)));

  const save = () => {
    if (preview) return toast(tc("saved"));
    startTransition(async () => {
      const r = await saveNotificationPrefs({ prefs });
      if (r.ok) toast.success(tc("saved"));
      else toast.error(tc("error"));
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("prefsTitle")}</CardTitle>
        <CardDescription>
          {t("prefsHint")} {phone ? t("whatsappTo", { phone: fmt.digits(`+${phone}`) }) : ""}
        </CardDescription>
        {!whatsappReady && <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted-foreground">{t("whatsappPending")}</p>}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 gap-y-4">
          <span />
          <span className="text-center text-xs font-semibold text-muted-foreground">{t("inApp")}</span>
          <span className="text-center text-xs font-semibold text-muted-foreground">{t("whatsapp")}</span>
          {prefs.map((p) => (
            <React.Fragment key={p.kind}>
              <span className="text-sm">{t(`k_${p.kind}`)}</span>
              <Switch checked={p.in_app} onCheckedChange={(v) => set(p.kind, { in_app: v, whatsapp: v ? p.whatsapp : false })} aria-label={`${t(`k_${p.kind}`)} — ${t("inApp")}`} className="justify-self-center" />
              <Switch checked={p.whatsapp} disabled={!p.in_app} onCheckedChange={(v) => set(p.kind, { whatsapp: v })} aria-label={`${t(`k_${p.kind}`)} — ${t("whatsapp")}`} className="justify-self-center" />
            </React.Fragment>
          ))}
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={save} loading={pending}>
          {tc("save")}
        </Button>
      </CardFooter>
    </Card>
  );
}
