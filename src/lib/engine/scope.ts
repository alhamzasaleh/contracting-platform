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

/** The finish the exterior method itself uses — it can't be "not applicable" to its own method. */
export const EXTERIOR_FINISH: Record<string, string> = { roller: "acrylic", profile: "profile", spray: "spray_acrylic" };

/** Gypsum: everything priced by default; the owner can make any part optional. */
export const GYPSUM_RULES: ComponentRule[] = [
  ...["board_normal", "board_moisture", "board_fire", "c_channel", "omega"].map((role) => ({ role, inclusion: "always" as const })),
  { role: "rod", inclusion: "always", variants: ["rod", "double"] },
  { role: "washers", inclusion: "always", variants: ["rod", "double"] },
  { role: "vertical_hanger", inclusion: "always", variants: ["vertical_c"] },
  ...["anchors", "clips", "edge_angle", "angle_screws", "board_screws", "joint_tape", "joint_compound", "stud", "track"].map((role) => ({ role, inclusion: "always" as const })),
];

/** Applies the rules for a variant and the client's choices (true/false per optional role). */
export function resolveScope(
  rules: ComponentRule[],
  variant: string,
  choices: Scope = {},
  /** Roles the chosen method itself uses (e.g. "profile" for the profile method): they always apply. */
  methodRoles: string[] = [],
): { scope: Scope; items: ScopeItem[] } {
  const items: ScopeItem[] = rules.map((r) => {
    const applies = methodRoles.includes(r.role) || !r.variants?.length || r.variants.includes(variant);
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
