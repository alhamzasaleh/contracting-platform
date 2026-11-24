import { ceilInt, sum } from "./math";
import { optimisePacks, type PackOption } from "./packs";
import type { EngineResult, Line } from "./types";
import { GENERIC_BRAND } from "./catalogue";
import { GENERIC_DEFAULT_BRAND } from "./defaults";

/**
 * Paint engine (Appendix A.4): interior (new / repaint) and exterior
 * (roller / profile / spray). Quantities per product and per colour, with
 * the cheapest pack combination.
 */

export type PaintRole =
  | "putty"
  | "primer"
  | "wall_finish"
  | "ceiling_paint"
  | "moisture"
  | "decorative"
  | "ext_primer"
  | "ext_putty"
  | "acrylic"
  | "profile"
  | "spray_acrylic"
  | "sealer";

export type PaintProduct = {
  id: string;
  brand: string;
  role: PaintRole;
  name: string;
  unit: "L" | "kg";
  /** Reference pack size and the area it covers for ONE coat. */
  refPackSize: number;
  coveragePerPack: number;
  /** Surface factor (e.g. 0.85 for rough surfaces); default 1. */
  surfaceFactor?: number;
  packs: PackOption[];
  colourSpecific: boolean;
  wastePercent?: number;
};

/** Resolves the product for a role, preferring the chosen brand (equivalence groups). */
export function resolveProduct(products: PaintProduct[], role: PaintRole, brand?: string): PaintProduct | undefined {
  return products.find((p) => p.role === role && p.brand === brand) ?? products.find((p) => p.role === role);
}

const ROLE_LABEL: Record<PaintRole, string> = {
  putty: "معجون",
  primer: "أساس (برايمر)",
  wall_finish: "دهان جدران",
  ceiling_paint: "دهان أسقف",
  moisture: "دهان مقاوم للرطوبة",
  decorative: "دهان ديكوري",
  ext_primer: "أساس خارجي",
  ext_putty: "معجون خارجي",
  acrylic: "أكريليك خارجي",
  profile: "بروفايل / تكسير",
  spray_acrylic: "أكريليك رش",
  sealer: "عازل إسمنتي",
};

type Share = Record<string, number>;

function normalise(parts: Share): { workType: string; allocation?: Share } {
  const total = sum(Object.values(parts));
  const keys = Object.keys(parts).filter((k) => parts[k] > 0);
  const workType = Object.entries(parts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "walls";
  if (total <= 0 || keys.length <= 1) return { workType };
  return { workType, allocation: Object.fromEntries(keys.map((k) => [k, parts[k] / total])) };
}

/**
 * One product line: need = Σ(area × coats) ÷ (coverage per unit × surface factor) × (1 + waste),
 * bought as the cheapest pack combination. `parts` = m²-coats per work type (for cost split).
 */
function productLine(
  key: string,
  product: PaintProduct,
  parts: Share,
  defaultWaste: number,
  opts: { colour?: string; zone?: string; wasteOverride?: number } = {},
): Line | null {
  const areaCoats = sum(Object.values(parts));
  if (areaCoats <= 0) return null;
  const waste = opts.wasteOverride ?? product.wastePercent ?? defaultWaste;
  const coveragePerUnit = (product.coveragePerPack / product.refPackSize) * (product.surfaceFactor ?? 1);
  const need = (areaCoats / coveragePerUnit) * (1 + waste / 100);
  const packs = optimisePacks(need, product.packs);
  const { workType, allocation } = normalise(parts);
  return {
    key,
    group: "material",
    // the A.6 fallback products' "Generic" reads «عام» like any unbranded product (labels are Arabic)
    label: `${ROLE_LABEL[product.role]} — ${product.brand === GENERIC_DEFAULT_BRAND ? GENERIC_BRAND : product.brand}${opts.colour ? ` (${opts.colour})` : ""}`,
    productId: product.id,
    colour: opts.colour,
    zone: opts.zone,
    need: Math.round(need * 1000) / 1000,
    needUnit: product.unit,
    purchase: { kind: "packs", packs: packs.packs, volume: packs.volume, leftover: packs.leftover },
    qty: sum(packs.packs.map((x) => x.count)),
    unit: "pack",
    unitPrice: packs.packs.length === 1 ? packs.packs[0].price : 0,
    cost: packs.cost,
    formula: "area × coats ÷ (coverage per pack ÷ pack size × surface factor) × (1 + waste) → cheapest packs",
    inputs: {
      areaCoats: Math.round(areaCoats * 100) / 100,
      coveragePerPack: product.coveragePerPack,
      packSize: product.refPackSize,
      surfaceFactor: product.surfaceFactor ?? 1,
      waste,
    },
    workType,
    allocation,
  };
}

function sundryLine(key: string, label: string, need: number, perPack: number, price: number, parts: Share, formula: string): Line | null {
  if (need <= 0) return null;
  const qty = ceilInt(need / perPack);
  const { workType, allocation } = normalise(parts);
  return { key, group: "material", label, need: Math.round(need * 100) / 100, needUnit: "m2", purchase: { kind: "units", count: qty, perPack }, qty, unit: "pack", unitPrice: price, cost: qty * price, formula, inputs: { need, perPack }, workType, allocation };
}

function labourLine(key: string, label: string, qty: number, rate: number, workType: string, unit = "m2"): Line | null {
  if (qty <= 0 || rate <= 0) return null;
  return { key, group: "labour", label, need: qty, needUnit: unit, purchase: { kind: "units", count: qty }, qty, unit, unitPrice: rate, cost: qty * rate, formula: `${unit} × rate`, inputs: { qty, rate }, workType };
}

/**
 * An included item with no usable product: kept as a visible zero-cost line
 * (never silently dropped) so the owner sees what to complete.
 */
function missingLine(role: PaintRole, workType: string): Line {
  return {
    key: `missing_${role}`,
    group: "material",
    label: `${ROLE_LABEL[role]} — لا يوجد منتج مكتمل`,
    need: 0,
    needUnit: "",
    purchase: { kind: "units", count: 0 },
    qty: 0,
    unit: "pack",
    unitPrice: 0,
    cost: 0,
    formula: "no complete product for this line (needs pack size, coverage and price)",
    inputs: { role },
    workType,
  };
}

/** Splits an area equally over N colours, e.g. 530 m² / 2 → [265, 265]. */
function colourSplit(area: number, colours: number, names?: string[]): { colour: string; area: number }[] {
  const n = Math.max(1, Math.round(colours));
  return Array.from({ length: n }, (_, i) => ({ colour: names?.[i] ?? `لون ${i + 1}`, area: area / n }));
}

// --- Interior -----------------------------------------------------------------

export type InteriorZone = {
  id: string;
  kind: "wet" | "decorative" | "custom";
  wallArea: number;
  /** For custom zones: the finish product role and coats. */
  finishRole?: PaintRole;
  coats?: number;
};

export type InteriorInput = {
  wallArea: number;
  ceilingArea: number;
  zones?: InteriorZone[];
  colours: number;
  colourNames?: string[];
  /** Ceilings can have their own colour(s) — not necessarily white. Default 1. */
  ceilingColours?: number;
  ceilingColourNames?: string[];
  variant: "new" | "repaint";
  brand: string;
  crackM?: number;
  executeOnly?: boolean;
  /** What's included for this client (see scope.ts). Missing role = included. */
  scope?: Record<string, boolean>;
};

export type InteriorParams = {
  coats: { wallPutty: number; ceilingPutty: number; primer: number; wallFinish: number; ceilingPaint: number; moisture: number; sealer?: number; primerCeilings?: number };
  repaintSpotPercent: number;
  wastePercent: number;
  sandpaper: { coveragePerCoat: number; price: number };
  nylon: { area: number; price: number };
  tape: { area: number; price: number };
  consumablesPerM2: number;
  crackMaterial: { metresPerPack: number; price: number };
  labour: { wallsFull: number; ceilingsFull: number; repaint: number; decorativeExtra: number; cracksPerM: number };
};

export function computeInterior(input: InteriorInput, products: PaintProduct[], p: InteriorParams): EngineResult {
  const lines: (Line | null)[] = [];
  const warnings: string[] = [];
  const get = (role: PaintRole) => {
    const prod = resolveProduct(products, role, input.brand);
    if (!prod) {
      warnings.push(`missing_product_${role}`);
      lines.push(missingLine(role, role === "ceiling_paint" ? "ceilings" : "walls"));
    } else if (prod.brand !== input.brand) warnings.push(`brand_fallback_${role}`);
    return prod;
  };
  const walls = input.wallArea;
  const ceilings = input.ceilingArea;
  const zones = input.zones ?? [];
  const zoneWalls = sum(zones.map((z) => z.wallArea));
  const baseWalls = Math.max(0, walls - zoneWalls);
  if (zoneWalls > walls) warnings.push("zones_exceed_walls");
  const spot = input.variant === "repaint" ? p.repaintSpotPercent / 100 : 1;
  const inc = (role: string) => input.scope?.[role] !== false;

  if (!input.executeOnly) {
    const putty = inc("putty") ? get("putty") : undefined;
    if (putty) {
      lines.push(
        productLine("putty", putty, { walls: walls * p.coats.wallPutty * spot, ceilings: ceilings * p.coats.ceilingPutty * spot }, p.wastePercent),
      );
    }
    // Cement-based sealer on walls before painting — only when the client needs it.
    if (input.scope?.sealer === true) {
      const sealer = get("sealer");
      if (sealer) lines.push(productLine("sealer", sealer, { walls: walls * (p.coats.sealer ?? 1) }, p.wastePercent));
    }
    const primer = inc("primer") ? get("primer") : undefined;
    if (primer) lines.push(productLine("primer", primer, { walls: walls * p.coats.primer * spot, ceilings: ceilings * (p.coats.primerCeilings ?? p.coats.primer) * spot }, p.wastePercent));

    const finish = inc("wall_finish") ? get("wall_finish") : undefined;
    if (finish) {
      for (const c of colourSplit(baseWalls, finish.colourSpecific ? input.colours : 1, input.colourNames)) {
        lines.push(productLine(`wall_finish_${c.colour}`, finish, { walls: c.area * p.coats.wallFinish }, p.wastePercent, { colour: finish.colourSpecific ? c.colour : undefined }));
      }
    }
    const ceilingPaint = inc("ceiling_paint") ? get("ceiling_paint") : undefined;
    if (ceilingPaint) {
      const n = ceilingPaint.colourSpecific ? (input.ceilingColours ?? 1) : 1;
      for (const c of colourSplit(ceilings, n, input.ceilingColourNames)) {
        const key = n > 1 ? `ceiling_paint_${c.colour}` : "ceiling_paint";
        lines.push(productLine(key, ceilingPaint, { ceilings: c.area * p.coats.ceilingPaint }, p.wastePercent, { colour: n > 1 || input.ceilingColourNames ? c.colour : undefined }));
      }
    }

    for (const z of zones) {
      const role: PaintRole = z.kind === "wet" ? "moisture" : z.kind === "decorative" ? "decorative" : (z.finishRole ?? "wall_finish");
      if (!inc(role)) continue;
      const prod = get(role);
      if (!prod) continue;
      const coats = z.coats ?? (z.kind === "wet" ? p.coats.moisture : z.kind === "decorative" ? 1 : p.coats.wallFinish);
      lines.push(productLine(`zone_${z.id}`, prod, { walls: z.wallArea * coats }, p.wastePercent, { zone: z.id }));
    }

    const puttyCoats = { walls: walls * p.coats.wallPutty * spot, ceilings: ceilings * p.coats.ceilingPutty * spot };
    if (putty && inc("sandpaper")) lines.push(sundryLine("sandpaper", "ورق صنفرة", sum(Object.values(puttyCoats)), p.sandpaper.coveragePerCoat, p.sandpaper.price, puttyCoats, "putty m²-coats ÷ coverage per pack"));
    if (inc("floor_nylon")) lines.push(sundryLine("nylon", "نايلون حماية أرضيات", ceilings, p.nylon.area, p.nylon.price, { ceilings }, "≈ ceiling area ÷ roll area"));
    if (inc("masking_tape")) lines.push(sundryLine("masking_tape", "شريط لاصق", walls + ceilings, p.tape.area, p.tape.price, { walls, ceilings }, "painted m² ÷ m² per roll"));
    if (p.consumablesPerM2 > 0 && walls + ceilings > 0) {
      const { workType, allocation } = normalise({ walls, ceilings });
      const amt = (walls + ceilings) * p.consumablesPerM2;
      lines.push({ key: "consumables", group: "material", label: "مستهلكات (رولات، فرش…)", need: walls + ceilings, needUnit: "m2", purchase: { kind: "units", count: 1 }, qty: walls + ceilings, unit: "m2", unitPrice: p.consumablesPerM2, cost: amt, formula: "painted m² × cost per m²", inputs: { area: walls + ceilings, perM2: p.consumablesPerM2 }, workType, allocation });
    }
    if (input.crackM) {
      lines.push(sundryLine("crack_material", "مادة معالجة الشقوق", input.crackM, p.crackMaterial.metresPerPack, p.crackMaterial.price, { walls: input.crackM }, "crack m ÷ m per pack"));
    }
  }

  if (input.variant === "new") {
    lines.push(labourLine("labour_walls", "مصنعية دهان جدران", walls, p.labour.wallsFull, "walls"));
    lines.push(labourLine("labour_ceilings", "مصنعية دهان أسقف", ceilings, p.labour.ceilingsFull, "ceilings"));
  } else {
    lines.push(labourLine("labour_walls", "مصنعية إعادة دهان جدران", walls, p.labour.repaint, "walls"));
    lines.push(labourLine("labour_ceilings", "مصنعية إعادة دهان أسقف", ceilings, p.labour.repaint, "ceilings"));
  }
  const decorative = sum(zones.filter((z) => z.kind === "decorative").map((z) => z.wallArea));
  lines.push(labourLine("labour_decorative", "إضافة مصنعية ديكوري", decorative, p.labour.decorativeExtra, "walls"));
  if (input.crackM) lines.push(labourLine("labour_cracks", "مصنعية معالجة الشقوق", input.crackM, p.labour.cracksPerM, "walls", "m"));

  return { lines: lines.filter((l): l is Line => l !== null), areas: { walls, ceilings }, status: "measured", warnings };
}

// --- Exterior -----------------------------------------------------------------

export type ExteriorInput = {
  area: number;
  method: "roller" | "profile" | "spray";
  colours: number;
  colourNames?: string[];
  brand: string;
  scaffoldDays?: number;
  executeOnly?: boolean;
  /** What's included for this client (see scope.ts). Missing role = included. */
  scope?: Record<string, boolean>;
};

export type ExteriorParams = {
  coats: { primer: number; putty: number; finish: number };
  wastePercent: number;
  sprayWastePercent: number;
  labour: { application: number; sandingPutty: number; spray: number };
  scaffoldPerDay: number;
  protection: { perM2: number };
};

export function computeExterior(input: ExteriorInput, products: PaintProduct[], p: ExteriorParams): EngineResult {
  const lines: (Line | null)[] = [];
  const warnings: string[] = [];
  const area = input.area;
  const get = (role: PaintRole) => {
    const prod = resolveProduct(products, role, input.brand);
    if (!prod) {
      warnings.push(`missing_product_${role}`);
      lines.push(missingLine(role, "facades"));
    }
    return prod;
  };
  const inc = (role: string) => input.scope?.[role] !== false;
  const withPutty = inc("ext_putty");
  if (!input.executeOnly) {
    if (input.scope?.sealer === true) {
      const sealer = get("sealer");
      if (sealer) lines.push(productLine("sealer", sealer, { facades: area }, p.wastePercent));
    }
    const primer = inc("ext_primer") ? get("ext_primer") : undefined;
    if (primer) lines.push(productLine("ext_primer", primer, { facades: area * p.coats.primer }, p.wastePercent));
    const putty = withPutty ? get("ext_putty") : undefined;
    if (putty) lines.push(productLine("ext_putty", putty, { facades: area * p.coats.putty }, p.wastePercent));
    const role: PaintRole = input.method === "spray" ? "spray_acrylic" : input.method === "profile" ? "profile" : "acrylic";
    const finish = inc(role) ? get(role) : undefined;
    if (finish) {
      const waste = input.method === "spray" ? p.sprayWastePercent : undefined;
      for (const c of colourSplit(area, finish.colourSpecific ? input.colours : 1, input.colourNames)) {
        lines.push(productLine(`ext_finish_${c.colour}`, finish, { facades: c.area * p.coats.finish }, p.wastePercent, { colour: finish.colourSpecific ? c.colour : undefined, wasteOverride: waste }));
      }
    }
    if (inc("protection") && p.protection.perM2 > 0 && area > 0) {
      lines.push({ key: "protection", group: "material", label: "حماية (شريط، نايلون، نوافذ وأبواب)", need: area, needUnit: "m2", purchase: { kind: "units", count: 1 }, qty: area, unit: "m2", unitPrice: p.protection.perM2, cost: area * p.protection.perM2, formula: "façade m² × cost per m²", inputs: { area }, workType: "facades" });
    }
  }
  if (withPutty) lines.push(labourLine("labour_sanding_putty", "مصنعية صنفرة ومعجون", area, p.labour.sandingPutty, "facades"));
  lines.push(
    input.method === "spray"
      ? labourLine("labour_spray", "مصنعية رش", area, p.labour.spray, "facades")
      : labourLine("labour_application", "مصنعية دهان", area, p.labour.application, "facades"),
  );
  if (input.scaffoldDays) {
    lines.push({ key: "scaffolding", group: "extra", label: "سقالات / رافعة", need: input.scaffoldDays, needUnit: "day", purchase: { kind: "units", count: input.scaffoldDays }, qty: input.scaffoldDays, unit: "day", unitPrice: p.scaffoldPerDay, cost: input.scaffoldDays * p.scaffoldPerDay, formula: "days × daily rental", inputs: { days: input.scaffoldDays }, workType: "facades" });
  }
  return { lines: lines.filter((l): l is Line => l !== null), areas: { facades: area }, status: "measured", warnings };
}
