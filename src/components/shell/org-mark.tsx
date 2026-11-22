import { cn } from "@/lib/utils";

/**
 * Company logo, or the arch mark (the "Atelier" motif) until a logo is
 * uploaded. `tone="ink"` is for dark surfaces such as the sidebar.
 */
export function OrgMark({
  name,
  logoUrl,
  className,
  tone = "surface",
}: {
  name: string;
  logoUrl: string | null;
  className?: string;
  tone?: "surface" | "ink";
}) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
      <img
        src={logoUrl}
        alt=""
        className={cn("size-10 shrink-0 rounded-xl border border-border bg-white object-contain p-1", className)}
      />
    );
  }
  return <ArchMark className={className} tone={tone} label={name} />;
}

export function ArchMark({
  className,
  tone = "surface",
  label,
}: {
  className?: string;
  tone?: "surface" | "ink";
  label?: string;
}) {
  const color = tone === "ink" ? "var(--brand-dark)" : "var(--primary)";
  return (
    <span
      className={cn("relative inline-flex h-10 w-9 shrink-0 items-end justify-center", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 36 40" className="size-full" fill="none" aria-hidden>
        <path d="M2 38V18C2 9.2 9.2 2 18 2s16 7.2 16 16v20z" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M13 38V27a5 5 0 0 1 10 0v11z" fill={color} />
      </svg>
    </span>
  );
}
