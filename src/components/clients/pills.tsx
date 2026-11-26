"use client";
import { cn } from "@/lib/utils";

/** One choice out of a few, as pill buttons (room services, board type, wall zone…). */
export function Pills<T extends string>({ value, options, onChange, render, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; render: (v: T) => string; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
          className={cn("min-h-9 rounded-full border px-3 text-[13px]", o === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted-foreground")}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}
