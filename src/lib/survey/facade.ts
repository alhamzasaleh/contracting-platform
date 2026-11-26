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
const LEVEL_RE = /(FINISH|LEVEL|PAR[AE]?PET|ROOF\s+TOP|FENCE\s+WALL\s+LINE|F\.?F\.?L|منسوب)/i;
/** words of the sheet's title block (on the right) */
const TITLE_BLOCK_RE = /^(NOTES:?|PROJECT:?|CLIENT:?|DWG\s+TITLE:?|SHEET\s+NO:?|SCALE:?|NORTH:?|LOCATION:?|DATE:?)$/i;

/**
 * The level labels printed beside an elevation («ROOF FINISH 8.70M», «PAVEMENT LEVEL 20 CM»,
 * «FFL +4.70», «±0.00 STREET LEVEL», «منسوب السطح 8.70م», «BASEMENT LEVEL -3.20M»), in metres, lowest
 * first, with the label's y when given. A value with a decimal point is metres even when labelled
 * «CM» (a common slip: «FENCE WALL LINE 3.70 CM»); a whole number in CM is centimetres; a whole
 * number without a unit is ambiguous and skipped. Heights / thicknesses («FENCE HEIGHT 3.00 M») aren't levels.
 */
export function printedLevels<W extends { s: string; y?: number }>(words: W[]): { name: string; m: number; y?: number }[] {
  const out = new Map<string, { name: string; m: number; y?: number }>();
  const NUM = String.raw`([+\-±]?)\s*(\d+(?:[.,]\d+)?)\s*(CM|M|سم|م)?`;
  const after = new RegExp(String.raw`^(.*?[A-Za-z\u0600-\u06FF].*?)[\s:=(]+${NUM}\s*\)?\.?$`, "i");
  const before = new RegExp(String.raw`^\(?${NUM}\)?\s+(.*?[A-Za-z\u0600-\u06FF].*)$`, "i");
  for (const w of words) {
    const text = w.s.trim().replace(/\s+/g, " ");
    let name: string, sign: string, num: string, unit: string | undefined;
    const a = after.exec(text);
    if (a) [, name, sign, num, unit] = a;
    else {
      const b = before.exec(text);
      if (!b) continue;
      [, sign, num, unit, name] = b;
    }
    name = name.replace(/[\s:=(]+$/, "").trim().toUpperCase();
    if (!LEVEL_LINE_RE.test(name) || NOT_LEVEL_RE.test(name)) continue;
    const decimal = /[.,]/.test(num);
    const n = Number(num.replace(",", "."));
    const cm = unit != null && /^(CM|سم)$/i.test(unit);
    if (!decimal && !cm && !/^0+$/.test(num)) continue; // «ROOF LEVEL 870»: metres or centimetres? skipped
    const value = (sign === "-" ? -1 : 1) * (cm && !decimal ? n / 100 : n);
    if (!Number.isFinite(value) || value < -10 || value > 60) continue;
    const key = `${name}:${r2(value)}`;
    if (!out.has(key)) out.set(key, { name, m: r2(value) + 0, ...(w.y != null ? { y: w.y } : {}) });
  }
  return [...out.values()].sort((a, b) => a.m - b.m);
}
/** words of a level label (finish, level, parapet, roof top, fence line, FFL, منسوب…) */
const LEVEL_LINE_RE = /(FINISH|LEVEL|PAR[AE]?PET|ROOF|FENCE|LINE|SLAB|TOP|F\.?F\.?L|منسوب)/i;
/** a size, not a level */
const NOT_LEVEL_RE = /(HEIGHT|THK|THICK|WIDTH|DIM|LINTEL|ارتفاع|سماكة)/i;

/**
 * Horizontal lines at a printed level (the label sits on its line or just above it, ≤ 15 cm) carry the
 * level's name, so the AI knows a line across the sheet is a level, not the building's width.
 */
export function markLevelLines<L extends { at: number }>(lines: L[], levels: { name: string; y?: number }[]): (L & { level?: string })[] {
  return lines.map((l) => {
    const near = levels.filter((v) => v.y != null && l.at - v.y >= -0.05 && l.at - v.y <= 0.15).sort((a, b) => Math.abs(l.at - a.y!) - Math.abs(l.at - b.y!))[0];
    return near ? { ...l, level: near.name } : l;
  });
}

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
export const DIRECTIONS = ["east", "west", "north", "south", "front", "back", "right", "left", "side"] as const;

const size = z.number().nullable();
export const facadeDraftSchema = z.object({
  code: z.string(),
  direction: z.enum(DIRECTIONS).nullable(),
  parts: z
    .array(
      z.object({
        name: z.string().describe("Arabic, e.g. «الكتلة الرئيسية — الأرضي والأول مع الدروة», «الملحق»"),
        material: z.enum(MATERIALS),
        width_m: size,
        height_m: size,
        from_m: size.describe("the printed level the part starts at, in metres (e.g. PAVEMENT LEVEL 0.20)"),
        to_m: size.describe("the printed level the part ends at, in metres (e.g. PARAPET LINE 9.80, ROOF PARAPET LINE 12.30); a part stacked on another starts at that part's to_m"),
        count: z.number(),
        fence: z.boolean().describe("true for a boundary / fence wall drawn in front of the building"),
      }),
    )
    .describe("rectangles covering the façade's visible wall surface once, no overlaps"),
  openings: z
    .array(
      z.object({
        kind: z.enum(["window", "door", "opening"]),
        width_m: size,
        height_m: size,
        count: z.number(),
        part: z.number().nullable().describe("index (0-based) of the part in `parts` the opening is cut into"),
      }),
    )
    .describe("windows / doors / gates cut into PAINTED parts only (a fence gate belongs to the fence part)"),
  notes: z.array(z.string()),
});
export type FacadeDraft = z.infer<typeof facadeDraftSchema>;

export type FacadePart = { id: string; name: string; material: Material; width_m: number | null; height_m: number | null; count: number; include: boolean };
/** `part` = the id of the part it is cut into (null = not known: taken as painted) */
export type FacadeOpening = { id: string; part: string | null; kind: "window" | "door" | "opening"; width_m: number | null; height_m: number | null; count: number };
/** `dir` names it (translated on screen); `notes` = the reading's own remarks */
export type Facade = { code: string; dir: Direction | null; include: boolean; parts: FacadePart[]; openings: FacadeOpening[]; notes: string[] };

const plausible = (v: number | null | undefined, max: number) => (v != null && Number.isFinite(v) && v > 0.05 && v <= max ? r2(v) : null);
const whole = (n: number) => (Number.isFinite(n) && n > 0 ? Math.min(100, Math.ceil(n - 1e-9)) : 1);
let seq = 0;
/** A row id (stable while the owner edits: React keys, opening → part links). */
export const rowId = (prefix: "p" | "o") => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** The AI's draft → rows for review: plausible sizes only, whole counts, ids, openings linked to their part, the fence left out by default. */
export function cleanFacade(d: FacadeDraft, levels?: { m: number }[]): Facade {
  // with the sheet's levels, a from / to counts only when it is printed there (±2 cm, the printed value)
  const printed = (v: number | null) => (v == null || !levels ? v : (levels.find((l) => Math.abs(l.m - v) <= 0.02)?.m ?? null));
  const spans: string[] = [];
  const unprinted: string[] = [];
  const parts = d.parts.slice(0, 30).map((p) => {
    const name = p.name.trim().slice(0, 80) || "—";
    const from = printed(p.from_m);
    const to = printed(p.to_m);
    // the height is the difference of the printed levels it spans — never a guess
    const span = levelsHeight(from, to);
    if (span != null) spans.push(`${name}: ${from!.toFixed(2)} → ${to!.toFixed(2)}`);
    else if (levels && (p.from_m != null || p.to_m != null)) unprinted.push(name);
    return { id: rowId("p"), name, material: p.material, width_m: plausible(p.width_m, 80), height_m: span ?? plausible(p.height_m, 40), count: whole(p.count), include: !p.fence };
  });
  const own = [
    ...(spans.length ? [spans.join(" · ")] : []),
    ...(unprinted.length ? [`${unprinted.join("، ")}: المنسوب غير مكتوب في المخطط — راجع الارتفاع`] : []),
  ];
  const openings = d.openings.slice(0, 40).map((o) => ({
    id: rowId("o"),
    part: o.part != null && Number.isInteger(o.part) && parts[o.part] ? parts[o.part].id : null,
    kind: o.kind,
    width_m: plausible(o.width_m, 12),
    height_m: plausible(o.height_m, 12),
    count: whole(o.count),
  }));
  return { code: d.code.slice(0, 10), dir: d.direction, include: true, parts, openings, notes: [...own, ...d.notes].map((n) => n.slice(0, 200)).slice(0, 8) };
}

const levelsHeight = (from: number | null | undefined, to: number | null | undefined) =>
  from != null && to != null && Number.isFinite(from) && Number.isFinite(to) && to > from && to - from <= 40 && from >= -5 ? r2(to - from) : null;

const area = (r: { width_m: number | null; height_m: number | null; count: number }) => (r.width_m ?? 0) * (r.height_m ?? 0) * r.count;

/**
 * A façade's areas: counted painted parts (gross) − the openings cut into them = paint (≥ 0); an
 * opening of an uncounted or not-painted part (the fence's gate, a stone wall) isn't subtracted, one
 * with no part is (taken as painted). Stone / glass / GRC / other listed apart.
 */
export function facadeArea(f: Pick<Facade, "parts" | "openings">) {
  const parts = f.parts.filter((p) => p.include);
  const painted = new Set(parts.filter((p) => p.material === "paint").map((p) => p.id));
  const gross = r2(parts.filter((p) => p.material === "paint").reduce((s, p) => s + area(p), 0));
  const openings = r2(f.openings.filter((o) => o.part == null || painted.has(o.part)).reduce((s, o) => s + area(o), 0));
  const other = Object.fromEntries((["stone", "glass", "grc", "other"] as const).map((m) => [m, r2(parts.filter((p) => p.material === m).reduce((s, p) => s + area(p), 0))])) as Record<Exclude<Material, "paint">, number>;
  return { gross, openings, paint: r2(Math.max(0, gross - openings)), other };
}

/** The survey's façade area: the included façades' paint areas. */
export const facadesTotal = (list: Facade[]) => r2(list.filter((f) => f.include).reduce((s, f) => s + facadeArea(f).paint, 0));

/** Rows still missing a size in the included façades (counted parts, and their openings) — said before approving. */
export function missingSizes(list: Facade[]): number {
  let n = 0;
  for (const f of list.filter((x) => x.include)) {
    const counted = new Set(f.parts.filter((p) => p.include).map((p) => p.id));
    n += f.parts.filter((p) => p.include && (p.width_m == null || p.height_m == null)).length;
    n += f.openings.filter((o) => (o.part == null || counted.has(o.part)) && (o.width_m == null || o.height_m == null)).length;
  }
  return n;
}

/** A new reading joins the approved façades: the same code is replaced, the others kept (by code). */
export function mergeFacades(saved: Facade[] | null, read: Facade[]): Facade[] {
  const byCode = new Map((saved ?? []).map((f) => [f.code, f]));
  for (const f of read) byCode.set(f.code, f);
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** What is stored on the survey (validated on the server; sizes fit the database's 256 KB). */
const num = z.number().min(0).max(80).nullable();
const id = z.string().trim().min(1).max(24);
export const facadesSchema = z
  .array(
    z
      .object({
        code: z.string().trim().min(1).max(10),
        dir: z.enum(DIRECTIONS).nullable(),
        include: z.boolean(),
        parts: z
          .array(
            z
              .object({
                id,
                // an emptied name is kept as «—», never a refusal of the whole review
                name: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? "—" : v), z.string().trim().min(1).max(80)),
                material: z.enum(MATERIALS),
                width_m: num,
                height_m: num,
                count: z.number().int().min(1).max(100),
                include: z.boolean(),
              })
              .strict(),
          )
          .max(30),
        openings: z.array(z.object({ id, part: id.nullable(), kind: z.enum(["window", "door", "opening"]), width_m: num, height_m: num, count: z.number().int().min(1).max(100) }).strict()).max(40),
        notes: z.array(z.string().max(200)).max(8),
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
    direction: z.enum(DIRECTIONS).nullable(),
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
