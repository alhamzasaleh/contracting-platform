/**
 * Scope of work per quote: what is included and what isn't.
 *
 * Nothing is "standard" except materials of the finish itself, labour and
 * margin: each system component is
 *   - always  → always priced (e.g. the finish coats),
 *   - on      → optional, included unless the client doesn't want it (e.g. primer),
 *   - off     → optional, excluded unless the client asks (e.g. cement sealer).
 * A component can apply only to some variants (e.g. exterior putty: roller and
 * spray, not profile). The quote lists both "included" and "not included".
 */

export type Inclusion = "always" | "on" | "off";

export type ComponentRule = {
  role: string;
  inclusion: Inclusion;
  /** Variants/methods this component applies to; empty/undefined = all. */
  variants?: string[] | null;
  /** Only makes sense with another component (e.g. sandpaper needs putty). */
  requires?: string;
};

/** role → included? (missing role = included). */
export type Scope = Record<string, boolean>;

export type ScopeItem = { role: string; applies: boolean; optional: boolean; included: boolean; requires?: string };

/** Defaults (Appendix A.2 + owner decisions); each organization can change them per system. */
export const INTERIOR_RULES: ComponentRule[] = [
  { role: "putty", inclusion: "on" },
  { role: "sealer", inclusion: "off" },
  { role: "primer", inclusion: "on" },
  { role: "wall_finish", inclusion: "always" },
  { role: "ceiling_paint", inclusion: "always" },
  { role: "moisture", inclusion: "always" },
  { role: "decorative", inclusion: "always" },
  { role: "sandpaper", inclusion: "on", requires: "putty" },
  { role: "floor_nylon", inclusion: "on" },
  { role: "masking_tape", inclusion: "on" },
];

export const EXTERIOR_RULES: ComponentRule[] = [
  { role: "sealer", inclusion: "off" },
  { role: "ext_primer", inclusion: "on" },
  // Profile/texture finishes don't need exterior putty.
  { role: "ext_putty", inclusion: "on", variants: ["roller", "spray"] },
  { role: "acrylic", inclusion: "always", variants: ["roller"] },
  { role: "profile", inclusion: "always", variants: ["profile"] },
  { role: "spray_acrylic", inclusion: "always", variants: ["spray"] },
];

/** Applies the rules for a variant and the client's choices (true/false per optional role). */
export function resolveScope(rules: ComponentRule[], variant: string, choices: Scope = {}): { scope: Scope; items: ScopeItem[] } {
  const items: ScopeItem[] = rules.map((r) => {
    const applies = !r.variants?.length || r.variants.includes(variant);
    const optional = r.inclusion !== "always";
    const included = applies && (optional ? (choices[r.role] ?? r.inclusion === "on") : true);
    return { role: r.role, applies, optional, included, requires: r.requires };
  });
  // A dependent component goes with its parent (no sanding without putty).
  for (const it of items) {
    if (it.requires && !items.find((x) => x.role === it.requires)?.included) it.included = false;
  }
  return { scope: Object.fromEntries(items.map((i) => [i.role, i.included])), items };
}
