"use client";
import * as T from "@radix-ui/react-tooltip";
import * as React from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = T.Provider;

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md",
            "data-[state=delayed-open]:animate-[fade-up_0.15s_ease-out]",
          )}
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
