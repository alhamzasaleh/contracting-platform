import { cn } from "@/lib/utils";

/** A document number (C-2026-001…) isolated as left-to-right so Arabic text around it can't reorder it. */
export function DocNo({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={cn("font-latin whitespace-nowrap", className)}>
      {children}
    </bdi>
  );
}
