import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { inputClass } from "./input";

/** Native select (best on iPad/phones), styled like our inputs. */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select ref={ref} className={cn(inputClass, "appearance-none pe-10", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute end-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
    </div>
  ),
);
NativeSelect.displayName = "NativeSelect";
