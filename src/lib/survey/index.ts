/**
 * Survey → quantities (Appendix A.3). One survey serves every service:
 * rooms are entered once (L × W × H, openings), each room says what applies
 * (gypsum ceiling and its board type; wall paint and its zone; ceiling paint).
 * Things rooms can't give (façade area, partitions, troughs, hatches…) are
 * entered as totals. In "total" mode every area is a total.
 */
import { EMPTY_QUANTITIES, type Quantities, type ServiceKind } from "@/lib/pricing";

export type BoardType = "normal" | "moisture" | "fire";
export type WallZone = "normal" | "wet" | "decorative";

export type SurveyRoom = {
  id: string;
  name: string;
  unit_label: string | null;
  length_m: number;
  width_m: number;
  height_m: number;
  openings_m2: number;
  gypsum_ceiling: boolean;
  ceiling_board: BoardType;
  paint_walls: boolean;
  paint_ceiling: boolean;
  wall_zone: WallZone;
  /** C channels along the length / width; null / missing = automatic (cheaper way) */
  c_along?: "length" | "width" | null;
};

/** Totals entered directly (always used for what rooms don't cover). */
export type SurveyTotals = Partial<Omit<Quantities, "gypsumRooms">>;

export type SurveyMode = "total" | "rooms";

export const roomCeiling = (r: SurveyRoom) => r.length_m * r.width_m;
export const roomPerimeter = (r: SurveyRoom) => 2 * (r.length_m + r.width_m);
/** Wall area = perimeter × height − openings (never below zero). */
export const roomWalls = (r: SurveyRoom) => Math.max(0, roomPerimeter(r) * r.height_m - r.openings_m2);

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Quantities for one service from a survey. */
export function surveyQuantities(kind: ServiceKind, mode: SurveyMode, rooms: SurveyRoom[], totals: SurveyTotals): Quantities {
  const q: Quantities = { ...EMPTY_QUANTITIES, ...totals, hatches: { ...(totals.hatches ?? {}) } };
  if (mode === "total" || rooms.length === 0) return q;

  if (kind === "gypsum") {
    const g = rooms.filter((r) => r.gypsum_ceiling);
    q.ceilNormal = round2(g.filter((r) => r.ceiling_board === "normal").reduce((s, r) => s + roomCeiling(r), 0));
    q.ceilMoisture = round2(g.filter((r) => r.ceiling_board === "moisture").reduce((s, r) => s + roomCeiling(r), 0));
    q.ceilFire = round2(g.filter((r) => r.ceiling_board === "fire").reduce((s, r) => s + roomCeiling(r), 0));
    // real dimensions → metal runs per room, real perimeters (A.4)
    q.gypsumRooms = g.map((r) => ({ id: r.id, name: r.name, L: r.length_m, W: r.width_m, boardType: r.ceiling_board, ...(r.c_along ? { cAlong: r.c_along } : {}) }));
  }
  if (kind === "interior") {
    const walls = rooms.filter((r) => r.paint_walls);
    q.walls = round2(walls.reduce((s, r) => s + roomWalls(r), 0));
    q.wet = round2(walls.filter((r) => r.wall_zone === "wet").reduce((s, r) => s + roomWalls(r), 0));
    q.decorative = round2(walls.filter((r) => r.wall_zone === "decorative").reduce((s, r) => s + roomWalls(r), 0));
    q.ceilings = round2(rooms.filter((r) => r.paint_ceiling).reduce((s, r) => s + roomCeiling(r), 0));
  }
  return q;
}

/** Simple readiness of a survey for a service (what's still missing). */
export function surveyGaps(kind: ServiceKind, q: Quantities): string[] {
  const gaps: string[] = [];
  if (kind === "gypsum" && q.ceilNormal + q.ceilMoisture + q.ceilFire + q.partitions <= 0) gaps.push("no_gypsum_area");
  if (kind === "interior" && q.walls + q.ceilings <= 0) gaps.push("no_paint_area");
  if (kind === "exterior" && q.facade <= 0) gaps.push("no_facade_area");
  return gaps;
}
