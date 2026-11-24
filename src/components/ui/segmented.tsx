"use client";
import { motion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * iOS-style segmented control with an animated thumb.
 * Options follow the reading direction (right → left in Arabic, left → right
 * in English) and an "all" option always comes first.
 */
export function orderOptions<T extends { value: string }>(options: T[]): T[] {
  return [...options.filter((o) => o.value === "all"), ...options.filter((o) => o.value !== "all")];
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  name,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; icon?: React.ReactNode }[];
  name: string;
  className?: string;
}) {
  const id = React.useId();
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className={cn("inline-flex max-w-full rounded-xl border border-border bg-surface-sunken p-1", className)}
    >
      {orderOptions(options).map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative flex min-h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-2 py-1 text-center text-sm leading-tight font-medium transition-colors sm:min-w-20 sm:whitespace-nowrap sm:px-3 [&_svg]:size-4",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-lg border border-border bg-surface shadow-sm"
                transition={{ type: "spring", bounce: 0.18, duration: 0.45 }}
              />
            )}
            <span className="relative flex items-center gap-2">
              {o.icon}
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
