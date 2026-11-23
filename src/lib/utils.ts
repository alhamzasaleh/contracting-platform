import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name?: string | null) {
  if (!name) return "؟";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

/**
 * Left-to-right isolate for codes inside strings (document numbers in
 * labels, <option>s, titles): U+2066 … U+2069. In JSX prefer <DocNo>.
 */
export const ltr = (s: string | null | undefined) => (s ? `⁦${s}⁩` : "");
