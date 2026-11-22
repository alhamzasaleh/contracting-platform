"use client";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import { cn } from "@/lib/utils";

/**
 * Runs a server action with consistent feedback: success toast + refresh,
 * field errors to the form, other errors as a toast. In the design preview
 * (no action passed) it just shows the preview notice.
 */
export function useActionRunner() {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const errorText = React.useCallback(
    (key: string) => {
      if (key === "noAccess") return t("common.noAccess");
      if (key === "rateLimited") return t("common.rateLimited");
      if (t.has(`errors.${key}`)) return t(`errors.${key}`);
      return t("common.error");
    },
    [t],
  );

  const fieldText = React.useCallback(
    (key?: string) => {
      if (!key) return undefined;
      if (key === "required") return t("common.required");
      if (key === "belowMin") return t("catalogue.belowMin");
      if (t.has(`errors.${key}`)) return t(`errors.${key}`);
      return t("errors.number");
    },
    [t],
  );

  function run<T>(
    action: (() => Promise<ActionResult<T>>) | undefined,
    opts: { onSuccess?: (r: ActionResult<T>) => void; onFieldErrors?: (e: Record<string, string>) => void; silent?: boolean } = {},
  ) {
    if (!action) {
      toast(t("preview.banner"));
      opts.onSuccess?.({ ok: true });
      return;
    }
    startTransition(async () => {
      const r = await action();
      if (r.ok) {
        if (!opts.silent) toast.success(t("common.saved"));
        opts.onFieldErrors?.({});
        opts.onSuccess?.(r);
        router.refresh();
      } else {
        if (r.fieldErrors && Object.keys(r.fieldErrors).length) opts.onFieldErrors?.(r.fieldErrors);
        else toast.error(errorText(r.error));
      }
    });
  }

  return { run, pending, fieldText };
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  pending,
  onSubmit,
  children,
  submitLabel,
  wide,
  footerExtra,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  pending?: boolean;
  onSubmit: (fd: FormData) => void;
  children: React.ReactNode;
  submitLabel?: string;
  wide?: boolean;
  footerExtra?: React.ReactNode;
}) {
  const t = useTranslations("common");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("close")} className={cn("flex max-h-[92dvh] flex-col", wide && "max-w-2xl")}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(new FormData(e.currentTarget));
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <DialogBody className="grid min-h-0 flex-1 gap-5 overflow-y-auto">{children}</DialogBody>
          <DialogFooter className="items-center">
            {footerExtra && <div className="me-auto">{footerExtra}</div>}
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {submitLabel ?? t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Number input (always LTR, unit on its physical right: "345 m²"): decimal keypad on iPad, LTR digits, accepts Arabic digits. */
export const NumberInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { suffix?: string }>(
  ({ suffix, className, ...props }, ref) => (
    <div className="relative">
      <Input
        ref={ref}
        inputMode="decimal"
        dir="ltr"
        autoComplete="off"
        className={cn("font-latin rtl:text-right", suffix && "pr-12", className)}
        {...props}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-subtle-foreground">
          {suffix}
        </span>
      )}
    </div>
  ),
);
NumberInput.displayName = "NumberInput";

export function DeleteButton({ onConfirm, pending, label }: { onConfirm: () => void; pending?: boolean; label?: string }) {
  const t = useTranslations("catalogue");
  const [confirming, setConfirming] = React.useState(false);
  if (confirming) {
    return (
      <span className="flex items-center gap-2 text-sm">
        <span className="text-danger">{t("confirmDelete")}</span>
        <Button type="button" variant="danger" size="sm" loading={pending} onClick={onConfirm}>
          {t("delete")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          ✕
        </Button>
      </span>
    );
  }
  return (
    <Button type="button" variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setConfirming(true)}>
      <Trash2 /> {label ?? t("delete")}
    </Button>
  );
}

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
export const bool = (fd: FormData, k: string) => fd.get(k) === "on";
