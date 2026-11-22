import { cn, initials } from "@/lib/utils";

export function Avatar({ name, className }: { name?: string | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-[13px] font-semibold text-white ring-2 ring-surface",
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
