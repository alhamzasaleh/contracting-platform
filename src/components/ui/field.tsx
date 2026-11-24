import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

/**
 * Label + control + hint/error, wired for screen readers.
 * Put fields that sit side by side in a grid with the `field-row` class
 * (globals.css): their labels, controls and hints then share rows, so the
 * controls line up even when one label wraps or only one field has a hint.
 */
export function Field({
  id,
  label,
  hint,
  error,
  optional,
  action,
  className,
  children,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  optional?: string;
  /** a small button at the end of the label row (e.g. delete this row), so it never takes a column of its own */
  action?: React.ReactNode;
  className?: string;
  children: React.ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div data-field className={cn("grid content-start gap-2", className)}>
      <div data-field-label className="flex min-h-5 items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {optional && <span className="text-xs leading-none text-subtle-foreground">{optional}</span>}
        {action && <span className="-my-2 shrink-0">{action}</span>}
      </div>
      {React.cloneElement(children, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {error ? (
        <p data-field-hint id={`${id}-error`} className="text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p data-field-hint id={`${id}-hint`} className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
