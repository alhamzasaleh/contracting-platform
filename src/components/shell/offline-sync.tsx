"use client";
import { CloudOff, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { saveProgress, uploadPhoto } from "@/app/(app)/projects/actions";
import { onOutboxChange, outboxList, outboxRemove, outboxUpdate } from "@/lib/client/outbox";

const subscribeOnline = (fn: () => void) => {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
};

/** Offline banner + sends saved site updates when the connection returns. */
export function OfflineSync() {
  const t = useTranslations("offline");
  const router = useRouter();
  const online = React.useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [waiting, setWaiting] = React.useState(0);
  const busy = React.useRef(false);

  const refresh = React.useCallback(() => {
    void outboxList().then((l) => setWaiting(l.length)).catch(() => setWaiting(0));
  }, []);

  const flush = React.useCallback(async () => {
    if (busy.current || !navigator.onLine) return;
    busy.current = true;
    let sent = 0;
    try {
      for (const item of await outboxList()) {
        // upload offline photos first, remembering each one so a retry never uploads twice
        while (item.blobs.length) {
          const fd = new FormData();
          fd.set("contract_id", item.contractId);
          fd.set("file", new File([item.blobs[0]], "photo.jpg", { type: "image/jpeg" }));
          const r = await uploadPhoto(fd);
          if (!r.ok || !r.data) throw new Error("upload");
          item.paths.push(r.data.path);
          item.blobs.shift();
          await outboxUpdate(item);
        }
        const r = await saveProgress({ stage_id: item.stageId, progress: item.progress, note: item.note, photos: item.paths, visible: item.visible });
        if (r.ok) {
          await outboxRemove(item.id);
          sent++;
        } else if (r.error !== "error") {
          // refused (e.g. the stage was already confirmed): drop it and tell the user
          await outboxRemove(item.id);
          toast.error(t("dropped", { label: item.label }));
        } else break;
      }
    } catch {
      // still offline or the server is unreachable — try again later
    } finally {
      busy.current = false;
      refresh();
      if (sent) {
        toast.success(t("synced", { n: sent }));
        router.refresh();
      }
    }
  }, [refresh, router, t]);

  React.useEffect(() => {
    refresh();
    const off = onOutboxChange(refresh);
    void flush();
    window.addEventListener("online", flush);
    return () => {
      off();
      window.removeEventListener("online", flush);
    };
  }, [flush, refresh]);

  if (online && waiting === 0) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-[13px] font-semibold">
      {online ? <RefreshCw className="size-4 animate-spin" /> : <CloudOff className="size-4" />}
      {online ? t("sending", { n: waiting }) : waiting ? t("offlineWaiting", { n: waiting }) : t("offline")}
    </div>
  );
}
