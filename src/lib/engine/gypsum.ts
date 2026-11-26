import { cutIdentical, cutToBars, type CutResult } from "./cutting";
import { ceilInt, sum } from "./math";
import type { EngineResult, Line } from "./types";

/**
 * Gypsum board engine (Appendix A.4): ceilings per room from real
 * dimensions, partitions, light troughs, shadow gaps, hatches.
 */

export type BoardType = "normal" | "moisture" | "fire";

export type Bar = { productId?: string; length: number; price: number };
export type Box = { productId?: string; count: number; price: number };

export type GypsumCatalogue = {
  boards: Record<BoardType, { productId?: string; area: number; price: number }>;
  cChannel: Bar;
  omega: Bar;
  rod: Bar;
  verticalHanger: Bar;
  edgeAngle: Bar;
  troughAngle: Bar;
  shadow: Bar;
  stud: Bar;
  track: Bar;
  washers: Box;
  anchors: Box;
  clips: Box;
  angleScrews: Box;
  boardScrews: Box;
  tape: { productId?: string; length: number; price: number };
  compound: { productId?: string; kg: number; price: number };
  insulationPerM2: number;
  hatches: Record<string, number>; // size label → supply + install price
  labour: { ceilingsPerM2: number; partitionsPerM2: number; extraLayerPerM2: number; troughPerM: number; shadowPerM: number };
};

export type GypsumParams = {
  cSpacing: number; // m
  omegaSpacing: number; // m
  hangerSpacing: number; // m
  studSpacing: number; // m
  partitionHeight: number; // m
  hangingHeight: number; // m
  screwsPerM2PerLayer: number;
  tapePerM2: number; // m per m² finished
  compoundPerM2: number; // kg per m² finished
  angleScrewsPerM: number;
  perimeterFactor: number; // m perimeter per m² when unknown
  trough: { boardPerM: number; omegaPerM: number; protectionAnglePerM: number; hangersPerM: number };
  cutAllowance: number; // m per hanger
  wastePercent: number;
  suspension: "rod" | "vertical_c";
  layers: number;
};

import type { FramingRoom, GypsumFraming } from "./framing";

export type CeilingRoom = { id: string; name: string; L: number; W: number; boardType: BoardType; zone?: string; cAlong?: "length" | "width"; unit?: string | null };

/**
 * Grid lines across a span (owner, Nov 2026): channels and omegas are a square grid at one spacing;
 * the edge angle carries the ceiling at the walls, so the first line is one spacing from the wall and
 * none sits against it (lines at s, 2s … strictly inside). A strip narrower than the spacing still
 * gets one line.
 */
export function gridLines(span: number, spacing: number): number {
  if (span <= 0 || spacing <= 0) return 0;
  return Math.max(1, Math.ceil(span / spacing - 1e-9) - 1);
}

export type CeilingLayout = { cAlong: "length" | "width"; channels: number; omegas: number; channelLength: number; omegaLength: number; hangers: number };

/**
 * One room's grid, with the main channels along the side that costs less (metal by length at the bar
 * price + hangers with their rod, washers and anchor) — or along the side the owner chose.
 */
export function ceilingLayout(
  r: { L: number; W: number; cAlong?: "length" | "width" },
  p: Pick<GypsumParams, "cSpacing" | "omegaSpacing" | "hangerSpacing" | "hangingHeight" | "cutAllowance" | "suspension">,
  cat: Pick<GypsumCatalogue, "cChannel" | "omega" | "rod" | "verticalHanger" | "washers" | "anchors">,
): CeilingLayout {
  const build = (cAlong: "length" | "width"): CeilingLayout => {
    const [run, across] = cAlong === "length" ? [r.L, r.W] : [r.W, r.L];
    const channels = gridLines(across, p.cSpacing);
    const omegas = gridLines(run, p.omegaSpacing);
    return { cAlong, channels, omegas, channelLength: run, omegaLength: across, // the channel ends rest on the edge angle (owner, Nov 2026): hangers inside only, the first one spacing from the wall
      hangers: channels * gridLines(run, p.hangerSpacing) };
  };
  if (r.cAlong) return build(r.cAlong);
  const piece = p.hangingHeight + p.cutAllowance;
  const hangerCost =
    p.suspension === "rod"
      ? (piece / cat.rod.length) * cat.rod.price + cat.washers.price / cat.washers.count + cat.anchors.price / cat.anchors.count
      : (piece / cat.verticalHanger.length) * cat.verticalHanger.price + cat.anchors.price / cat.anchors.count;
  const cost = (l: CeilingLayout) =>
    ((l.channels * l.channelLength) / cat.cChannel.length) * cat.cChannel.price + ((l.omegas * l.omegaLength) / cat.omega.length) * cat.omega.price + l.hangers * hangerCost;
  const a = build("length");
  const b = build("width");
  return cost(b) < cost(a) - 1e-9 ? b : a;
}
export type Partition = { id: string; area?: number; length?: number; height?: number; boardType: BoardType; layersPerFace: number; insulation?: boolean };

export type GypsumInput = {
  rooms?: CeilingRoom[];
  /** Quick-estimate mode: total ceiling areas per board type (no dimensions). */
  quickAreas?: Partial<Record<BoardType, number>>;
  partitions?: Partition[];
  troughM?: number;
  shadowM?: number;
  hatches?: Record<string, number>;
  /** Zone overrides: e.g. { wet: { boardType: "moisture" } } */
  zoneOverrides?: Record<string, { boardType?: BoardType }>;
  executeOnly?: boolean;
  /** What's included for this client (see scope.ts). Missing role = included. */
  scope?: Record<string, boolean>;
};

const BOARD_LABEL: Record<BoardType, string> = { normal: "ألواح جبس عادي", moisture: "ألواح جبس مقاوم للرطوبة", fire: "ألواح جبس مقاوم للحريق" };

function barLine(key: string, label: string, bar: Bar, cut: CutResult, formula: string, inputs: Line["inputs"], workType: string): Line {
  return {
    key,
    group: "material",
    label,
    productId: bar.productId,
    need: Math.round(cut.usedLength * 100) / 100,
    needUnit: "m",
    purchase: { kind: "bars", bars: cut.bars, stockLength: cut.stockLength, offcuts: cut.offcuts },
    qty: cut.bars,
    unit: "bar",
    unitPrice: bar.price,
    cost: cut.bars * bar.price,
    formula,
    inputs,
    workType,
  };
}

function boxLine(key: string, label: string, box: Box, need: number, formula: string, inputs: Line["inputs"], workType: string, allocation?: Record<string, number>): Line {
  const qty = ceilInt(need / box.count);
  return {
    key,
    group: "material",
    label,
    productId: box.productId,
    need: Math.round(need * 100) / 100,
    needUnit: "pcs",
    purchase: { kind: "units", count: qty, perPack: box.count },
    qty,
    unit: "box",
    unitPrice: box.price,
    cost: qty * box.price,
    formula,
    inputs,
    workType,
    allocation,
  };
}

function shares(parts: Record<string, number>): Record<string, number> | undefined {
  const total = sum(Object.values(parts));
  const keys = Object.keys(parts).filter((k) => parts[k] > 0);
  if (total <= 0 || keys.length <= 1) return undefined;
  return Object.fromEntries(keys.map((k) => [k, parts[k] / total]));
}

function primaryOf(parts: Record<string, number>): string {
  return Object.entries(parts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "ceilings";
}

export function computeGypsum(input: GypsumInput, cat: GypsumCatalogue, p: GypsumParams): EngineResult & { framing?: GypsumFraming } {
  const lines: Line[] = [];
  const warnings: string[] = [];
  const w = 1 + p.wastePercent / 100;
  const layers = Math.max(1, p.layers);
  const materials = !input.executeOnly;

  // --- Ceilings -----------------------------------------------------------
  const rooms = (input.rooms ?? []).map((r) => ({
    ...r,
    boardType: (r.zone && input.zoneOverrides?.[r.zone]?.boardType) || r.boardType,
  }));
  const measured = rooms.length > 0;
  const areaByType: Record<BoardType, number> = { normal: 0, moisture: 0, fire: 0 };
  let ceilingArea = 0;
  let perimeter = 0;
  let hangers = 0;
  let clips = 0;
  const cRuns: number[] = [];
  const omegaRuns: number[] = [];
  const angleRuns: number[] = [];
  const layouts: FramingRoom[] = [];

  if (measured) {
    for (const r of rooms) {
      const area = r.L * r.W;
      ceilingArea += area;
      areaByType[r.boardType] += area;
      perimeter += 2 * (r.L + r.W);
      const g = ceilingLayout(r, p, cat);
      layouts.push({ id: r.id, name: r.name, unit: r.unit ?? null, L: r.L, W: r.W, ...g });
      for (let i = 0; i < g.channels; i++) cRuns.push(g.channelLength);
      for (let i = 0; i < g.omegas; i++) omegaRuns.push(g.omegaLength);
      hangers += g.hangers;
      clips += g.channels * g.omegas;
      angleRuns.push(r.L, r.L, r.W, r.W);
    }
  } else if (input.quickAreas) {
    for (const t of ["normal", "moisture", "fire"] as BoardType[]) areaByType[t] = input.quickAreas[t] ?? 0;
    ceilingArea = sum(Object.values(areaByType));
    perimeter = ceilingArea * p.perimeterFactor;
    cRuns.push(ceilingArea / p.cSpacing);
    omegaRuns.push(ceilingArea / p.omegaSpacing);
    hangers = ceilInt(ceilingArea / (p.cSpacing * p.hangerSpacing));
    clips = ceilInt(ceilingArea / (p.cSpacing * p.omegaSpacing));
    angleRuns.push(perimeter);
    if (ceilingArea > 0) warnings.push("quick_estimate");
  }

  const troughM = input.troughM ?? 0;
  const shadowM = input.shadowM ?? 0;
  hangers += ceilInt(troughM * p.trough.hangersPerM);
  if (troughM > 0) omegaRuns.push(troughM * p.trough.omegaPerM);
  const troughBoardArea = troughM * p.trough.boardPerM;

  // --- Partitions ---------------------------------------------------------
  let partitionArea = 0;
  const partitionBoardArea: Record<BoardType, number> = { normal: 0, moisture: 0, fire: 0 };
  const studRuns: number[] = [];
  const trackRuns: number[] = [];
  let insulationArea = 0;
  let partitionExtraLayerArea = 0;
  for (const pt of input.partitions ?? []) {
    const height = pt.height ?? p.partitionHeight;
    const length = pt.length ?? (pt.area ?? 0) / height;
    const area = pt.area ?? length * height;
    partitionArea += area;
    partitionBoardArea[pt.boardType] += area * 2 * pt.layersPerFace;
    partitionExtraLayerArea += area * 2 * Math.max(0, pt.layersPerFace - 1);
    const studs = ceilInt(length / p.studSpacing) + 1;
    for (let i = 0; i < studs; i++) studRuns.push(height);
    trackRuns.push(length, length);
    if (pt.insulation) insulationArea += area;
  }

  const finished = { ceilings: ceilingArea, partitions: partitionArea * 2 };

  if (materials) {
    // Boards, pooled per type (ceilings + troughs + partitions).
    for (const t of ["normal", "moisture", "fire"] as BoardType[]) {
      const ceil = areaByType[t] * layers + (t === "normal" ? troughBoardArea : 0);
      const part = partitionBoardArea[t];
      const need = ceil + part;
      if (need <= 0) continue;
      const board = cat.boards[t];
      const qty = ceilInt((need / board.area) * w);
      lines.push({
        key: `board_${t}`,
        group: "material",
        label: BOARD_LABEL[t],
        productId: board.productId,
        need: Math.round(need * 100) / 100,
        needUnit: "m2",
        purchase: { kind: "units", count: qty },
        qty,
        unit: "board",
        unitPrice: board.price,
        cost: qty * board.price,
        formula: "ceil((ceiling area × layers + trough board + partition faces × layers) ÷ board area × (1 + waste))",
        inputs: { ceilingArea: areaByType[t], layers, troughBoard: t === "normal" ? troughBoardArea : 0, partitionFaces: part, boardArea: board.area, waste: p.wastePercent },
        workType: primaryOf({ ceilings: ceil, partitions: part }),
        allocation: shares({ ceilings: ceil, partitions: part }),
      });
    }

    if (ceilingArea > 0 || troughM > 0) {
      lines.push(barLine("c_channel", "قطاع C رئيسي", cat.cChannel, cutToBars(cRuns, cat.cChannel.length), measured ? "per room: lines one spacing apart, the first one spacing from the wall (none against it), across the cheaper side; cut onto bars (FFD)" : "ceiling area ÷ grid spacing, onto bars", { grid: p.cSpacing, runs: cRuns.length, ...(measured ? { roomsAlongLength: layouts.filter((l) => l.cAlong === "length").length, roomsAlongWidth: layouts.filter((l) => l.cAlong === "width").length } : {}) }, "ceilings"));
      lines.push(barLine("omega", "قطاع أوميغا", cat.omega, cutToBars(omegaRuns, cat.omega.length), measured ? "per room: lines one spacing apart, the first one spacing from the wall, across the channels + trough m × extra omega; cut onto bars" : "ceiling area ÷ grid spacing + trough m × extra omega, onto bars", { grid: p.omegaSpacing, troughExtra: troughM * p.trough.omegaPerM }, "ceilings"));
      const pieceLen = p.hangingHeight + p.cutAllowance;
      if (p.suspension === "rod") {
        lines.push(barLine("rod", "سيخ تعليق مسنن", cat.rod, cutIdentical(hangers, pieceLen, cat.rod.length), "hangers × (hanging height + cutting allowance), cut onto rods", { hangers, pieceLength: pieceLen }, "ceilings"));
        lines.push(boxLine("washers", "وردات وصواميل", cat.washers, hangers, "one set per hanger", { hangers }, "ceilings"));
      } else {
        lines.push(barLine("vertical_c", "علاقات C رأسية", cat.verticalHanger, cutIdentical(hangers, pieceLen, cat.verticalHanger.length), "hangers × (hanging height + cutting allowance), cut onto C bars", { hangers, pieceLength: pieceLen }, "ceilings"));
      }
      lines.push(boxLine("anchors", "فيشر تثبيت", cat.anchors, hangers, "one anchor per hanger", { hangers }, "ceilings"));
      lines.push(boxLine("clips", "كلبسات", cat.clips, clips, "one clip at each C × omega crossing", { crossings: clips }, "ceilings"));
      lines.push(barLine("edge_angle", "زاوية محيط", cat.edgeAngle, cutToBars(angleRuns, cat.edgeAngle.length), measured ? "room sides cut onto angle bars" : "estimated perimeter = area × 0.7, onto bars", { perimeter: Math.round(perimeter * 100) / 100 }, "ceilings"));
      lines.push(boxLine("angle_screws", "مسامير الزاوية", cat.angleScrews, perimeter * p.angleScrewsPerM, "perimeter × screws per m", { perimeter: Math.round(perimeter * 100) / 100, perM: p.angleScrewsPerM }, "ceilings"));
    }
    if (troughM > 0) {
      lines.push(barLine("trough_angle", "زاوية حماية الإنارة", cat.troughAngle, cutToBars([troughM * p.trough.protectionAnglePerM], cat.troughAngle.length), "trough m × protection angle per m", { troughM, perM: p.trough.protectionAnglePerM }, "ceilings"));
    }
    if (shadowM > 0) {
      lines.push(barLine("shadow", "بروفايل شادو", cat.shadow, cutToBars([shadowM], cat.shadow.length), "shadow length onto profile bars", { shadowM }, "ceilings"));
    }
    if (studRuns.length) {
      lines.push(barLine("studs", "قوائم (ستد)", cat.stud, cutToBars(studRuns, cat.stud.length), "studs = ceil(length ÷ stud spacing) + 1, each of partition height", { studs: studRuns.length, studSpacing: p.studSpacing }, "partitions"));
      lines.push(barLine("tracks", "مجاري (تراك)", cat.track, cutToBars(trackRuns, cat.track.length), "tracks = 2 × partition length", { length: Math.round(sum(trackRuns) * 50) / 100 }, "partitions"));
    }

    const screwArea = { ceilings: ceilingArea * layers, partitions: sum(Object.values(partitionBoardArea)) };
    const screwNeed = (screwArea.ceilings + screwArea.partitions) * p.screwsPerM2PerLayer * w;
    if (screwNeed > 0) {
      lines.push(boxLine("board_screws", "مسامير ألواح", cat.boardScrews, screwNeed, "board m² × layers × screws per m² × (1 + waste)", { boardArea: screwArea.ceilings + screwArea.partitions, perM2: p.screwsPerM2PerLayer, waste: p.wastePercent }, primaryOf(screwArea), shares(screwArea)));
    }
    const finishedTotal = finished.ceilings + finished.partitions;
    if (finishedTotal > 0) {
      const tapeNeed = finishedTotal * p.tapePerM2 * w;
      const tapeQty = ceilInt(tapeNeed / cat.tape.length);
      lines.push({
        key: "joint_tape",
        group: "material",
        label: "شريط فواصل",
        productId: cat.tape.productId,
        need: Math.round(tapeNeed * 100) / 100,
        needUnit: "m",
        purchase: { kind: "units", count: tapeQty, perPack: cat.tape.length },
        qty: tapeQty,
        unit: "roll",
        unitPrice: cat.tape.price,
        cost: tapeQty * cat.tape.price,
        formula: "finished m² × tape per m² × (1 + waste) ÷ roll length",
        inputs: { finished: finishedTotal, perM2: p.tapePerM2, waste: p.wastePercent },
        workType: primaryOf(finished),
        allocation: shares(finished),
      });
      const compNeed = finishedTotal * p.compoundPerM2 * w;
      const compQty = ceilInt(compNeed / cat.compound.kg);
      lines.push({
        key: "joint_compound",
        group: "material",
        label: "معجون فواصل",
        productId: cat.compound.productId,
        need: Math.round(compNeed * 100) / 100,
        needUnit: "kg",
        purchase: { kind: "units", count: compQty, perPack: cat.compound.kg },
        qty: compQty,
        unit: "bag",
        unitPrice: cat.compound.price,
        cost: compQty * cat.compound.price,
        formula: "finished m² × compound per m² × (1 + waste) ÷ bag weight",
        inputs: { finished: finishedTotal, perM2: p.compoundPerM2, waste: p.wastePercent },
        workType: primaryOf(finished),
        allocation: shares(finished),
      });
    }
    if (insulationArea > 0) {
      lines.push({ key: "insulation", group: "material", label: "عزل صوف صخري", need: insulationArea, needUnit: "m2", purchase: { kind: "units", count: insulationArea }, qty: insulationArea, unit: "m2", unitPrice: cat.insulationPerM2, cost: insulationArea * cat.insulationPerM2, formula: "partition area", inputs: { area: insulationArea }, workType: "partitions" });
    }
  }

  // --- Labour ---------------------------------------------------------------
  const labour = (key: string, label: string, qty: number, unit: string, rate: number, workType: string, formula: string) => {
    if (qty <= 0) return;
    lines.push({ key, group: "labour", label, need: qty, needUnit: unit, purchase: { kind: "units", count: qty }, qty, unit, unitPrice: rate, cost: qty * rate, formula, inputs: { qty, rate }, workType });
  };
  labour("labour_ceilings", "مصنعية أسقف", ceilingArea, "m2", cat.labour.ceilingsPerM2, "ceilings", "ceiling m² × rate");
  labour("labour_ceiling_layers", "مصنعية طبقة إضافية — أسقف", ceilingArea * (layers - 1), "m2", cat.labour.extraLayerPerM2, "ceilings", "ceiling m² × extra layers × rate");
  labour("labour_partitions", "مصنعية قواطع", partitionArea, "m2", cat.labour.partitionsPerM2, "partitions", "partition m² × rate");
  labour("labour_partition_layers", "مصنعية طبقة إضافية — قواطع", partitionExtraLayerArea, "m2", cat.labour.extraLayerPerM2, "partitions", "partition faces × extra layers × rate");
  labour("labour_trough", "مصنعية بيت إنارة", troughM, "m", cat.labour.troughPerM, "ceilings", "trough m × rate");
  labour("labour_shadow", "مصنعية شادو", shadowM, "m", cat.labour.shadowPerM, "ceilings", "shadow m × rate");

  // --- Hatches (supply + install) --------------------------------------------
  for (const [size, count] of Object.entries(input.hatches ?? {})) {
    if (!count) continue;
    const price = cat.hatches[size];
    if (price == null) {
      warnings.push(`unknown_hatch_${size}`);
      continue;
    }
    lines.push({ key: `hatch_${size}`, group: "hatch", label: `فتحة صيانة ${size}`, need: count, needUnit: "pcs", purchase: { kind: "units", count }, qty: count, unit: "pcs", unitPrice: price, cost: count * price, formula: "count × supply & install price", inputs: { count, price }, workType: "ceilings" });
  }

  // Components the owner marked as not included for this client are left out.
  const ROLE_OF: Record<string, string> = { studs: "stud", tracks: "track", vertical_c: "vertical_hanger" };
  const included = (l: Line) => l.group !== "material" || input.scope?.[ROLE_OF[l.key] ?? l.key] !== false;
  const kept = lines.filter(included);
  const has = (k: string) => kept.some((l) => l.key === k);
  return {
    lines: kept,
    areas: { ceilings: ceilingArea, partitions: partitionArea },
    status: measured || !(input.quickAreas && ceilingArea > 0) ? "measured" : "estimated",
    warnings,
    // the framing document (rooms measured only): frozen with the quote version
    ...(measured
      ? {
          framing: {
            grid: p.cSpacing, hangerSpacing: p.hangerSpacing, hangingHeight: p.hangingHeight, cutAllowance: p.cutAllowance, suspension: p.suspension,
            bars: { c: cat.cChannel.length, omega: cat.omega.length, angle: cat.edgeAngle.length, hanger: p.suspension === "rod" ? cat.rod.length : cat.verticalHanger.length },
            troughOmega: troughM * p.trough.omegaPerM, troughHangers: ceilInt(troughM * p.trough.hangersPerM), rooms: layouts,
            listed: { c: has("c_channel"), omega: has("omega"), angle: has("edge_angle"), hanger: has(p.suspension === "rod" ? "rod" : "vertical_c") },
          } satisfies GypsumFraming,
        }
      : {}),
  };
}
