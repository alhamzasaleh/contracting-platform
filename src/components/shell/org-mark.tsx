import { cn } from "@/lib/utils";

/** Company logo, or an elegant monogram until a logo is uploaded. */
export function OrgMark({ name, logoUrl, className }: { name: string; logoUrl: string | null; className?: string }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
      <img
        src={logoUrl}
        alt=""
        className={cn("size-9 shrink-0 rounded-lg border border-border bg-white object-contain p-1", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary text-[15px] font-bold text-primary-foreground shadow-sm",
        className,
      )}
      aria-hidden
    >
      <span className="absolute inset-0 bg-gradient-to-br from-white/25 to-transparent" />
      <span className="relative">{name.trim().charAt(0)}</span>
    </span>
  );
}
