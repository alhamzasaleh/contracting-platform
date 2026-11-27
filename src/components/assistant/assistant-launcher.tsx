"use client";
import { Maximize2, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { askFinanceAssistant } from "@/app/(app)/assistant/actions";
import type { ActionResult } from "@/lib/actions";
import type { AssistantAnswer } from "@/lib/ai/assistant";
import { AssistantView } from "./assistant-view";

/**
 * Small floating assistant button on every page (finance users). The panel stays
 * mounted while hidden, so the conversation survives moving between pages.
 */
export function AssistantLauncher({
  ready,
  preview,
  ask,
}: {
  ready: boolean;
  preview?: boolean;
  /** the design preview's stand-in (a fixed answer); the app uses the real assistant */
  ask?: (i: unknown) => Promise<ActionResult<AssistantAnswer>>;
}) {
  const t = useTranslations("assistant");
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [used, setUsed] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (pathname.endsWith("/assistant")) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setUsed(true);
          }}
          aria-label={t("open")}
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] end-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/20 transition-transform hover:scale-105 focus-visible:outline-2 sm:end-6"
        >
          <Sparkles className="size-6" />
        </button>
      )}
      {used && (
        <section
          role="dialog"
          aria-modal="false"
          aria-label={t("title")}
          hidden={!open}
          className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-40 flex h-[min(78dvh,44rem)] flex-col rounded-3xl border border-border bg-surface shadow-2xl shadow-black/25 sm:inset-x-auto sm:end-6 sm:w-[26rem]"
        >
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <p className="flex items-center gap-2 font-bold">
              <Sparkles className="size-5 text-primary" /> {t("title")}
            </p>
            <div className="flex items-center gap-1">
              <Link href={preview ? "/dev/preview/assistant" : "/assistant"} onClick={() => setOpen(false)} aria-label={t("full")} className="rounded-full p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground">
                <Maximize2 className="size-4" />
              </Link>
              <button type="button" onClick={() => setOpen(false)} aria-label={t("close")} className="rounded-full p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
          </header>
          <div className="min-h-0 flex-1 p-3">
            <AssistantView compact ready={ready} ask={ask ?? (preview ? undefined : askFinanceAssistant)} onNavigate={() => setOpen(false)} />
          </div>
        </section>
      )}
    </>
  );
}
