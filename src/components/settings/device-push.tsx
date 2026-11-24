"use client";
import { BellRing } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { removePushSubscription, savePushSubscription, sendPushTest } from "@/app/(app)/notifications/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deviceName } from "@/lib/client/device";
import { claimDevice, enableDevice } from "@/lib/client/push-device";
import { settle } from "@/lib/client/action";
import { useFailureText } from "@/lib/client/failure-text";

type State = "loading" | "unsupported" | "ios" | "denied" | "off" | "on";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
}

/** "Notifications on this device": subscribe this browser/app to push. */
export function DevicePush({ publicKey, devices, preview }: { publicKey: string | null; devices: number; preview?: boolean }) {
  const t = useTranslations("notify");
  const tc = useTranslations("common");
  const failure = useFailureText();
  const [state, setState] = React.useState<State>("loading");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    const decide = async (): Promise<State> => {
      if (!("serviceWorker" in navigator) || !("Notification" in window)) return "unsupported";
      const ios = /iPad|iPhone/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (!("PushManager" in window)) return ios && !standalone ? "ios" : "unsupported";
      if (Notification.permission === "denied") return "denied";
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      // a shared iPad: the subscription may be someone else's — claim it for this user first
      return preview ? (sub ? "on" : "off") : claimDevice(sub, savePushSubscription, deviceName());
    };
    decide()
      .catch(() => "unsupported" as State)
      .then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, [preview]);

  const enable = async () => {
    if (preview) return toast(tc("saved"));
    if (!publicKey) return toast.error(tc("error"));
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const ok = await enableDevice({
        existing: await reg.pushManager.getSubscription(),
        subscribe: () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }),
        save: savePushSubscription,
        device: deviceName(),
      });
      if (ok) {
        setState("on");
        toast.success(t("deviceOn"));
      } else toast.error(tc("error"));
    } catch {
      toast.error(tc("error"));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (preview) return toast(tc("saved"));
    setBusy(true);
    try {
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      if (sub) {
        // the row must be this user's before the browser stops (claim, then remove) — never
        // unsubscribe a device whose row someone else holds without taking it over first
        if ((await claimDevice(sub, savePushSubscription, deviceName())) !== "on") throw new Error("claim");
        const r = await removePushSubscription({ endpoint: sub.endpoint });
        if (!r.ok) throw new Error("remove");
        await sub.unsubscribe();
      }
      setState("off");
      toast.success(t("deviceOff"));
    } catch {
      toast.error(tc("error"));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (preview) return toast(t("deviceTestSent"));
    setBusy(true);
    const r = await settle(() => sendPushTest({ text: t("testText") }));
    setBusy(false);
    if (r.ok) toast.success(t("deviceTestSent"));
    else toast.error(failure(r.error) ?? tc("error"));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-5 text-primary" aria-hidden />
          {t("deviceTitle")}
        </CardTitle>
        <CardDescription>
          {t("deviceHint")} {t("deviceCount", { n: devices })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {state === "on" && (
          <>
            <span className="rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold">{t("deviceOn")}</span>
            <Button variant="secondary" onClick={test} loading={busy}>
              {t("deviceTest")}
            </Button>
            <Button variant="ghost" onClick={disable} disabled={busy}>
              {t("deviceDisable")}
            </Button>
          </>
        )}
        {state === "off" && (
          <Button onClick={enable} loading={busy}>
            {t("deviceEnable")}
          </Button>
        )}
        {state === "loading" && <span className="h-10 w-48 animate-pulse rounded-full bg-surface-2" />}
        {state === "ios" && <p className="text-sm text-muted-foreground">{t("deviceIos")}</p>}
        {state === "denied" && <p className="text-sm text-muted-foreground">{t("deviceDenied")}</p>}
        {state === "unsupported" && <p className="text-sm text-muted-foreground">{t("deviceUnsupported")}</p>}
      </CardContent>
    </Card>
  );
}
