import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-strong bg-surface/60 px-6 py-14 text-center", className)}>
      {icon && <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary [&_svg]:size-6">{icon}</span>}
      <p className="text-[16px] font-extrabold">{title}</p>
      {description && <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
