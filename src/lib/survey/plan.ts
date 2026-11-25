import { z } from "zod";
import { toNumber } from "@/lib/validation/numbers";

/**
 * Reading an architect's floor plan (CAD PDF) into survey rooms (owner, Nov 2026).
 *
 * The browser opens the PDF (pdf.js), keeps only the floor-plan sheets, crops the drawing around
 * its room labels into a few image tiles and collects the printed text with its position. The AI
 * reads each sheet into a DRAFT (room label, name, interior length × width); these pure helpers pick
 * the sheets, plan the tiles, check every dimension against the numbers actually printed near the
 * room, and flag what needs the owner's eye (open spaces, unconfirmed sizes, a label on two sheets).
 * Nothing is saved until the owner reviews the rows and adds them.
 */

export const PLAN_MAX_BYTES = 60 * 1024 * 1024;
/** tiles sent per sheet (server limit too) */
export const PLAN_MAX_TILES = 9;
export const PLAN_TILE_MAX_BYTES = 1_500_000;
/** all tiles of one sheet together — under the hosting limit for one request (≈ 4.5 MB) */
export const PLAN_SHEET_MAX_BYTES = 3_600_000;

/** A printed word with its centre on the sheet, in PDF points (top-left origin). */
export type PlanToken = { s: string; x: number; y: number };
export type Box = { x0: number; y0: number; x1: number; y1: number };

/** Room tags such as GF-07, F1-03, F2-11, B-02, RF-01 (sheet numbers like A-02 lose to the dominant prefix). */
const LABEL_RE = /^([A-Z]{1,3}\d?)-(\d{2,3})$/;
/** printed dimensions: 4.50, 12.30, .80 */
const DIM_RE = /^(\d{1,2})?\.(\d{2})$/;

/** metres on site per PDF point at a drawing scale of 1:scale */
export const metresPerPoint = (scale: number) => (25.4 / 72 / 1000) * scale;

/** The drawing scale printed on the sheet («SCALE 1:100», «1/100»); 100 when none is found. */
export function planScale(text: string): number {
  const counts = new Map<number, number>();
  for (const m of text.matchAll(/\b1\s*[:/]\s*(20|25|50|75|100|125|150|200)\b/g)) {
    const v = Number(m[1]);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best = 100;
  let n = 0;
  for (const [v, c] of counts) if (c > n || (c === n && v === 100)) [best, n] = [v, c];
  return best;
}

/** Room labels of the sheet: the most common label prefix (GF, F1…) with at least 3 labels; others (sheet / detail refs) dropped. */
export function floorLabels(tokens: PlanToken[]): { prefix: string; labels: PlanToken[]; prefixes: Record<string, number> } | null {
  // prefixes counted by DISTINCT numbers: detail / sheet refs (A-07, A-18…) repeat a few numbers,
  // a floor's room tags are mostly all different
  const by = new Map<string, PlanToken[]>();
  for (const t of tokens) {
    const m = LABEL_RE.exec(t.s.trim());
    if (!m) continue;
    const list = by.get(m[1]) ?? [];
    list.push({ ...t, s: t.s.trim() });
    by.set(m[1], list);
  }
  const distinct = (v: PlanToken[]) => new Set(v.map((t) => t.s)).size;
  const prefixes = Object.fromEntries([...by].map(([k, v]) => [k, distinct(v)]));
  // one-letter prefixes (A-07, S-02, E-1…) are usually drawing / discipline references: a floor code
  // of two characters (GF, F1, RF…) wins when it has enough tags
  const floorish = (k: string) => k.length > 1;
  const ranked = [...by].sort((a, b) => Number(floorish(b[0]) && distinct(b[1]) >= 3) - Number(floorish(a[0]) && distinct(a[1]) >= 3) || distinct(b[1]) - distinct(a[1]));
  const top = ranked[0];
  if (!top || distinct(top[1]) < 3) return null;
  return { prefix: top[0], labels: top[1], prefixes };
}

/** an electrical / HVAC / plumbing / structural sheet title (a legend saying «COLUMN AXIS» is not one) */
const SERVICE_SHEET = /\b(LIGHTING|POWER|HVAC|LOW\s+CURRENT|FLOW\s+CURRENT|SEWER|GROUNDING|CABLE\s+ROUTING|AIR\s+CONDITION(?:ING)?|WATER\s+LINE|DRAINAGE|FIRE\s+ALARM|FOUNDATIONS?|COLUMNS?\s*&\s*AXIS|GRADE\s+BEAMS?|SLAB|REINFORCEMENT)\s+PLAN\b/i;

/**
 * A floor plan sheet: one floor's labels (≥ 3 of one prefix), not a schedule listing every floor
 * (two prefixes with ≥ 3 each), and not an electrical / HVAC / plumbing / structural sheet.
 */
export function isFloorPlan(text: string, tokens: PlanToken[]): boolean {
  const f = floorLabels(tokens);
  if (!f) return false;
  // a floor has several rooms: 5+ tags, or 3+ on a sheet titled «… FLOOR PLAN»; a one-letter
  // prefix (A-01…) is a drawing reference unless there are many of them
  const tags = f.prefixes[f.prefix];
  if (tags < (/FLOOR\s+PLAN|مسقط/i.test(text) ? 3 : 5)) return false;
  if (f.prefix.length === 1 && tags < 8) return false;
  // a schedule lists several floors: another prefix with nearly as many distinct tags
  const most = f.prefixes[f.prefix];
  if (Object.entries(f.prefixes).some(([k, n]) => k !== f.prefix && k.length > 1 && n >= 3 && n >= most * 0.5)) return false;
  if (/SCHEDULE/i.test(text) && !/FLOOR\s+PLAN/i.test(text)) return false;
  return !SERVICE_SHEET.test(text);
}

/** The sheet's title, e.g. «GROUND FLOOR PLAN» / «مسقط أفقي للدور الأرضي», else the label prefix. */
export function planTitle(text: string, prefix: string): string {
  const en = /\b((?:GROUND|FIRST|SECOND|THIRD|FOURTH|ROOF|BASEMENT|MEZZANINE|UPPER\s+ROOF|TYPICAL)\s+(?:FLOOR\s+)?PLAN)\b/i.exec(text);
  return en ? en[1].replace(/\s+/g, " ").toUpperCase() : prefix;
}

/** The drawing area: every room label plus a margin (in points) — rooms extend a few metres past their label. */
export function labelRegion(labels: PlanToken[], scale: number, page: { width: number; height: number }): Box {
  const margin = 7 / metresPerPoint(scale); // 7 m of building around the outermost labels
  const xs = labels.map((l) => l.x);
  const ys = labels.map((l) => l.y);
  return {
    x0: Math.max(0, Math.min(...xs) - margin),
    y0: Math.max(0, Math.min(...ys) - margin),
    x1: Math.min(page.width, Math.max(...xs) + margin),
    y1: Math.min(page.height, Math.max(...ys) + margin),
  };
}

/**
 * Split the region into tiles of at most `maxPx` pixels a side at `pxPerPt`, overlapping by
 * `overlapPx` so a room cut by a tile edge is whole in its neighbour. Never more than PLAN_MAX_TILES
 * (the zoom is lowered instead).
 */
export function tileGrid(region: Box, pxPerPt: number, maxPx = 1400, overlapPx = 120): { zoom: number; tiles: Box[] } {
  let zoom = pxPerPt;
  const w = region.x1 - region.x0;
  const h = region.y1 - region.y0;
  for (;;) {
    const step = (maxPx - overlapPx) / zoom;
    const cols = Math.max(1, Math.ceil((w * zoom - overlapPx) / (maxPx - overlapPx)));
    const rows = Math.max(1, Math.ceil((h * zoom - overlapPx) / (maxPx - overlapPx)));
    if (cols * rows <= PLAN_MAX_TILES || zoom < 1) {
      const tiles: Box[] = [];
      const tw = Math.min(w, maxPx / zoom);
      const th = Math.min(h, maxPx / zoom);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const x0 = Math.min(region.x0 + c * step, region.x1 - tw);
          const y0 = Math.min(region.y0 + r * step, region.y1 - th);
          tiles.push({ x0, y0, x1: x0 + tw, y1: y0 + th });
        }
      return { zoom, tiles: tiles.slice(0, PLAN_MAX_TILES) };
    }
    zoom *= 0.9;
  }
}

/** Printed dimension values with their position. */
export function dimensionTokens(tokens: PlanToken[]): { v: number; x: number; y: number }[] {
  const out: { v: number; x: number; y: number }[] = [];
  for (const t of tokens) {
    const m = DIM_RE.exec(t.s.trim());
    if (!m) continue;
    const v = Number(`${m[1] ?? "0"}.${m[2]}`);
    if (v > 0 && v <= 60) out.push({ v, x: t.x, y: t.y });
  }
  return out;
}

/** What the sheet sends to the server, in metres from the region's top-left corner. */
export const planSheetSchema = z
  .object({
    survey_id: z.uuid(),
    page: z.number().int().min(1).max(500),
    title: z.string().trim().max(80),
    scale: z.number().int().min(20).max(500),
    labels: z.array(z.object({ s: z.string().max(12), x: z.number().min(-1).max(1000), y: z.number().min(-1).max(1000) }).strict()).max(200),
    words: z.array(z.object({ s: z.string().max(40), x: z.number().min(-1).max(1000), y: z.number().min(-1).max(1000) }).strict()).max(3000),
    tiles: z.array(z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).strict()).min(1).max(PLAN_MAX_TILES),
  })
  .strict();
export type PlanSheet = z.infer<typeof planSheetSchema>;

/** The AI's reading of one sheet. */
export const planDraftSchema = z.object({
  floor_name: z.string().describe("Arabic name of this floor, e.g. «الدور الأرضي», «الدور الأول», «دور السطح»"),
  rooms: z
    .array(
      z.object({
        label: z.string().describe("The room tag exactly as printed, e.g. GF-07; for a part of an open space, the tag of the space it belongs to"),
        name: z.string().describe("Room name in Arabic, e.g. مجلس، غرفة نوم، حمام، ردهة؛ add «(جزء 1)» for a rectangle of a split space"),
        length_m: z.number().nullable().describe("Interior length in metres (wall face to wall face), the longer side; null if it can't be read"),
        width_m: z.number().nullable().describe("Interior width in metres, the shorter side; null if it can't be read"),
        open_space: z.boolean().describe("True when the room has no walls on at least one side (open-plan lobby, living, seating) — its limits are a judgement"),
        confidence: z.enum(["high", "medium", "low"]).describe("high = both sides printed as dimensions and match the walls"),
        note: z.string().nullable().describe("Short Arabic note for the reviewer when something is uncertain, else null"),
      }),
    )
    .describe("Every indoor room / space on this floor plan; outdoor areas (parking, garden, terrace, pool, deck, roof) excluded"),
  conflicts: z.array(z.string()).describe("Short Arabic notes: labels printed twice, a dimension that disagrees with the walls, anything the reviewer must decide"),
});
export type PlanDraft = z.infer<typeof planDraftSchema>;

export type PlanRoom = {
  label: string;
  name: string;
  unit_label: string;
  length_m: number | null;
  width_m: number | null;
  open_space: boolean;
  /** both sides found among the dimensions printed near the room's label */
  confirmed: boolean;
  notes: string[];
};

const num = (v: number | null | undefined, max: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 100) / 100 : null);

/**
 * Keep plausible numbers, mark a room «written on the plan» only when both its sides appear among
 * the printed dimensions within the room's reach of its label (same sheet, metres), and keep the
 * AI's notes. It tells the reviewer the number exists on the drawing — not that it is the right one.
 */
export function cleanPlanDraft(d: PlanDraft, sheet: Pick<PlanSheet, "labels" | "words">, fallbackFloor: string): { floor: string; rooms: PlanRoom[]; conflicts: string[] } {
  const floor = d.floor_name.trim().slice(0, 60) || fallbackFloor;
  const dims = dimensionTokens(sheet.words);
  // a printed side counts only within the room's own reach of its tag (half its diagonal + 1 m):
  // the dimensions along its walls, not the dozens of numbers of the neighbouring rooms
  const near = (label: string, reach: number) => {
    const at = sheet.labels.filter((l) => l.s === label);
    return (v: number) => dims.some((dm) => Math.abs(dm.v - v) <= 0.025 && at.some((a) => Math.hypot(a.x - dm.x, a.y - dm.y) <= reach));
  };
  const known = new Set(sheet.labels.map((l) => l.s));
  const rooms = d.rooms.slice(0, 120).map((r, i): PlanRoom => {
    const a = num(r.length_m, 60);
    const b = num(r.width_m, 60);
    const [length_m, width_m] = a != null && b != null && b > a ? [b, a] : [a, b];
    const label = r.label.trim().slice(0, 12);
    const confirmed =
      length_m != null && width_m != null && known.has(label) && !r.open_space &&
      ((printed) => printed(length_m) && printed(width_m))(near(label, Math.hypot(length_m, width_m) / 2 + 1));
    const notes = [r.note?.trim().slice(0, 200)].filter((x): x is string => !!x);
    return { label, name: r.name.trim().slice(0, 60) || `${floor} ${i + 1}`, unit_label: floor, length_m, width_m, open_space: r.open_space, confirmed, notes };
  });
  return { floor, rooms, conflicts: d.conflicts.slice(0, 20).map((c) => c.slice(0, 200)) };
}

/** A label read on two sheets (the same room drawn twice): every copy after the first is flagged and left unticked. */
export function markRepeats<T extends { label: string }>(sheets: T[][]): (T & { repeated: boolean })[][] {
  const seen = new Set<string>();
  return sheets.map((rooms) => {
    const here = new Set<string>();
    const out = rooms.map((r) => ({ ...r, repeated: seen.has(r.label) }));
    for (const r of rooms) here.add(r.label);
    for (const l of here) seen.add(l);
    return out;
  });
}

/** The room name saved in the survey: «مجلس (GF-07)». */
export const planRoomName = (r: { name: string; label: string }) => (r.label && !r.name.includes(r.label) ? `${r.name} (${r.label})`.slice(0, 80) : r.name.slice(0, 80));

/**
 * A size typed in a review row: Arabic digits («٤٫٥») and a comma decimal («4,5») accepted; only
 * what the room form accepts (0 < v ≤ max: 200 m for length / width, 30 m for height), else empty.
 */
export function roomSize(text: string, max: number): number | null {
  const v = toNumber(text.replace(/,/g, "."));
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 100) / 100 : null;
}
