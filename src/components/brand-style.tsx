import { deriveTheme, isHex } from "@/lib/brand/color";

/**
 * Injects the organization's brand colours as CSS variables. Colours are
 * validated hex values from the database, so they are safe to inline.
 */
export function BrandStyle({ primary, accent }: { primary?: string | null; accent?: string | null }) {
  if (!primary || !isHex(primary)) return null;
  const { light, dark } = deriveTheme(primary, accent && isHex(accent) ? accent : null);
  const css = `:root{--brand-light:${light.primary};--brand-light-fg:${light.primaryForeground};--brand-dark:${dark.primary};--brand-dark-fg:${dark.primaryForeground};--accent-light:${light.accent};--accent-light-fg:${light.accentForeground};--accent-dark:${dark.accent};--accent-dark-fg:${dark.accentForeground};}`;
  return <style>{css}</style>;
}
