"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  className,
  children,
  closeLabel = "Close",
  side,
  ...props
}: React.ComponentProps<typeof D.Content> & { closeLabel?: string; side?: "start" | "end" | "bottom" }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-basalt/45 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_0.2s_ease-out]" />
      <D.Content
        className={cn(
          "fixed z-50 bg-surface shadow-lg outline-none",
          side === "start" &&
            "inset-y-0 start-0 h-full w-[86%] max-w-xs border-e border-border data-[state=open]:animate-[slide-in-start_0.3s_var(--ease-out-expo)]",
          side === "end" &&
            "inset-y-0 end-0 h-full w-[92%] max-w-md border-s border-border data-[state=open]:animate-[slide-in-end_0.3s_var(--ease-out-expo)]",
          side === "bottom" &&
            "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl border-t border-border pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-[slide-in-bottom_0.3s_var(--ease-out-expo)]",
          !side &&
            "start-1/2 top-1/2 w-[calc(100%-2rem)] max-w-lg -translate-y-1/2 rounded-2xl border border-border ltr:-translate-x-1/2 rtl:translate-x-1/2 data-[state=open]:animate-[dialog-in_0.25s_var(--ease-out-expo)]",
          className,
        )}
        {...props}
      >
        {children}
        <D.Close
          className="absolute end-3.5 top-3.5 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          aria-label={closeLabel}
        >
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 p-6 pb-2", className)} {...props} />;
}
export function DialogTitle({ className, ...props }: React.ComponentProps<typeof D.Title>) {
  return <D.Title className={cn("text-lg font-semibold tracking-tight", className)} {...props} />;
}
export function DialogDescription({ className, ...props }: React.ComponentProps<typeof D.Description>) {
  return <D.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 py-4", className)} {...props} />;
}
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
