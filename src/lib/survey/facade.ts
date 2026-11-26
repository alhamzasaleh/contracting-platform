import { z } from "zod";
import type { Box, PlanToken } from "@/lib/survey/plan";

/**
 * Exterior paint from the architect's elevation sheets (owner, Nov 2026).
 *
 * The browser finds each titled elevation («EAST ELEVATION (E01)») on the sheets, crops the drawing
 * above its title, and lists the exact positions of its long lines (from the PDF's own vectors) so
 * widths can be measured, not guessed. The AI reads each elevation into PARTS (painted / stone /
 * glass / GRC per the materials legend) and OPENINGS; the paint area is computed here — never by the
 * AI — and every row is the owner's to review before it becomes the survey's façade area.
 */

export type Direction = "east" | "west" | "north" | "south" | "front" | "back" | "right" | "left" | "side";
export const DIRECTION_AR: Record<Direction, string> = {
  east: "الواجهة الشرقية",
  west: "الواجهة الغربية",
  north: "الواجهة الشمالية",
  south: "الواجهة الجنوبية",
  front: "الواجهة الأمامية",
  back: "الواجهة الخلفية",
  right: "الواجهة اليمنى",
  left: "الواجهة اليسرى",
  side: "الواجهة الجانبية",
};
const DIRECTION_WORDS: [RegExp, Direction][] = [
  [/^EAST(ERN)?$/i, "east"],
  [/^WEST(ERN)?$/i, "west"],
  [/^NO?U?RTH(ERN)?$/i, "north"],
  [/^SOUTH(ERN)?$/i, "south"],
  [/^FRONT$/i, "front"],
  [/^(BACK|REAR)$/i, "back"],
  [/^RIGHT$/i, "right"],
  [/^LEFT$/i, "left"],
  [/^SIDE$/i, "side"],
];
const direction = (word: string): Direction | null => DIRECTION_WORDS.find(([re]) => re.test(word.trim()))?.[1] ?? null;

/** «ELEVATION (E01)» — an elevation drawing's title (detail sheets «(W.D1)», legends and title blocks are not) */
const TITLE_RE = /^(?:([A-Z]+)\s+)?ELEVATION\s*\(\s*([A-Z]{1,2})\s*-?\s*(\d{1,2})\s*\)\s*$/i;

export type ElevationTitle = { code: string; dir: Direction | null; x: number; y: number };

/** The elevations titled on a sheet, top to bottom, with their direction (from the title or the word just left of it). */
export function elevationTitles(tokens: PlanToken[]): ElevationTitle[] {
  const out: ElevationTitle[] = [];
  for (const t of tokens) {
    const m = TITLE_RE.exec(t.s.trim());
    if (!m) continue;
    let dir = m[1] ? direction(m[1]) : null;
    if (!dir) {
      // «NOURTH» drawn as its own word on the same line, just left of «ELEVATION (E04)»
      const near = tokens
        .filter((w) => w !== t && Math.abs(w.y - t.y) < 6 && w.x < t.x && t.x - w.x < 260 && direction(w.s))
        .sort((a, b) => b.x - a.x)[0];
      dir = near ? direction(near.s) : null;
    }
    out.push({ code: `${m[2].toUpperCase()}${m[3].padStart(2, "0")}`, dir, x: t.x, y: t.y });
  }
  return out.sort((a, b) => a.y - b.y);
}

/** a level label at the side of the drawing («FIRST FLOOR FINISH 4.70M», «STREET LEVEL 00 CM») */
const LEVEL_RE = /(FINISH|LEVEL|PARAPET|ROOF\s+TOP|منسوب)/i;
/** words of the sheet's title block (on the right) */
const TITLE_BLOCK_RE = /^(NOTES:?|PROJECT:?|CLIENT:?|DWG\s+TITLE:?|SHEET\s+NO:?|SCALE:?|NORTH:?|LOCATION:?|DATE:?)$/i;

export type ElevationRegion = ElevationTitle & { region: Box };

/**
 * Each elevation's drawing: the band from the title above it (or the sheet top) down to just below
 * its own title, from left of its level labels to the title block.
 */
export function elevationRegions(tokens: PlanToken[], page: { width: number; height: number }, frames: number[] = []): ElevationRegion[] {
  const titles = elevationTitles(tokens);
  const block = tokens.filter((t) => TITLE_BLOCK_RE.test(t.s.trim()) && t.x > page.width * 0.6).map((t) => t.x);
  return titles.map((title, i) => {
    // the drawing frame's right border (a sheet-tall line right of the title), else the title block's words
    const frame = frames.filter((x) => x > title.x + 20).sort((a, b) => a - b)[0];
    const x1 = frame != null ? frame - 4 : block.length ? Math.min(...block) - 10 : page.width * 0.9;
    const y0 = i === 0 ? 0 : titles[i - 1].y + 15;
    const y1 = Math.min(page.height, title.y + 12);
    const levels = tokens.filter((t) => LEVEL_RE.test(t.s) && t.y > y0 && t.y < y1 && t.x < x1).map((t) => t.x);
    const x0 = Math.max(0, (levels.length ? Math.min(...levels) : page.width * 0.15) - 80);
    return { ...title, region: { x0, y0, x1, y1 } };
  });
}

/**
 * The sheet's frame borders: single vertical lines at least 60 % of the page tall (x in points).
 * One long line each — many short ones on the same x (hatching, dimension ticks) are not a frame.
 */
export function frameLines(segments: number[][], page: { height: number }): number[] {
  const xs = new Set<number>();
  for (const [ax, ay, bx, by] of segments) {
    if (Math.abs(bx - ax) < 0.5 && Math.abs(by - ay) >= page.height * 0.6) xs.add(Math.round(ax / 3) * 3);
  }
  return [...xs].sort((a, b) => a - b);
}

export type Line = { at: number; from: number; to: number; length: number };

/**
 * The drawing's long horizontal and vertical lines inside the region, in metres from its top-left
 * corner (merged when 5 cm apart), longest first — exact positions the AI measures widths and
 * heights from. Segments are [x0, y0, x1, y1] in PDF points (top-left origin).
 */
export function lineInventory(segments: number[][], region: Box, mpp: number, limit = 120): { vertical: Line[]; horizontal: Line[] } {
  const minPt = 0.5 / mpp; // ≥ 0.5 m
  const step = 0.05 / mpp; // merge within 5 cm
  const inside = (x: number, y: number) => x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1;
  const groups = { vertical: new Map<number, { at: number; from: number; to: number; length: number }>(), horizontal: new Map<number, { at: number; from: number; to: number; length: number }>() };
  for (const [ax, ay, bx, by] of segments) {
    if (!inside(ax, ay) || !inside(bx, by)) continue;
    const dx = Math.abs(bx - ax);
    const dy = Math.abs(by - ay);
    const vertical = dx < 0.5 && dy >= minPt;
    const horizontal = dy < 0.5 && dx >= minPt;
    if (!vertical && !horizontal) continue;
    const kind = vertical ? "vertical" : "horizontal";
    const at = vertical ? ax : ay;
    const lo = vertical ? Math.min(ay, by) : Math.min(ax, bx);
    const hi = vertical ? Math.max(ay, by) : Math.max(ax, bx);
    const key = Math.round(at / step);
    const g = groups[kind].get(key);
    if (g) {
      g.from = Math.min(g.from, lo);
      g.to = Math.max(g.to, hi);
      g.length += hi - lo;
    } else groups[kind].set(key, { at, from: lo, to: hi, length: hi - lo });
  }
  const toM = (kind: "vertical" | "horizontal") =>
    [...groups[kind].values()]
      .sort((a, b) => b.length - a.length)
      .slice(0, limit)
      .map((g) => {
        const o = kind === "vertical" ? { at: region.x0, along: region.y0 } : { at: region.y0, along: region.x0 };
        return { at: r2((g.at - o.at) * mpp), from: r2((g.from - o.along) * mpp), to: r2((g.to - o.along) * mpp), length: r2(g.length * mpp) };
      });
  return { vertical: toM("vertical"), horizontal: toM("horizontal") };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

// --- the AI's reading (structured output) and its cleaning --------------------------------------

export const MATERIALS = ["paint", "stone", "glass", "grc", "other"] as const;
export type Material = (typeof MATERIALS)[number];

const size = z.number().nullable();
export const facadeDraftSchema = z.object({
  code: z.string(),
  direction: z.enum(["east", "west", "north", "south", "front", "back", "right", "left", "side"]).nullable(),
  parts: z
    .array(
      z.object({
        name: z.string().describe("Arabic, e.g. «الكتلة الرئيسية — الأرضي والأول», «دروة السطح», «الملحق»"),
        material: z.enum(MATERIALS),
        width_m: size,
        height_m: size,
        count: z.number(),
        fence: z.boolean().describe("true for a boundary / fence wall drawn in front of the building"),
      }),
    )
    .describe("rectangles covering the façade's visible wall surface once, no overlaps"),
  openings: z.array(z.object({ kind: z.enum(["window", "door", "opening"]), width_m: size, height_m: size, count: z.number() })).describe("windows / doors cut into PAINTED parts only"),
  notes: z.array(z.string()),
});
export type FacadeDraft = z.infer<typeof facadeDraftSchema>;

export type FacadePart = { name: string; material: Material; width_m: number | null; height_m: number | null; count: number; include: boolean };
export type FacadeOpening = { kind: "window" | "door" | "opening"; width_m: number | null; height_m: number | null; count: number };
export type Facade = { code: string; name: string; include: boolean; parts: FacadePart[]; openings: FacadeOpening[]; notes: string[] };

const plausible = (v: number | null | undefined, max: number) => (v != null && Number.isFinite(v) && v > 0.05 && v <= max ? r2(v) : null);
const whole = (n: number) => (Number.isFinite(n) && n > 0 ? Math.min(100, Math.ceil(n - 1e-9)) : 1);

/** The AI's draft → rows for review: plausible sizes only (else empty, said in a note), whole counts, the fence left out by default. */
export function cleanFacade(d: FacadeDraft): Facade {
  const notes = [...d.notes.map((n) => n.slice(0, 300))].slice(0, 10);
  const parts = d.parts.slice(0, 40).map((p) => ({
    name: p.name.trim().slice(0, 80) || "—",
    material: p.material,
    width_m: plausible(p.width_m, 80),
    height_m: plausible(p.height_m, 40),
    count: whole(p.count),
    include: !p.fence,
  }));
  const openings = d.openings.slice(0, 60).map((o) => ({ kind: o.kind, width_m: plausible(o.width_m, 12), height_m: plausible(o.height_m, 12), count: whole(o.count) }));
  if ([...parts, ...openings].some((r) => r.width_m == null || r.height_m == null)) notes.push("بعض المقاسات ما انقرت من المخطط — كمّلها قبل الاعتماد.");
  if (parts.some((p) => !p.include)) notes.push("السور محسوب لحاله وغير مضاف — فعّله إذا السور ضمن الدهان.");
  return { code: d.code.slice(0, 10), name: d.direction ? DIRECTION_AR[d.direction] : `واجهة ${d.code.slice(0, 10)}`, include: true, parts, openings, notes };
}

const area = (r: { width_m: number | null; height_m: number | null; count: number }) => (r.width_m ?? 0) * (r.height_m ?? 0) * r.count;

/** A façade's areas: painted parts (gross) − openings = paint; stone / glass / GRC / other listed apart. Included parts only. */
export function facadeArea(f: Pick<Facade, "parts" | "openings">) {
  const parts = f.parts.filter((p) => p.include);
  const gross = r2(parts.filter((p) => p.material === "paint").reduce((s, p) => s + area(p), 0));
  const openings = r2(f.openings.reduce((s, o) => s + area(o), 0));
  const other = Object.fromEntries((["stone", "glass", "grc", "other"] as const).map((m) => [m, r2(parts.filter((p) => p.material === m).reduce((s, p) => s + area(p), 0))])) as Record<Exclude<Material, "paint">, number>;
  return { gross, openings, paint: r2(Math.max(0, gross - openings)), other };
}

/** The survey's façade area: the included façades' paint areas. */
export const facadesTotal = (list: Facade[]) => r2(list.filter((f) => f.include).reduce((s, f) => s + facadeArea(f).paint, 0));

/** What is stored on the survey (validated on the server). */
const num = z.number().min(0).max(80).nullable();
export const facadesSchema = z
  .array(
    z
      .object({
        code: z.string().trim().min(1).max(10),
        name: z.string().trim().min(1).max(80),
        include: z.boolean(),
        parts: z.array(z.object({ name: z.string().trim().min(1).max(80), material: z.enum(MATERIALS), width_m: num, height_m: num, count: z.number().int().min(1).max(100), include: z.boolean() }).strict()).max(40),
        openings: z.array(z.object({ kind: z.enum(["window", "door", "opening"]), width_m: num, height_m: num, count: z.number().int().min(1).max(100) }).strict()).max(60),
        notes: z.array(z.string().max(300)).max(12),
      })
      .strict(),
  )
  .max(12);

// --- what the browser sends for one elevation ----------------------------------------------------

const coord = z.number().min(-1).max(1000);
const lineSchema = z.object({ at: coord, from: coord, to: coord, length: z.number().min(0).max(1000) }).strict();
export const FACADE_MAX_TILES = 9;
export const elevationSheetSchema = z
  .object({
    survey_id: z.uuid(),
    page: z.number().int().min(1).max(500),
    code: z.string().trim().min(1).max(10),
    direction: z.enum(["east", "west", "north", "south", "front", "back", "right", "left", "side"]).nullable(),
    scale: z.number().int().min(20).max(500),
    /** the printed text of the elevation (levels, notes, material tags) in metres from its corner */
    words: z.array(z.object({ s: z.string().max(60), x: coord, y: coord }).strict()).max(1500),
    /** the materials legend of the sheet («1 WHITE PAINT», «2 STONE»…) */
    legend: z.array(z.string().max(60)).max(30),
    lines: z.object({ vertical: z.array(lineSchema).max(150), horizontal: z.array(lineSchema).max(150) }).strict(),
    tiles: z.array(z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).strict()).min(1).max(FACADE_MAX_TILES),
  })
  .strict();
export type ElevationSheet = z.infer<typeof elevationSheetSchema>;

/** The sheet's materials legend: «WHITE PAINT», «STONE», «GLASS», «GRC» next to their numbers. */
export function materialsLegend(tokens: PlanToken[]): string[] {
  const head = tokens.find((t) => /MATERIALS?\s+OF\s+ELEVATIONS?\s+LEGEND|LEGEND/i.test(t.s));
  if (!head) return [];
  // the legend table below its heading (≈ 250 pt square)
  const cells = tokens
    .filter((t) => t !== head && t.y > head.y && t.y < head.y + 260 && Math.abs(t.x - head.x) < 160 && !/^(SYMBOL|CODE|ITEM\s+NAME)$/i.test(t.s))
    .sort((a, b) => a.y - b.y);
  // one row per legend line: the number and its name («1 WHITE PAINT»)
  const rows: PlanToken[][] = [];
  for (const c of cells) {
    const row = rows.find((r) => Math.abs(r[0].y - c.y) < 8);
    if (row) row.push(c);
    else rows.push([c]);
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x).map((t) => t.s).join(" ").slice(0, 60)).slice(0, 30);
}
