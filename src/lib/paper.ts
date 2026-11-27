/**
 * Documents on screen are one sheet of paper (owner, Nov 2026): the same layout on every
 * device, scaled as a whole to the screen's width (like a PDF), never re-flowed. Print / PDF
 * use the page itself (no scaling).
 */

/** a portrait document's sheet width on screen (≈ A4's printable width + its margins) */
export const PAPER_WIDTH = 760;
/** landscape documents (the priced bill of quantities, the framing plan) */
export const PAPER_WIDE = 1000;

/** how much the sheet shrinks to fit `container` px; never grows past its own size */
export function paperScale(container: number, width: number): number {
  if (!Number.isFinite(container) || container <= 0 || width <= 0) return 1;
  return Math.min(1, container / width);
}
