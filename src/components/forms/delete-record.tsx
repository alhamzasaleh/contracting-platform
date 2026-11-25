"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useActionRunner } from "@/components/forms/form-kit";
import type { DeleteBlock } from "@/lib/deletion";
import { settle } from "@/lib/client/action";

type Result = { ok: true } | { ok: false; error: string };

/**
 * «حذف» for a client, survey or quote — shown to the owner only. Opens a confirmation that says
 * what goes with it; when the database would refuse (a contract, the client's acceptance, a quote
 * on the survey), the button is disabled with the reason (`compact` = an icon in a list row: the
 * dialog says the reason instead). After deleting, replaces the page with `to` (the page above;
 * the same page → refreshed).
 */
export function DeleteRecord({
  label,
  title,
  body,
  block,
  action,
  to,
  compact,
}: {
  label: string;
  title: string;
  body: string;
  block: DeleteBlock | null;
  action?: () => Promise<Result>;
  to: string;
  compact?: boolean;
}) {
  const t = useTranslations("deletion");
  const te = useTranslations("errors");
  const tp = useTranslations("preview");
  const router = useRouter();
  const pathname = usePathname();
  const { errorText } = useActionRunner();
  const [open, setOpen] = React.useState(false);
  const [pending, startDelete] = React.useTransition();
  const reason = block ? te(block) : null;

  const confirm = () => {
    if (!action) {
      toast(tp("banner"));
      setOpen(false);
      return;
    }
    startDelete(async () => {
      const r = await settle(action);
      if (r.ok) {
        toast.success(t("deleted"));
        setOpen(false);
        // replace: the deleted page leaves the history (Back never shows it again)
        if (to === pathname) router.refresh();
        else router.replace(to);
      } else {
        toast.error(errorText(r.error));
      }
    });
  };

  return (
    <>
      {compact ? (
        <Button type="button" variant="ghost" size="icon-sm" className="shrink-0 text-danger hover:text-danger" aria-label={label} onClick={() => setOpen(true)}>
          <Trash2 />
        </Button>
      ) : reason ? (
        <span className="flex max-w-full flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" disabled>
            <Trash2 /> {label}
          </Button>
          <span className="text-[12px] text-muted-foreground">{reason}</span>
        </span>
      ) : (
        <Button type="button" variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setOpen(true)}>
          <Trash2 /> {label}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{reason ? t("cantDelete") : body}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {reason ? (
              <p className="rounded-xl border border-border bg-surface-2 p-3 text-[14px]">{reason}</p>
            ) : (
              <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-[13px] text-danger">{t("irreversible")}</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" variant="danger" size="sm" loading={pending} disabled={!!reason} onClick={confirm}>
              <Trash2 /> {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
