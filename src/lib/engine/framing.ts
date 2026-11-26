/**
 * Ceiling framing for the technician (owner, Nov 2026): per room where every C channel, omega and
 * hanger goes, and per bar which pieces it is cut into. Pure — fed by the frozen `GypsumFraming`
 * of a quote version, so the drawing always matches the quantities that were priced.
 */
import { cutIdentical } from "./cutting";
import { gridLines } from "./gypsum";

const EPS = 1e-6;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export type FramingRoom = {
  id: string;
  name: string;
  /** floor / villa (survey unit label), so two «bedroom 1» stay apart */
  unit?: string | null;
  L: number;
  W: number;
  /** C channels run along the room's length or width */
  cAlong: "length" | "width";
  channels: number;
  omegas: number;
  channelLength: number;
  omegaLength: number;
  hangers: number;
};

/** What a priced gypsum version froze for the framing document. */
export type GypsumFraming = {
  grid: number;
  hangerSpacing: number;
  hangingHeight: number;
  cutAllowance: number;
  suspension: "rod" | "vertical_c";
  bars: { c: number; omega: number; angle: number; hanger: number };
  /** extra omega of the light troughs (m) */
  troughOmega: number;
  troughHangers: number;
  rooms: FramingRoom[];
  /** which metal is in the bill of quantities (false = supplied by the client / labour only) */
  listed: { c: boolean; omega: boolean; angle: boolean; hanger: boolean };
};

/** «name · floor» — the label the technician reads on the plan and the cut list. */
export const roomLabel = (r: Pick<FramingRoom, "name" | "unit">) => (r.unit ? `${r.name} · ${r.unit}` : r.name);

/** Offsets (m) of n grid lines from the start wall: one spacing apart, the first one spacing in. */
export function linePositions(span: number, spacing: number): number[] {
  const n = gridLines(span, spacing);
  if (n === 0) return [];
  // a strip narrower than the spacing: its one line in the middle
  if (spacing >= span) return [r3(span / 2)];
  return Array.from({ length: n }, (_, i) => r3((i + 1) * spacing));
}

/** Hanger offsets along one channel (same count as the engine: ceil(run ÷ spacing) + 1, evenly spaced). */
export function hangerPositions(run: number, spacing: number): number[] {
  if (run <= 0 || spacing <= 0) return [];
  const n = Math.ceil(run / spacing - 1e-9) + 1;
  return Array.from({ length: n }, (_, i) => r3((run * i) / (n - 1)));
}

export type Piece = { length: number; label: string };
export type CutBar = { pieces: Piece[]; offcut: number };
/** Identical bars grouped: «× count». */
export type CutPattern = { count: number; pieces: Piece[]; offcut: number; full: boolean };

/**
 * The same cutting as `cutToBars` (whole bars out of long runs, the rests first-fit-decreasing with
 * offcut reuse), keeping which room each piece is for. Bar count always equals cutToBars'.
 */
export function cutPlan(runs: Piece[], stock: number): { bars: number; patterns: CutPattern[] } {
  if (stock <= 0) return { bars: 0, patterns: [] };
  const full = new Map<string, number>();
  const rests: Piece[] = [];
  for (const r of runs) {
    if (r.length <= EPS) continue;
    const whole = Math.floor((r.length + EPS) / stock);
    const rest = r.length - whole * stock;
    if (whole > 0) full.set(r.label, (full.get(r.label) ?? 0) + whole);
    // exact rests, as cutToBars packs them (rounding first could fit one piece too many on a bar)
    if (rest > EPS) rests.push({ length: rest, label: r.label });
  }
  // stable: longest first, then by room so a bar's pieces read in order
  rests.sort((a, b) => b.length - a.length || a.label.localeCompare(b.label));
  const bars: { pieces: Piece[]; left: number }[] = [];
  for (const p of rests) {
    const b = bars.find((x) => x.left + EPS >= p.length);
    if (b) {
      b.pieces.push(p);
      b.left -= p.length;
    } else bars.push({ pieces: [p], left: stock - p.length });
  }
  const patterns: CutPattern[] = [...full].map(([label, count]) => ({ count, pieces: [{ length: stock, label }], offcut: 0, full: true }));
  const byKey = new Map<string, CutPattern>();
  for (const b of bars) {
    const offcut = r3(Math.max(0, b.left));
    const pieces = b.pieces.map((p) => ({ length: r3(p.length), label: p.label }));
    const key = pieces.map((p) => `${p.length}@${p.label}`).join("|");
    const hit = byKey.get(key);
    if (hit) hit.count += 1;
    else byKey.set(key, { count: 1, pieces, offcut, full: false });
  }
  patterns.push(...byKey.values());
  const total = [...full.values()].reduce((a, b) => a + b, 0) + bars.length;
  return { bars: total, patterns };
}

/** The runs of the framing, labelled by room (and «trough» for the light-trough omega). */
export function framingRuns(f: GypsumFraming, troughLabel: string) {
  const c: Piece[] = [];
  const omega: Piece[] = [];
  const angle: Piece[] = [];
  for (const r of f.rooms) {
    const label = roomLabel(r);
    for (let i = 0; i < r.channels; i++) c.push({ length: r.channelLength, label });
    for (let i = 0; i < r.omegas; i++) omega.push({ length: r.omegaLength, label });
    angle.push({ length: r.L, label }, { length: r.L, label }, { length: r.W, label }, { length: r.W, label });
  }
  if (f.troughOmega > 0) omega.push({ length: f.troughOmega, label: troughLabel });
  return { c, omega, angle };
}

/** Hanger pieces: how many come out of one bar / rod. */
export function hangerCut(f: GypsumFraming) {
  const piece = r3(f.hangingHeight + f.cutAllowance);
  const total = f.rooms.reduce((s, r) => s + r.hangers, 0) + f.troughHangers;
  // a piece longer than the bar can't come out of one: said apart (joined), never «1 per bar»
  const longer = piece > f.bars.hanger + EPS;
  const perBar = piece > 0 && !longer ? Math.floor((f.bars.hanger + EPS) / piece) : 0;
  // the bar count is the engine's own (cutIdentical), so it always matches the bill of quantities
  return { piece, total, perBar, longer, bars: cutIdentical(total, piece, f.bars.hanger).bars, offcut: longer ? 0 : r3(Math.max(0, f.bars.hanger - perBar * piece)) };
}
