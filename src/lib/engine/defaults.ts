import type { GypsumCatalogue, GypsumParams } from "./gypsum";
import type { ExteriorParams, InteriorParams, PaintProduct } from "./paint";

/**
 * Seed defaults from Appendix A.6 (the owner's Excel). Every value is a
 * starting point: editable per organization and overridable per project.
 * Prices are placeholders to update.
 */

export const GYPSUM_PARAMS: GypsumParams = {
  cSpacing: 0.4, // square grid with the omegas (owner, Nov 2026 — replaces A.6's 100 cm)
  omegaSpacing: 0.4,
  hangerSpacing: 1.0,
  studSpacing: 0.6,
  partitionHeight: 3,
  hangingHeight: 0.4,
  screwsPerM2PerLayer: 15,
  tapePerM2: 1.4,
  compoundPerM2: 0.45,
  angleScrewsPerM: 2.5,
  perimeterFactor: 0.7,
  trough: { boardPerM: 0.6, omegaPerM: 2, protectionAnglePerM: 2, hangersPerM: 1 },
  cutAllowance: 0.15,
  wastePercent: 5,
  suspension: "rod",
  layers: 1,
};

export const GYPSUM_CATALOGUE: GypsumCatalogue = {
  boards: {
    normal: { area: 2.88, price: 22 },
    moisture: { area: 2.88, price: 30 },
    fire: { area: 2.88, price: 34 },
  },
  cChannel: { length: 3, price: 11 },
  omega: { length: 3, price: 9 },
  rod: { length: 3, price: 7 },
  verticalHanger: { length: 3, price: 11 },
  edgeAngle: { length: 3, price: 6 },
  troughAngle: { length: 3, price: 7 },
  shadow: { length: 3, price: 25 },
  stud: { length: 3, price: 14 },
  track: { length: 3, price: 11 },
  washers: { count: 100, price: 25 },
  anchors: { count: 100, price: 30 },
  clips: { count: 100, price: 25 },
  angleScrews: { count: 100, price: 15 },
  boardScrews: { count: 1000, price: 35 },
  tape: { length: 90, price: 12 },
  compound: { kg: 20, price: 28 },
  insulationPerM2: 18,
  hatches: { "30x30": 60, "40x40": 75, "50x50": 90, "60x60": 110, "60x120": 180 },
  labour: { ceilingsPerM2: 12, partitionsPerM2: 15, extraLayerPerM2: 5, troughPerM: 15, shadowPerM: 8 },
};

export const INTERIOR_PARAMS: InteriorParams = {
  coats: { wallPutty: 2, ceilingPutty: 1, primer: 1, wallFinish: 2, ceilingPaint: 2, moisture: 2 },
  repaintSpotPercent: 20,
  wastePercent: 5,
  sandpaper: { coveragePerCoat: 150, price: 40 },
  nylon: { area: 50, price: 35 },
  tape: { area: 60, price: 6 },
  consumablesPerM2: 0.5,
  crackMaterial: { metresPerPack: 20, price: 25 },
  labour: { wallsFull: 12, ceilingsFull: 14, repaint: 7, decorativeExtra: 15, cracksPerM: 5 },
};

export const EXTERIOR_PARAMS: ExteriorParams = {
  coats: { primer: 1, putty: 1, finish: 2 },
  wastePercent: 5,
  sprayWastePercent: 15,
  labour: { application: 6, sandingPutty: 4, spray: 4.5 },
  scaffoldPerDay: 0,
  protection: { perM2: 0 },
};

/** Brand of the A.6 fallback paint products (shown as «عام», GENERIC_BRAND, in labels). */
export const GENERIC_DEFAULT_BRAND = "Generic";

/** Generic interior/exterior products from A.6 (brand "Generic"). */
export const PAINT_PRODUCTS: PaintProduct[] = [
  { id: "putty", brand: "Generic", role: "putty", name: "Wall putty 20 kg", unit: "kg", refPackSize: 20, coveragePerPack: 25, packs: [{ size: 20, price: 45 }], colourSpecific: false },
  { id: "primer", brand: "Generic", role: "primer", name: "Primer 18 L", unit: "L", refPackSize: 18, coveragePerPack: 140, packs: [{ size: 18, price: 120 }], colourSpecific: false },
  { id: "wall_finish", brand: "Generic", role: "wall_finish", name: "Wall emulsion 18 L", unit: "L", refPackSize: 18, coveragePerPack: 120, packs: [{ size: 18, price: 180 }], colourSpecific: true },
  { id: "ceiling_paint", brand: "Generic", role: "ceiling_paint", name: "Ceiling paint 18 L", unit: "L", refPackSize: 18, coveragePerPack: 130, packs: [{ size: 18, price: 140 }], colourSpecific: true },
  { id: "moisture", brand: "Generic", role: "moisture", name: "Moisture-resistant 18 L", unit: "L", refPackSize: 18, coveragePerPack: 110, packs: [{ size: 18, price: 230 }], colourSpecific: true },
  { id: "decorative", brand: "Generic", role: "decorative", name: "Decorative system 5 L", unit: "L", refPackSize: 5, coveragePerPack: 15, packs: [{ size: 5, price: 160 }], colourSpecific: true },
  { id: "ext_primer", brand: "Generic", role: "ext_primer", name: "Exterior primer", unit: "L", refPackSize: 18, coveragePerPack: 200, packs: [{ size: 18, price: 135 }], colourSpecific: false },
  { id: "ext_putty", brand: "Generic", role: "ext_putty", name: "Exterior putty", unit: "kg", refPackSize: 20, coveragePerPack: 25, packs: [{ size: 20, price: 90 }], colourSpecific: false },
  { id: "acrylic", brand: "Generic", role: "acrylic", name: "Exterior acrylic", unit: "L", refPackSize: 18, coveragePerPack: 150, packs: [{ size: 18, price: 340 }], colourSpecific: true },
  { id: "spray_acrylic", brand: "Generic", role: "spray_acrylic", name: "Spray acrylic", unit: "L", refPackSize: 18, coveragePerPack: 140, packs: [{ size: 18, price: 345 }], colourSpecific: true, wastePercent: 15 },
];

export const COMMERCIAL_DEFAULTS = {
  quoteValidityDays: 7,
  targetMarginPercent: 28,
  contingencyPercent: 5,
  minMarginPercent: 20,
  roundingStep: 1,
  warrantyMonths: 6,
};
