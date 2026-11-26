import { expect, test, type Page } from "@playwright/test";

/**
 * Map backgrounds (owner, Nov 2026): OpenFreeMap vector maps («خريطة» Liberty, «هادئة» Positron),
 * satellite from Esri, and the OpenStreetMap images by themselves when a vector map can't load.
 * The real OpenFreeMap host isn't reachable from the test machine, so its style is answered here.
 */
const STYLE = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#d9cbb5" } }] };

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("the vector map draws (worker from our origin, nothing blocked by the CSP)", async ({ page }) => {
  const styles: string[] = [];
  await page.route("https://tiles.openfreemap.org/styles/**", (r) => (styles.push(r.request().url()), r.fulfill({ json: STYLE })));
  await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  const errors = watchErrors(page);
  await page.addInitScript(() => localStorage.removeItem("map-layer"));
  const worker = page.waitForRequest((r) => r.url().includes("/maplibre/maplibre-gl-worker.mjs"));
  await page.goto("/dev/preview/projects/map");
  await expect(page.locator(".leaflet-gl-layer, .maplibregl-canvas").first()).toBeAttached({ timeout: 15_000 });
  await worker;
  // the style's own colour is on screen = MapLibre really drew it
  await expect
    .poll(async () => {
      const shot = await page.locator(".leaflet-gl-layer").first().screenshot();
      return shot.toString("base64").length > 0 && (await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>(".leaflet-gl-layer canvas, canvas.maplibregl-canvas");
        if (!c) return "";
        const g = c.getContext("webgl2", { preserveDrawingBuffer: true }) ?? c.getContext("webgl");
        if (!g) return "";
        const px = new Uint8Array(4);
        g.readPixels(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1, g.RGBA, g.UNSIGNED_BYTE, px);
        return Array.from(px.slice(0, 3)).join(",");
      }));
    }, { timeout: 10_000 })
    .not.toBe("");
  expect(styles.some((u) => u.endsWith("/styles/liberty"))).toBe(true);
  // the credit OpenFreeMap asks for
  await expect(page.locator(".leaflet-control-attribution").first()).toContainText("OpenFreeMap");
  await expect(page.locator(".leaflet-control-attribution").first()).toContainText("OpenStreetMap");
  await page.getByRole("button", { name: "هادئة" }).first().click();
  await expect.poll(() => styles.some((u) => u.endsWith("/styles/positron"))).toBe(true);
  await expect(page.locator(".leaflet-gl-layer, .maplibregl-canvas").first()).toBeAttached();
  await page.getByRole("button", { name: "ستلايت" }).first().click();
  await expect(page.locator('img.leaflet-tile[src*="arcgisonline"]').first()).toBeAttached();
  await expect(page.locator(".leaflet-gl-layer")).toHaveCount(0);
  expect(errors.filter((e) => /Content Security Policy|worker|maplibre/i.test(e))).toEqual([]);
});

test("when OpenFreeMap doesn't answer, the OpenStreetMap images come back by themselves", async ({ page }) => {
  await page.route("https://tiles.openfreemap.org/**", (r) => r.abort());
  await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem("map-layer", "light"));
  await page.goto("/dev/preview/projects/map");
  await expect(page.locator('img.leaflet-tile[src*="tile.openstreetmap.org"]').first()).toBeAttached({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "هادئة" }).first()).toHaveAttribute("aria-pressed", "true");
});
