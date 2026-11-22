"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Six-box one-time code input: paste, SMS autofill, Arabic digits. */
export function OtpInput({
  value,
  onChange,
  onComplete,
  invalid,
  disabled,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  label: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [focused, setFocused] = React.useState(false);

  const handle = (raw: string) => {
    const digits = raw
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
      .replace(/\D/g, "")
      .slice(0, 6);
    onChange(digits);
    if (digits.length === 6) onComplete?.(digits);
  };

  return (
    <div className="relative" dir="ltr" onClick={() => inputRef.current?.focus()}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => handle(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid || undefined}
        maxLength={6}
        className="absolute inset-0 z-10 cursor-text opacity-0"
      />
      <div className="grid grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => {
          const char = value[i];
          const active = focused && (i === value.length || (i === 5 && value.length === 6));
          return (
            <div
              key={i}
              className={cn(
                "flex aspect-[5/6] items-center justify-center rounded-xl border bg-surface font-latin text-2xl font-semibold shadow-xs transition-all duration-150",
                active ? "border-primary ring-4 ring-primary/15" : "border-border",
                invalid && "border-danger ring-danger/15",
                char && !invalid && "border-border-strong",
              )}
            >
              {char ?? (active ? <span className="h-6 w-px animate-pulse bg-foreground" /> : null)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
