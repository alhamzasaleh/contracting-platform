import { COMMERCIAL_DEFAULTS, EXTERIOR_PARAMS, GYPSUM_CATALOGUE, GYPSUM_PARAMS, INTERIOR_PARAMS } from "./defaults";
import type { Bar, Box, GypsumCatalogue, GypsumParams } from "./gypsum";
import type { ExteriorParams, InteriorParams, PaintProduct, PaintRole } from "./paint";
import { EXTERIOR_RULES, GYPSUM_RULES, INTERIOR_RULES, type ComponentRule, type Inclusion } from "./scope";

/**
 * Builds the engine's inputs from the organization's catalogue
 * (products grouped by role, packs and current prices, consumption rates).
 *
 * Pure: the data layer loads rows, this turns them into engine config.
 * Anything missing falls back to the Appendix A.6 default and is reported
 * in `warnings`, so a quote never silently prices with a missing value.
 */

export type CatalogueProduct = {
  id: string;
  /** Role of the product's equivalence group (e.g. "wall_finish", "c_channel"). */
  role: string | null;
  brand: string | null;
  name: string;
  /** The product line (equivalence group) this brand row belongs to. */
  lineId?: string | null;
  /** Product category (used to explain unlinked products). */
  category?: string;
  unit: string;
  refPackSize: number | null;
  coveragePerPack: number | null;
  surfaceFactor: number;
  lengthM: number | null;
  contentsPerPack: number | null;
  areaM2: number | null;
  colourSpecific: boolean;
  wastePercent: number | null;
  /** Pack sizes with the price to use (preferred supplier or cheapest); null = no price yet. */
  packs: { size: number; price: number | null }[];
};

export type CatalogueData = {
  products: CatalogueProduct[];
  /** consumption_rates key → value (e.g. "gypsum.cSpacing" → 1). */
  rates: Record<string, number>;
  /** Scope rules per paint system (system_components.inclusion / variant_codes). */
  rules?: { kind: "interior_paint" | "exterior_paint" | "gypsum_ceiling" | "gypsum_partition"; role: string; inclusion: Inclusion; variants: string[] | null }[];
};

export type EngineWarning =
  | { kind: "missing_product"; role: string }
  | { kind: "missing_price"; role: string; product: string }
  | { kind: "missing_data"; role: string; product: string; fields: ("coverage" | "pack" | "price")[] }
  | { kind: "missing_rate"; key: string };

export type EngineConfig = {
  gypsum: { catalogue: GypsumCatalogue; params: GypsumParams };
  interior: InteriorParams;
  exterior: ExteriorParams;
  paintProducts: PaintProduct[];
  commercial: { targetMarginPercent: number; contingencyPercent: number; roundingStep: number; quoteValidityDays: number };
  /** Paint brands (from paint products) and gypsum brands (from boards/metal) — never mixed. */
  brands: string[];
  gypsumBrands: string[];
  /** What's always / optionally included, per paint system. */
  rules: { interior: ComponentRule[]; exterior: ComponentRule[]; gypsum: ComponentRule[] };
  warnings: EngineWarning[];
};

export const GENERIC_BRAND = "عام";

const PAINT_ROLES: PaintRole[] = ["sealer", "putty", "primer", "wall_finish", "ceiling_paint", "moisture", "decorative", "ext_primer", "ext_putty", "acrylic", "profile", "spray_acrylic"];

const GYPSUM_ROLES = new Set(["board_normal", "board_moisture", "board_fire", "c_channel", "omega", "rod", "vertical_hanger", "edge_angle", "trough_angle", "shadow", "stud", "track"]);


const cheapestPack = (p: CatalogueProduct) =>
  p.packs.filter((k) => k.price != null).sort((a, b) => a.price! / a.size - b.price! / b.size)[0];

export function buildEngineConfig(data: CatalogueData, opts: { gypsumBrand?: string } = {}): EngineConfig {
  const warnings: EngineWarning[] = [];
  const byRole = new Map<string, CatalogueProduct[]>();
  for (const p of data.products) {
    if (!p.role) continue;
    byRole.set(p.role, [...(byRole.get(p.role) ?? []), p]);
  }

  /** The product for a role: chosen brand first, then one with a price, then any. */
  const pick = (role: string) => {
    const list = byRole.get(role) ?? [];
    return (
      list.find((p) => opts.gypsumBrand && p.brand === opts.gypsumBrand && cheapestPack(p)) ??
      list.find((p) => cheapestPack(p)) ??
      list[0]
    );
  };

  const rate = (key: string, fallback: number) => {
    const v = data.rates[key];
    if (v == null || Number.isNaN(v)) {
      warnings.push({ kind: "missing_rate", key });
      return fallback;
    }
    return v;
  };

  /** Price of one pack of the product (and its size), falling back to the default with a warning. */
  function packOf(role: string, fallback: { size: number; price: number }) {
    const p = pick(role);
    if (!p) {
      warnings.push({ kind: "missing_product", role });
      return { productId: undefined, ...fallback };
    }
    const pack = cheapestPack(p);
    if (!pack) {
      warnings.push({ kind: "missing_price", role, product: p.name });
      return { productId: p.id, size: p.packs[0]?.size ?? fallback.size, price: 0 };
    }
    return { productId: p.id, size: pack.size, price: pack.price! };
  }

  const bar = (role: string, d: Bar): Bar => {
    const p = pick(role);
    const k = packOf(role, { size: d.length, price: d.price });
    return { productId: k.productId, length: p?.lengthM ?? d.length, price: k.price };
  };
  const box = (role: string, d: Box): Box => {
    const p = pick(role);
    const k = packOf(role, { size: d.count, price: d.price });
    return { productId: k.productId, count: p?.contentsPerPack ?? d.count, price: k.price };
  };
  const board = (role: string, d: { area: number; price: number }) => {
    const p = pick(role);
    const k = packOf(role, { size: 1, price: d.price });
    return { productId: k.productId, area: p?.areaM2 ?? d.area, price: k.price };
  };
  const contents = (role: string, d: number) => pick(role)?.contentsPerPack ?? d;

  const D = GYPSUM_CATALOGUE;
  const hatchSizes = Object.keys(D.hatches);
  const catalogue: GypsumCatalogue = {
    boards: { normal: board("board_normal", D.boards.normal), moisture: board("board_moisture", D.boards.moisture), fire: board("board_fire", D.boards.fire) },
    cChannel: bar("c_channel", D.cChannel),
    omega: bar("omega", D.omega),
    rod: bar("rod", D.rod),
    verticalHanger: bar("vertical_hanger", D.verticalHanger),
    edgeAngle: bar("edge_angle", D.edgeAngle),
    troughAngle: bar("trough_angle", D.troughAngle),
    shadow: bar("shadow", D.shadow),
    stud: bar("stud", D.stud),
    track: bar("track", D.track),
    washers: box("washers", D.washers),
    anchors: box("anchors", D.anchors),
    clips: box("clips", D.clips),
    angleScrews: box("angle_screws", D.angleScrews),
    boardScrews: box("board_screws", D.boardScrews),
    tape: (() => {
      const k = packOf("joint_tape", { size: D.tape.length, price: D.tape.price });
      return { productId: k.productId, length: contents("joint_tape", D.tape.length), price: k.price };
    })(),
    compound: (() => {
      const k = packOf("joint_compound", { size: D.compound.kg, price: D.compound.price });
      return { productId: k.productId, kg: contents("joint_compound", D.compound.kg), price: k.price };
    })(),
    insulationPerM2: packOf("insulation", { size: 1, price: D.insulationPerM2 }).price,
    hatches: Object.fromEntries(hatchSizes.map((s) => [s, packOf(`hatch_${s}`, { size: 1, price: D.hatches[s] }).price])),
    labour: {
      ceilingsPerM2: rate("labour.gypsum.ceilings", D.labour.ceilingsPerM2),
      partitionsPerM2: rate("labour.gypsum.partitions", D.labour.partitionsPerM2),
      extraLayerPerM2: rate("labour.gypsum.extraLayer", D.labour.extraLayerPerM2),
      troughPerM: rate("labour.gypsum.trough", D.labour.troughPerM),
      shadowPerM: rate("labour.gypsum.shadow", D.labour.shadowPerM),
    },
  };

  const G = GYPSUM_PARAMS;
  const params: GypsumParams = {
    ...G,
    cSpacing: rate("gypsum.cSpacing", G.cSpacing),
    omegaSpacing: rate("gypsum.omegaSpacing", G.omegaSpacing),
    hangerSpacing: rate("gypsum.hangerSpacing", G.hangerSpacing),
    studSpacing: rate("gypsum.studSpacing", G.studSpacing),
    partitionHeight: rate("gypsum.partitionHeight", G.partitionHeight),
    hangingHeight: rate("gypsum.hangingHeight", G.hangingHeight),
    screwsPerM2PerLayer: rate("gypsum.screwsPerM2PerLayer", G.screwsPerM2PerLayer),
    tapePerM2: rate("gypsum.tapePerM2", G.tapePerM2),
    compoundPerM2: rate("gypsum.compoundPerM2", G.compoundPerM2),
    angleScrewsPerM: rate("gypsum.angleScrewsPerM", G.angleScrewsPerM),
    perimeterFactor: rate("gypsum.perimeterFactor", G.perimeterFactor),
    trough: {
      boardPerM: rate("gypsum.trough.boardPerM", G.trough.boardPerM),
      omegaPerM: rate("gypsum.trough.omegaPerM", G.trough.omegaPerM),
      protectionAnglePerM: rate("gypsum.trough.protectionAnglePerM", G.trough.protectionAnglePerM),
      hangersPerM: rate("gypsum.trough.hangersPerM", G.trough.hangersPerM),
    },
    cutAllowance: rate("gypsum.cutAllowance", G.cutAllowance),
    wastePercent: rate("gypsum.wastePercent", G.wastePercent),
  };

  const I = INTERIOR_PARAMS;
  const interior: InteriorParams = {
    coats: {
      wallPutty: rate("interior.coats.wallPutty", I.coats.wallPutty),
      ceilingPutty: rate("interior.coats.ceilingPutty", I.coats.ceilingPutty),
      primer: rate("interior.coats.primer", I.coats.primer),
      wallFinish: rate("interior.coats.wallFinish", I.coats.wallFinish),
      ceilingPaint: rate("interior.coats.ceilingPaint", I.coats.ceilingPaint),
      moisture: rate("interior.coats.moisture", I.coats.moisture),
    },
    repaintSpotPercent: rate("interior.repaintSpotPercent", I.repaintSpotPercent),
    wastePercent: rate("interior.wastePercent", I.wastePercent),
    sandpaper: { coveragePerCoat: contents("sandpaper", I.sandpaper.coveragePerCoat), price: packOf("sandpaper", { size: 1, price: I.sandpaper.price }).price },
    nylon: { area: contents("floor_nylon", I.nylon.area), price: packOf("floor_nylon", { size: 1, price: I.nylon.price }).price },
    tape: { area: contents("masking_tape", I.tape.area), price: packOf("masking_tape", { size: 1, price: I.tape.price }).price },
    consumablesPerM2: rate("interior.consumablesPerM2", I.consumablesPerM2),
    crackMaterial: { metresPerPack: contents("crack_material", I.crackMaterial.metresPerPack), price: packOf("crack_material", { size: 1, price: I.crackMaterial.price }).price },
    labour: {
      wallsFull: rate("labour.interior.wallsFull", I.labour.wallsFull),
      ceilingsFull: rate("labour.interior.ceilingsFull", I.labour.ceilingsFull),
      repaint: rate("labour.interior.repaint", I.labour.repaint),
      decorativeExtra: rate("labour.interior.decorativeExtra", I.labour.decorativeExtra),
      cracksPerM: rate("labour.interior.cracks", I.labour.cracksPerM),
    },
  };

  const E = EXTERIOR_PARAMS;
  const exterior: ExteriorParams = {
    coats: {
      primer: rate("exterior.coats.primer", E.coats.primer),
      putty: rate("exterior.coats.putty", E.coats.putty),
      finish: rate("exterior.coats.finish", E.coats.finish),
    },
    wastePercent: rate("exterior.wastePercent", E.wastePercent),
    sprayWastePercent: rate("exterior.sprayWastePercent", E.sprayWastePercent),
    labour: {
      application: rate("labour.exterior.application", E.labour.application),
      sandingPutty: rate("labour.exterior.sandingPutty", E.labour.sandingPutty),
      spray: rate("labour.exterior.spray", E.labour.spray),
    },
    scaffoldPerDay: rate("exterior.scaffoldPerDay", E.scaffoldPerDay),
    protection: E.protection,
  };

  // Paint products: every product of a paint role, each brand its own entry (equivalence groups).
  const paintProducts: PaintProduct[] = [];
  for (const role of PAINT_ROLES) {
    for (const p of byRole.get(role) ?? []) {
      const priced = p.packs.filter((k) => k.price != null).map((k) => ({ size: k.size, price: k.price! }));
      if (!p.coveragePerPack || !p.refPackSize) {
        // Can't be priced without coverage and pack size — say exactly what's missing.
        const fields = [...(!p.coveragePerPack ? (["coverage"] as const) : []), ...(!p.refPackSize ? (["pack"] as const) : []), ...(!priced.length ? (["price"] as const) : [])];
        warnings.push({ kind: "missing_data", role, product: p.name, fields });
        continue;
      }
      if (!priced.length) warnings.push({ kind: "missing_price", role, product: p.name });
      paintProducts.push({
        id: p.id,
        brand: p.brand ?? GENERIC_BRAND,
        role,
        name: p.name,
        unit: p.unit === "kg" ? "kg" : "L",
        refPackSize: p.refPackSize,
        coveragePerPack: p.coveragePerPack,
        surfaceFactor: p.surfaceFactor,
        packs: priced.length ? priced : [{ size: p.refPackSize, price: 0 }],
        colourSpecific: p.colourSpecific,
        wastePercent: p.wastePercent ?? undefined,
      });
    }
  }

  const C = COMMERCIAL_DEFAULTS;
  const commercial = {
    targetMarginPercent: rate("commercial.targetMarginPercent", C.targetMarginPercent),
    contingencyPercent: rate("commercial.contingencyPercent", C.contingencyPercent),
    roundingStep: rate("commercial.roundingStep", C.roundingStep),
    quoteValidityDays: rate("commercial.quoteValidityDays", C.quoteValidityDays),
  };

  const brands = [...new Set(paintProducts.map((p) => p.brand))];
  const gypsumBrands = [
    ...new Set(data.products.filter((p) => p.role && GYPSUM_ROLES.has(p.role) && p.brand).map((p) => p.brand!)),
  ];
  const mergeRules = (defaults: ComponentRule[], ...kinds: NonNullable<CatalogueData["rules"]>[number]["kind"][]): ComponentRule[] => {
    const rows = (data.rules ?? []).filter((r) => kinds.includes(r.kind));
    const merged = defaults.map((d) => {
      const row = rows.find((r) => r.role === d.role);
      if (!row) return d;
      // The owner decides: any component can be always or optional.
      // The owner's choice wins, including "all options" (null).
      return { ...d, inclusion: row.inclusion, variants: row.variants ?? undefined };
    });
    for (const r of rows) {
      if (!merged.some((m) => m.role === r.role) && r.inclusion !== "always") merged.push({ role: r.role, inclusion: r.inclusion, variants: r.variants ?? undefined });
    }
    return merged;
  };
  const rules = {
    interior: mergeRules(INTERIOR_RULES, "interior_paint"),
    exterior: mergeRules(EXTERIOR_RULES, "exterior_paint"),
    gypsum: mergeRules(GYPSUM_RULES, "gypsum_ceiling", "gypsum_partition"),
  };

  return { gypsum: { catalogue, params }, interior, exterior, paintProducts, commercial, brands, gypsumBrands, rules, warnings };
}

/** Rates as seeded from Appendix A.6 — used by tests and the design preview. */
export function defaultRates(): Record<string, number> {
  const G = GYPSUM_PARAMS, I = INTERIOR_PARAMS, E = EXTERIOR_PARAMS, L = GYPSUM_CATALOGUE.labour, C = COMMERCIAL_DEFAULTS;
  return {
    "gypsum.cSpacing": G.cSpacing, "gypsum.omegaSpacing": G.omegaSpacing, "gypsum.hangerSpacing": G.hangerSpacing,
    "gypsum.studSpacing": G.studSpacing, "gypsum.partitionHeight": G.partitionHeight, "gypsum.hangingHeight": G.hangingHeight,
    "gypsum.screwsPerM2PerLayer": G.screwsPerM2PerLayer, "gypsum.tapePerM2": G.tapePerM2, "gypsum.compoundPerM2": G.compoundPerM2,
    "gypsum.angleScrewsPerM": G.angleScrewsPerM, "gypsum.perimeterFactor": G.perimeterFactor,
    "gypsum.trough.boardPerM": G.trough.boardPerM, "gypsum.trough.omegaPerM": G.trough.omegaPerM,
    "gypsum.trough.protectionAnglePerM": G.trough.protectionAnglePerM, "gypsum.trough.hangersPerM": G.trough.hangersPerM,
    "gypsum.cutAllowance": G.cutAllowance, "gypsum.productivity": 40, "gypsum.wastePercent": G.wastePercent,
    "interior.coats.wallPutty": I.coats.wallPutty, "interior.coats.ceilingPutty": I.coats.ceilingPutty, "interior.coats.primer": I.coats.primer,
    "interior.coats.wallFinish": I.coats.wallFinish, "interior.coats.ceilingPaint": I.coats.ceilingPaint, "interior.coats.moisture": I.coats.moisture,
    "interior.repaintSpotPercent": I.repaintSpotPercent, "interior.wastePercent": I.wastePercent, "interior.consumablesPerM2": I.consumablesPerM2,
    "interior.productivity": 120,
    "exterior.coats.primer": E.coats.primer, "exterior.coats.putty": E.coats.putty, "exterior.coats.finish": E.coats.finish,
    "exterior.wastePercent": E.wastePercent, "exterior.sprayWastePercent": E.sprayWastePercent, "exterior.scaffoldPerDay": E.scaffoldPerDay,
    "exterior.productivity": 100,
    "labour.gypsum.ceilings": L.ceilingsPerM2, "labour.gypsum.partitions": L.partitionsPerM2, "labour.gypsum.extraLayer": L.extraLayerPerM2,
    "labour.gypsum.trough": L.troughPerM, "labour.gypsum.shadow": L.shadowPerM,
    "labour.interior.wallsFull": I.labour.wallsFull, "labour.interior.ceilingsFull": I.labour.ceilingsFull, "labour.interior.repaint": I.labour.repaint,
    "labour.interior.decorativeExtra": I.labour.decorativeExtra, "labour.interior.cracks": I.labour.cracksPerM,
    "labour.exterior.application": E.labour.application, "labour.exterior.sandingPutty": E.labour.sandingPutty, "labour.exterior.spray": E.labour.spray,
    "commercial.quoteValidityDays": C.quoteValidityDays, "commercial.targetMarginPercent": C.targetMarginPercent,
    "commercial.contingencyPercent": C.contingencyPercent, "commercial.roundingStep": C.roundingStep,
  };
}
