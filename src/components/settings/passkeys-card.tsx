"use client";
import { Fingerprint, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { useFormatter } from "@/components/formatter-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deviceName, usePasskeySupport } from "@/lib/client/device";
import { createClient } from "@/lib/supabase/client";

type Item = { id: string; friendly_name?: string; created_at: string; last_used_at?: string };

/** The signed-in user's passkeys (Face ID / fingerprint) — add one for this device or remove old ones. */
export function PasskeysCard({ preview, sample }: { preview?: boolean; sample?: Item[] }) {
  const t = useTranslations("passkeys");
  const { fmt } = useFormatter();
  const supported = usePasskeySupport();
  const [items, setItems] = React.useState<Item[] | null>(preview ? (sample ?? []) : null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const { data } = await createClient().auth.passkey.list();
    setItems(data ?? []);
  }, []);

  React.useEffect(() => {
    if (preview) return;
    let alive = true;
    createClient()
      .auth.passkey.list()
      .then(({ data }) => alive && setItems(data ?? []))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [preview]);

  const add = async () => {
    if (preview) return toast(t("done"));
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.registerPasskey();
      if (error || !data) {
        if ((error as { code?: string } | null)?.code !== "ERROR_CEREMONY_ABORTED") toast.error(t("failed"));
        return;
      }
      await supabase.auth.passkey.update({ passkeyId: data.id, friendlyName: deviceName() }).catch(() => undefined);
      toast.success(t("done"));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (preview) return setItems((xs) => (xs ?? []).filter((x) => x.id !== id));
    setBusy(true);
    const { error } = await createClient().auth.passkey.delete({ passkeyId: id });
    setBusy(false);
    if (error) return toast.error(t("failed"));
    toast.success(t("removed"));
    await load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="size-5 text-primary" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {items === null ? (
          <span className="h-12 animate-pulse rounded-2xl bg-surface-2" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {items.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{p.friendly_name || "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("added", { date: fmt.date(p.created_at) })}
                    {p.last_used_at ? ` · ${t("used", { date: fmt.date(p.last_used_at) })}` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => remove(p.id)} disabled={busy}>
                  <Trash2 />
                  {t("remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {supported || preview ? (
          <Button onClick={add} loading={busy} className="justify-self-start">
            <Plus />
            {t("add")}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{t("unsupported")}</p>
        )}
      </CardContent>
    </Card>
  );
}
