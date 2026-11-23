/**
 * Pricing by steps — the owner's model (agreed Nov 2026):
 *
 *   MATERIALS  (product once → brands → packs & prices)       src/lib/catalogue
 *   TEMPLATE   (per service: default choices + rates)          this file: defaults
 *   PRICING    (per client: every step chosen — product, brand, coats; labour source)
 *
 * One rule: a step is priced exactly as chosen. If something chosen can't be
 * priced, it is shown with its reason — never dropped silently.
 *
 * Pure: no I/O. The engine (src/lib/engine) does the quantity maths.
 */
import {
  buildEngineConfig,
  computeExterior,
  computeGypsum,
  computeInterior,
  priceProject,
  type CatalogueData,
  type CatalogueProduct,
  type EngineResult,
  type Line,
  type PriceSummary,
} from "@/lib/engine";

export type ServiceKind = "gypsum" | "interior" | "exterior";
export const SERVICE_KINDS: ServiceKind[] = ["gypsum", "interior", "exterior"];

/** A coat count asked per surface (walls / ceilings / façades / wet…). */
export type CoatSlot = { key: string; rateKey?: string; fallback: number; max: number };

export type StepDef = {
  key: string;
  /** Roles a product for this step can fill (first = the one priced). */
  roles: string[];
  /** Brand-only step: one brand choice for several parts (e.g. all metal profiles). */
  brandOnly?: boolean;
  coats?: CoatSlot[];
  /** Optional step without coats (on / off). */
  toggle?: boolean;
  defaultOn?: boolean;
  /** Only shown when this returns true. */
  when?: (o: Options) => boolean;
};

export type Options = {
  method: "roller" | "profile" | "spray";
  variant: "new" | "repaint";
  suspension: "rod" | "vertical_c";
  layers: number;
  hangingHeight: number; // m
  cSpacing: number; // m
  omegaSpacing: number; // m
  /** §3.5: labour + materials | labour only (client supplies materials) | materials supply only. */
  projectType?: "full" | "labour" | "supply";
};

export const EXTERIOR_FINISH_ROLE: Record<Options["method"], string> = { roller: "acrylic", profile: "profile", spray: "spray_acrylic" };

const METAL = ["c_channel", "omega", "rod", "vertical_hanger", "edge_angle", "trough_angle", "shadow", "stud", "track"];
const FIXINGS = ["washers", "anchors", "clips", "angle_screws", "board_screws"];

export const STEPS: Record<ServiceKind, StepDef[]> = {
  interior: [
    { key: "putty", roles: ["putty"], coats: [{ key: "walls", rateKey: "interior.coats.wallPutty", fallback: 2, max: 3 }, { key: "ceilings", rateKey: "interior.coats.ceilingPutty", fallback: 1, max: 3 }] },
    { key: "sealer", roles: ["sealer"], coats: [{ key: "walls", fallback: 0, max: 3 }] },
    { key: "primer", roles: ["primer"], coats: [{ key: "walls", rateKey: "interior.coats.primer", fallback: 1, max: 3 }, { key: "ceilings", rateKey: "interior.coats.primer", fallback: 1, max: 3 }] },
    { key: "wall_finish", roles: ["wall_finish"], coats: [{ key: "walls", rateKey: "interior.coats.wallFinish", fallback: 2, max: 3 }] },
    { key: "ceiling_paint", roles: ["ceiling_paint"], coats: [{ key: "ceilings", rateKey: "interior.coats.ceilingPaint", fallback: 2, max: 3 }] },
    { key: "moisture", roles: ["moisture"], coats: [{ key: "wet", rateKey: "interior.coats.moisture", fallback: 2, max: 3 }] },
    { key: "decorative", roles: ["decorative"], toggle: true, defaultOn: true },
    { key: "sandpaper", roles: ["sandpaper"], toggle: true, defaultOn: true },
    { key: "floor_nylon", roles: ["floor_nylon"], toggle: true, defaultOn: true },
    { key: "masking_tape", roles: ["masking_tape"], toggle: true, defaultOn: true },
  ],
  exterior: [
    { key: "sealer", roles: ["sealer"], coats: [{ key: "facades", fallback: 0, max: 3 }] },
    { key: "primer", roles: ["ext_primer"], coats: [{ key: "facades", rateKey: "exterior.coats.primer", fallback: 1, max: 3 }] },
    { key: "putty", roles: ["ext_putty"], coats: [{ key: "facades", rateKey: "exterior.coats.putty", fallback: 1, max: 3 }], when: (o) => o.method !== "profile" },
    { key: "finish_roller", roles: ["acrylic"], coats: [{ key: "facades", rateKey: "exterior.coats.finish", fallback: 2, max: 3 }], when: (o) => o.method === "roller" },
    { key: "finish_profile", roles: ["profile"], coats: [{ key: "facades", rateKey: "exterior.coats.finish", fallback: 1, max: 3 }], when: (o) => o.method === "profile" },
    { key: "finish_spray", roles: ["spray_acrylic"], coats: [{ key: "facades", rateKey: "exterior.coats.finish", fallback: 2, max: 3 }], when: (o) => o.method === "spray" },
  ],
  gypsum: [
    { key: "board_normal", roles: ["board_normal"] },
    { key: "board_moisture", roles: ["board_moisture"] },
    { key: "board_fire", roles: ["board_fire"] },
    { key: "metal", roles: METAL, brandOnly: true },
    { key: "fixings", roles: FIXINGS, brandOnly: true },
    { key: "joint_tape", roles: ["joint_tape"] },
    { key: "joint_compound", roles: ["joint_compound"] },
    { key: "insulation", roles: ["insulation"], toggle: true, defaultOn: false },
  ],
};

export type StepChoice = { lineId: string | null; brand: string | null; coats: Record<string, number>; on: boolean };

export type Labour =
  | { source: "rates" }
  | { source: "external"; externalId: string | null }
  | { source: "inhouse"; crew: string[] };

export type Selection = {
  kind: ServiceKind;
  options: Options;
  steps: Record<string, StepChoice>;
  /** Gypsum parts the client supplies or doesn't need (roles). */
  excluded: string[];
  labour: Labour;
  marginPercent: number | null;
  /** Risk reserve on cost (null = the template / A.6 default, 5 %). */
  contingencyPercent?: number | null;
};

export type Quantities = {
  // gypsum
  ceilNormal: number;
  ceilMoisture: number;
  ceilFire: number;
  partitions: number;
  troughM: number;
  shadowM: number;
  hatches: Record<string, number>;
  // interior
  walls: number;
  ceilings: number;
  wet: number;
  decorative: number;
  colours: number;
  ceilingColours: number;
  crackM: number;
  /** Measured gypsum rooms (real dimensions) — used instead of total ceiling areas when present. */
  gypsumRooms?: { id: string; name: string; L: number; W: number; boardType: "normal" | "moisture" | "fire" }[];
  // exterior
  facade: number;
  extColours: number;
  scaffoldDays: number;
};

export const EMPTY_QUANTITIES: Quantities = {
  ceilNormal: 0, ceilMoisture: 0, ceilFire: 0, partitions: 0, troughM: 0, shadowM: 0, hatches: {},
  walls: 0, ceilings: 0, wet: 0, decorative: 0, colours: 1, ceilingColours: 1, crackM: 0,
  facade: 0, extColours: 1, scaffoldDays: 0,
};

/** Standard choices offered as buttons (owner: "خيارات متعارف عليها"). */
export const PRESETS = {
  hatches: ["30x30", "40x40", "50x50", "60x60", "60x120"],
  hangingHeight: [0.2, 0.4, 0.6, 0.8, 1.0],
  cSpacing: [0.6, 0.8, 1.0, 1.2],
  omegaSpacing: [0.3, 0.4, 0.5, 0.6],
  layers: [1, 2],
};

export type ExternalLabour = { id: string; name: string; service: ServiceKind | null; basis: "external_per_unit" | "external_lump"; rate: number };
export type CrewMember = { id: string; name: string; job: string | null; perDay: number | null };

export type PricingContext = {
  catalogue: CatalogueData;
  external: ExternalLabour[];
  crew: CrewMember[];
  /** in-house teams (Schedule) → one tap picks their members as the crew */
  teams?: { id: string; name: string; members: string[] }[];
  vatPercent: number;
};

const productsFor = (c: CatalogueData, role: string) => c.products.filter((p) => p.role === role);
const priced = (p: CatalogueProduct) => p.packs.some((k) => k.price != null && k.price > 0);

/** Product lines a step can use (for the "which product" choice). */
export function stepLines(c: CatalogueData, step: StepDef): { lineId: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const p of productsFor(c, step.roles[0])) if (p.lineId && !seen.has(p.lineId)) seen.set(p.lineId, p.name);
  return [...seen].map(([lineId, name]) => ({ lineId, name }));
}

/** Brands available for a step (in its chosen product line). */
export function stepBrands(c: CatalogueData, step: StepDef, lineId: string | null): (string | null)[] {
  const roles = step.brandOnly ? step.roles : [step.roles[0]];
  const set = new Set<string | null>();
  for (const role of roles) for (const p of productsFor(c, role)) if (!lineId || step.brandOnly || p.lineId === lineId) set.add(p.brand);
  return [...set];
}

/** The template's default choices, falling back to the first complete product of each step. */
export function defaultSelection(kind: ServiceKind, c: CatalogueData, template?: Partial<Selection> | null): Selection {
  const options: Options = {
    method: "roller", variant: "new", suspension: "rod", layers: 1, projectType: "full",
    hangingHeight: c.rates["gypsum.hangingHeight"] ?? 0.4,
    cSpacing: c.rates["gypsum.cSpacing"] ?? 1,
    omegaSpacing: c.rates["gypsum.omegaSpacing"] ?? 0.4,
    ...(template?.options ?? {}),
  };
  const steps: Record<string, StepChoice> = {};
  for (const s of STEPS[kind]) {
    const saved = template?.steps?.[s.key];
    const best = productsFor(c, s.roles[0]).find(priced) ?? productsFor(c, s.roles[0])[0];
    steps[s.key] = {
      lineId: saved?.lineId ?? best?.lineId ?? null,
      brand: saved?.brand !== undefined ? saved.brand : (best?.brand ?? null),
      coats: Object.fromEntries((s.coats ?? []).map((k) => [k.key, saved?.coats?.[k.key] ?? (k.rateKey ? (c.rates[k.rateKey] ?? k.fallback) : k.fallback)])),
      on: saved?.on ?? (s.toggle ? (s.defaultOn ?? true) : true),
    };
  }
  return {
    kind,
    options,
    steps,
    excluded: template?.excluded ?? [],
    labour: template?.labour ?? { source: "rates" },
    marginPercent: template?.marginPercent ?? null,
    contingencyPercent: template?.contingencyPercent ?? null,
  };
}

/** The product actually used for a role, given the step choice. */
function choose(c: CatalogueData, role: string, step: StepDef, choice: StepChoice): CatalogueProduct | undefined {
  let list = productsFor(c, role);
  if (!step.brandOnly && choice.lineId) list = list.filter((p) => p.lineId === choice.lineId);
  return (
    list.find((p) => p.brand === choice.brand && priced(p)) ??
    list.find((p) => p.brand === choice.brand) ??
    list.find(priced) ??
    list[0]
  );
}

export type StepResult = {
  key: string;
  /** What is used — or why nothing can be priced. */
  used: { role: string; product: CatalogueProduct | null }[];
  included: boolean;
};

export type PricingOutcome = {
  result: EngineResult;
  price: PriceSummary;
  steps: StepResult[];
  /** Included roles with no usable product (shown as red lines). */
  problems: { step: string; role: string; reason: "no_product" | "incomplete" | "no_price"; product?: string }[];
  labourNote: string | null;
};

const MAIN_LABOUR: Record<ServiceKind, string[]> = {
  gypsum: ["labour_ceilings", "labour_partitions"],
  interior: ["labour_walls", "labour_ceilings"],
  exterior: ["labour_application", "labour_spray", "labour_sanding_putty"],
};

/** Prices one service for one client, exactly as chosen. */
export function priceSelection(sel: Selection, q: Quantities, ctx: PricingContext): PricingOutcome {
  const c = ctx.catalogue;
  const defs = STEPS[sel.kind].filter((s) => !s.when || s.when(sel.options));
  const chosen: CatalogueProduct[] = [];
  const steps: StepResult[] = [];
  const problems: PricingOutcome["problems"] = [];
  const scope: Record<string, boolean> = {};

  for (const s of defs) {
    const choice = sel.steps[s.key] ?? { lineId: null, brand: null, coats: {}, on: true };
    const coatsTotal = s.coats ? s.coats.reduce((a, k) => a + (choice.coats[k.key] ?? 0), 0) : 1;
    const included = choice.on && coatsTotal > 0;
    const used: StepResult["used"] = [];
    for (const role of s.brandOnly ? s.roles : [s.roles[0]]) {
      const excluded = sel.excluded.includes(role);
      scope[role] = included && !excluded;
      if (!scope[role]) continue;
      const p = choose(c, role, s, choice) ?? null;
      used.push({ role, product: p });
      if (p) chosen.push(p);
    }
    steps.push({ key: s.key, used, included });
  }

  // Steps hidden for these options (e.g. exterior putty with the profile method) are not priced.
  for (const s of STEPS[sel.kind]) if (!defs.includes(s)) for (const role of s.roles) if (!(role in scope)) scope[role] = false;

  // Products not covered by any step (e.g. hatches, crack material) keep the catalogue's choice.
  const coveredRoles = new Set(defs.flatMap((s) => s.roles));
  for (const p of c.products) if (p.role && !coveredRoles.has(p.role)) chosen.push(p);

  const cfg = buildEngineConfig({ products: chosen, rates: c.rates });
  const coat = (step: string, slot: string, fallback = 0) => sel.steps[step]?.coats?.[slot] ?? fallback;

  // Report every included part the engine can't price, with the reason.
  for (const s of steps) {
    for (const u of s.used) {
      const w = cfg.warnings.find((x) => (x.kind === "missing_data" || x.kind === "missing_price" || x.kind === "missing_product") && x.role === u.role);
      if (!u.product) problems.push({ step: s.key, role: u.role, reason: "no_product" });
      else if (w?.kind === "missing_data") problems.push({ step: s.key, role: u.role, reason: w.fields.includes("coverage") || w.fields.includes("pack") ? "incomplete" : "no_price", product: u.product.name });
      else if (w?.kind === "missing_price" || !priced(u.product)) problems.push({ step: s.key, role: u.role, reason: "no_price", product: u.product.name });
    }
  }

  let result: EngineResult;
  const o = sel.options;
  if (sel.kind === "interior") {
    const zones = [
      ...(q.wet > 0 ? [{ id: "wet", kind: "wet" as const, wallArea: q.wet, coats: coat("moisture", "wet", 2) }] : []),
      ...(q.decorative > 0 ? [{ id: "decorative", kind: "decorative" as const, wallArea: q.decorative }] : []),
    ];
    result = computeInterior(
      {
        wallArea: q.walls, ceilingArea: q.ceilings, zones, colours: Math.max(1, q.colours), ceilingColours: Math.max(1, q.ceilingColours),
        variant: o.variant, executeOnly: o.projectType === "labour", brand: chosen.find((p) => p.role === "wall_finish")?.brand ?? "", crackM: q.crackM, scope,
      },
      cfg.paintProducts,
      {
        ...cfg.interior,
        coats: {
          ...cfg.interior.coats,
          wallPutty: coat("putty", "walls"), ceilingPutty: coat("putty", "ceilings"),
          primer: coat("primer", "walls"), primerCeilings: coat("primer", "ceilings"),
          wallFinish: coat("wall_finish", "walls"), ceilingPaint: coat("ceiling_paint", "ceilings"),
          moisture: coat("moisture", "wet", 2), sealer: coat("sealer", "walls"),
        },
      },
    );
  } else if (sel.kind === "exterior") {
    const finishStep = `finish_${o.method}`;
    result = computeExterior(
      {
        area: q.facade, method: o.method, executeOnly: o.projectType === "labour", colours: Math.max(1, q.extColours), brand: chosen.find((p) => p.role === EXTERIOR_FINISH_ROLE[o.method])?.brand ?? "",
        scaffoldDays: q.scaffoldDays, scope: { ...scope, sealer: coat("sealer", "facades") > 0 },
      },
      cfg.paintProducts,
      { ...cfg.exterior, coats: { primer: coat("primer", "facades"), putty: coat("putty", "facades"), finish: coat(finishStep, "facades") } },
    );
  } else {
    result = computeGypsum(
      {
        ...(q.gypsumRooms?.length ? { rooms: q.gypsumRooms } : { quickAreas: { normal: q.ceilNormal, moisture: q.ceilMoisture, fire: q.ceilFire } }),
        partitions: q.partitions > 0 ? [{ id: "p", area: q.partitions, boardType: "normal", layersPerFace: 1, insulation: !!sel.steps.insulation?.on }] : [],
        troughM: q.troughM, shadowM: q.shadowM, hatches: q.hatches, scope, executeOnly: o.projectType === "labour",
      },
      cfg.gypsum.catalogue,
      { ...cfg.gypsum.params, suspension: o.suspension, layers: Math.max(1, o.layers), hangingHeight: o.hangingHeight, cSpacing: o.cSpacing, omegaSpacing: o.omegaSpacing },
    );
  }

  // Gypsum parts are only a problem when this job actually needs them
  // (no vertical hangers with rod suspension, no studs without partitions…).
  if (sel.kind === "gypsum") {
    const LINE_ROLE: Record<string, string> = { studs: "stud", tracks: "track", vertical_c: "vertical_hanger" };
    const needed = new Set(result.lines.map((l) => LINE_ROLE[l.key] ?? l.key));
    for (let i = problems.length - 1; i >= 0; i--) if (!needed.has(problems[i].role)) problems.splice(i, 1);
  }

  // Labour only: the client supplies the materials — nothing to price or report for them.
  if (o.projectType === "labour") problems.length = 0;

  // We chose every product explicitly — brand "fallback" notes don't apply.
  result = { ...result, warnings: result.warnings.filter((w) => !w.startsWith("brand_fallback_")) };

  // Labour: our own team, an external contractor, or the template rates.
  const applied = applyLabour(sel, result, ctx, c.rates);
  const note = o.projectType === "supply" ? null : applied.note;
  // Supply only: no labour.
  const withLabour = o.projectType === "supply" ? { ...applied.result, lines: applied.result.lines.filter((l) => l.group !== "labour") } : applied.result;

  const price = priceProject([withLabour], {
    contingencyPercent: sel.contingencyPercent ?? cfg.commercial.contingencyPercent,
    marginPercent: Math.min(95, sel.marginPercent ?? cfg.commercial.targetMarginPercent),
    roundingStep: cfg.commercial.roundingStep,
    method: "unit",
    vatPercent: ctx.vatPercent,
  });
  return { result: withLabour, price, steps, problems, labourNote: note };
}

function applyLabour(sel: Selection, r: EngineResult, ctx: PricingContext, rates: Record<string, number>): { result: EngineResult; note: string | null } {
  if (sel.labour.source === "rates") return { result: r, note: null };
  const main = new Set(MAIN_LABOUR[sel.kind]);
  const areas = Object.entries(r.areas).filter(([, a]) => a > 0);
  const total = areas.reduce((s, [, a]) => s + a, 0);
  if (total <= 0) return { result: r, note: null };
  const keep = r.lines.filter((l) => !(l.group === "labour" && main.has(l.key)));
  const add: Line[] = [];

  if (sel.labour.source === "external") {
    const ext = ctx.external.find((e) => e.id === (sel.labour as { externalId: string | null }).externalId);
    if (!ext) return { result: r, note: "external_missing" };
    for (const [wt, a] of areas) {
      const cost = ext.basis === "external_per_unit" ? a * ext.rate : (ext.rate * a) / total;
      add.push({
        key: `labour_ext_${wt}`, group: "labour", label: `مصنعية — ${ext.name}`, need: a, needUnit: "m2",
        purchase: { kind: "units", count: a }, qty: ext.basis === "external_per_unit" ? a : 1, unit: ext.basis === "external_per_unit" ? "m2" : "lump",
        unitPrice: ext.basis === "external_per_unit" ? ext.rate : (ext.rate * a) / total, cost,
        formula: ext.basis === "external_per_unit" ? "area × contractor rate per m²" : "contractor lump sum split by area",
        inputs: { area: a, rate: ext.rate }, workType: wt,
      });
    }
    return { result: { ...r, lines: [...keep, ...add] }, note: null };
  }

  // In-house: days = area ÷ team productivity; cost = days × the crew's fully loaded daily cost.
  const crew = ctx.crew.filter((m) => (sel.labour as { crew: string[] }).crew.includes(m.id));
  if (!crew.length) return { result: r, note: "crew_empty" };
  if (crew.some((m) => m.perDay == null)) return { result: r, note: "crew_no_cost" };
  const daily = crew.reduce((s, m) => s + (m.perDay ?? 0), 0);
  const productivity = rates[`${sel.kind}.productivity`] ?? (sel.kind === "gypsum" ? 40 : sel.kind === "interior" ? 120 : 100);
  const days = total / productivity;
  for (const [wt, a] of areas) {
    const share = a / total;
    add.push({
      key: `labour_team_${wt}`, group: "labour", label: `مصنعية فريقنا (${crew.length} × ${Math.round(days * 10) / 10} يوم)`, need: days * share, needUnit: "day",
      purchase: { kind: "units", count: days * share }, qty: Math.round(days * share * 100) / 100, unit: "day", unitPrice: daily, cost: days * share * daily,
      formula: "area ÷ team productivity (m²/day) × crew daily cost", inputs: { area: a, productivity, crew: crew.length, dailyCost: Math.round(daily * 100) / 100 }, workType: wt,
    });
  }
  return { result: { ...r, lines: [...keep, ...add] }, note: null };
}
