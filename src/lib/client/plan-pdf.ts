"use client";

import { floorLabels, isFloorPlan, labelRegion, metresPerPoint, planScale, planTitle, tileGrid, PLAN_SHEET_MAX_BYTES, PLAN_TILE_MAX_BYTES, type Box, type PlanSheet, type PlanToken } from "@/lib/survey/plan";

/**
 * Browser side of «قراءة من المخطط»: pdf.js opens the architect's PDF on the device (files of 30–60 MB
 * never travel), finds the floor-plan sheets from their text, and for a chosen sheet renders the
 * drawing around its room tags into JPEG tiles + the printed text in metres — what readPlanAi needs.
 */

type PdfDoc = import("pdfjs-dist").PDFDocumentProxy;
type PdfPage = import("pdfjs-dist").PDFPageProxy;

export type FoundSheet = { page: number; title: string; prefix: string; rooms: number; scale: number; width: number; height: number; tokens: PlanToken[] };

// the legacy build carries polyfills for older Safari (iPad) that the modern build expects natively
let lib: Promise<typeof import("pdfjs-dist")> | null = null;
function pdfjs() {
  lib ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    return m;
  });
  return lib;
}

/** A real PDF starts with «%PDF-». */
export async function looksLikePdf(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === "%PDF-";
}

/** Every text item as a token at its centre, in points from the page's top-left corner. */
async function pageTokens(page: PdfPage): Promise<{ tokens: PlanToken[]; text: string; width: number; height: number }> {
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const tokens: PlanToken[] = [];
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const s = item.str.trim();
    if (!s) continue;
    const [a, b, , , e, f] = item.transform as number[];
    const len = Math.hypot(a, b) || 1;
    // centre of the run along its own direction (vertical dimensions are rotated text)
    const cx = e + (item.width / 2) * (a / len);
    const cy = f + (item.width / 2) * (b / len);
    const [x, y] = vp.convertToViewportPoint(cx, cy);
    tokens.push({ s: s.slice(0, 40), x, y });
  }
  return { tokens, text: tokens.map((t) => t.s).join(" "), width: vp.width, height: vp.height };
}

/** Open the file and list its floor-plan sheets (`progress` gets pages read / total). */
export async function findPlanSheets(file: File, progress?: (done: number, total: number) => void): Promise<{ doc: PdfDoc; pages: number; sheets: FoundSheet[] }> {
  const m = await pdfjs();
  const doc = await m.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const sheets: FoundSheet[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { tokens, text, width, height } = await pageTokens(page);
    page.cleanup();
    progress?.(n, doc.numPages);
    if (!isFloorPlan(text, tokens)) continue;
    const f = floorLabels(tokens)!;
    sheets.push({ page: n, title: planTitle(text, f.prefix), prefix: f.prefix, rooms: new Set(f.labels.map((l) => l.s)).size, scale: planScale(text), width, height, tokens });
  }
  return { doc, pages: doc.numPages, sheets };
}

async function toJpeg(canvas: HTMLCanvasElement, budget: number): Promise<Blob> {
  for (const q of [0.82, 0.7, 0.55, 0.4, 0.3]) {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", q));
    if (blob && blob.size <= budget) return blob;
  }
  throw new Error("tile too large");
}

/** Render the sheet's drawing (around its room tags) into tiles + the text in metres from the drawing's corner. */
export async function sheetPayload(doc: PdfDoc, sheet: FoundSheet, surveyId: string): Promise<{ meta: PlanSheet; tiles: Blob[] }> {
  const page = await doc.getPage(sheet.page);
  const f = floorLabels(sheet.tokens)!;
  const region = labelRegion(f.labels, sheet.scale, sheet);
  // ~3.5 px per point keeps 4–5 pt dimension text readable; the grid lowers it for huge sheets
  const { zoom, tiles } = tileGrid(region, 3.5);
  const mpp = metresPerPoint(sheet.scale);
  const toM = (t: PlanToken) => ({ s: t.s, x: round((t.x - region.x0) * mpp), y: round((t.y - region.y0) * mpp) });
  const inside = (t: PlanToken) => t.x >= region.x0 && t.x <= region.x1 && t.y >= region.y0 && t.y <= region.y1;
  const blobs: Blob[] = [];
  // each tile gets its share of the request budget (the server refuses a bigger sheet)
  const budget = Math.min(PLAN_TILE_MAX_BYTES, Math.floor(PLAN_SHEET_MAX_BYTES / tiles.length));
  for (const tile of tiles) blobs.push(await renderTile(page, tile, zoom, budget));
  page.cleanup();
  const box = (b: Box) => ({ x0: round((b.x0 - region.x0) * mpp), y0: round((b.y0 - region.y0) * mpp), x1: round((b.x1 - region.x0) * mpp), y1: round((b.y1 - region.y0) * mpp) });
  return {
    meta: {
      survey_id: surveyId,
      page: sheet.page,
      title: sheet.title.slice(0, 80),
      scale: sheet.scale,
      labels: f.labels.map(toM).slice(0, 200),
      words: sheet.tokens.filter(inside).map(toM).slice(0, 3000),
      tiles: tiles.map(box),
    },
    tiles: blobs,
  };
}

const round = (v: number) => Math.round(v * 100) / 100;

async function renderTile(page: PdfPage, tile: Box, zoom: number, budget: number): Promise<Blob> {
  const w = Math.ceil((tile.x1 - tile.x0) * zoom);
  const h = Math.ceil((tile.y1 - tile.y0) * zoom);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  const viewport = page.getViewport({ scale: zoom, offsetX: -tile.x0 * zoom, offsetY: -tile.y0 * zoom });
  await page.render({ canvas, canvasContext: ctx, viewport, background: "#ffffff" }).promise;
  const blob = await toJpeg(canvas, budget);
  canvas.width = canvas.height = 0; // free the memory at once (iPad)
  return blob;
}
