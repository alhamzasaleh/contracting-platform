import { readFileSync } from "node:fs";
import type { CatalogueProduct } from "@/lib/engine";

/** Seeded Appendix A.6 catalogue, parsed from the seed migration (keeps tests in sync with the SQL). */
const MIGRATION = readFileSync("supabase/migrations/20261124000001_pricing_engine.sql", "utf8");

/** Products exactly as seed_pricing_engine() creates them (parsed from the migration). */
export function seededProducts(): CatalogueProduct[] {
  const rows = [...MIGRATION.matchAll(/^\s*\('([a-z0-9_]+)', '[^']*', '([^']*)', '[a-z_]+', '([A-Za-z0-9]+)', ([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+), (true|false), '[a-z]+', '[^']*', ([0-9.]+)(?:::numeric)?, '(\{[^']*\})'\)/gm)];
  const n = (s: string) => {
    const v = s.replace("::numeric", "").trim();
    return v === "null" ? null : Number(v);
  };
  return rows.map(([, role, name, unit, refPack, coverage, length, contents, area, colour, price, specs]) => {
    const size = n(refPack) ?? n(contents) ?? n(length) ?? n(area) ?? 1;
    return {
      id: role,
      lineId: `line-${role}`,
      role,
      brand: null,
      name,
      unit,
      refPackSize: n(refPack),
      coveragePerPack: n(coverage),
      surfaceFactor: 1,
      lengthM: n(length),
      contentsPerPack: n(contents),
      areaM2: n(area),
      colourSpecific: colour === "true",
      wastePercent: (JSON.parse(specs) as { wastePercent?: number }).wastePercent ?? null,
      packs: [{ size, price: Number(price) > 0 ? Number(price) : null }],
    };
  });
}

export function seededRates(): Record<string, number> {
  return Object.fromEntries([...MIGRATION.matchAll(/\(p_org, '[a-z]+', \d+, '([a-zA-Z0-9_.]+)', ([0-9.]+),/g)].map(([, k, v]) => [k, Number(v)]));
}

