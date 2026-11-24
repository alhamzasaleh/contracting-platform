import fs from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { layoutIssues } from "./layout-check";

/**
 * Layout guard: every design-preview page, at every phone / iPad / desktop
 * width, with the dialogs and inline forms its buttons open. Fails on any
 * sideways scroll, control outside its card or dialog, cut text in a field,
 * misaligned fields in one row, or a large empty hole in a grid
 * (see layout-check.ts).
 *
 * Runs as its own Playwright project: `npm run test:layout` (CI job "layout").
 */

const SIZES: [number, number][] = [
  [320, 640],
  [360, 740],
  [390, 844],
  [768, 1024],
  [820, 1180],
  [1024, 768],
  [1180, 820],
  [1440, 900],
];
/** sizes at which every button is pressed and the dialogs / forms it opens are checked */
const CLICK_SIZES = new Set([320, 390, 820, 1180, 1440]);
/** English (left-to-right) is checked at these sizes, page only */
const ENGLISH_SIZES = new Set([390, 1180]);
/** English: the dialogs are opened at this size */
const ENGLISH_CLICK_SIZE = 390;

/** dynamic preview segments → the sample values to open */
const PARAMS: Record<string, string> = { "[code]": "gypsum" };

function previewRoutes(): string[] {
  const dir = path.join(process.cwd(), "src/app/dev/preview");
  const found: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "page.tsx") {
        const rel = path
          .relative(dir, path.dirname(p))
          .split(path.sep)
          .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")))
          .map((s) => PARAMS[s] ?? s)
          .join("/");
        found.push(`/dev/preview${rel ? `/${rel}` : ""}`);
      }
    }
  };
  walk(dir);
  return found.sort();
}

/** fonts loaded and entrance animations (CSS and motion) finished, so boxes are where they end up */
async function settle(page: Page, ms = 150) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
  await page
    .waitForFunction(
      () =>
        document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity) &&
        ![...document.querySelectorAll<HTMLElement>("[style*='opacity']")].some((e) => {
          const o = parseFloat(e.style.opacity);
          return o > 0 && o < 1;
        }),
      null,
      { timeout: 3000, polling: 100 },
    )
    .catch(() => {});
}

async function open(page: Page, url: string) {
  // a pressed button may still be navigating away (e.g. "price this service"): let it land, then come back
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await page.goto(url, { waitUntil: "load" });
      // a missing page (404) or a crash must fail, not pass as "no layout problems"
      expect(res?.ok(), `${url} answered ${res?.status()}`).toBe(true);
      break;
    } catch (e) {
      if (attempt >= 2 || !/interrupted by another navigation/.test(String(e))) throw e;
      await page.waitForLoadState("load").catch(() => {});
    }
  }
  await settle(page, 700);
}

/** every button in the page and its top bar (bell, search, menu…): what each one opens is checked */
let BUTTONS = "main button:visible, header button:visible";
const labelsNow = (page: Page) =>
  page.locator(BUTTONS).evaluateAll((bs) => bs.map((b) => (b.getAttribute("aria-label") || (b as HTMLElement).innerText || "").replace(/\s+/g, " ").trim()));

/** Presses every button once (by label) and checks the dialog / inline form / new state it leaves. */
async function pressAll(page: Page, context: BrowserContext, route: string, where: string, add: (w: string, f: string[]) => void, english = false) {
  const done = new Set<string>();
  // pages without the app shell (client page, sign-in, receipt): every button on the page
  BUTTONS = (await page.locator("main").count()) ? "main button:visible, header button:visible" : "body button:visible";
  const reopen = async () => {
    // a button that switches the language (Settings → preferences, top bar) must not leak into the next checks
    await context.clearCookies();
    if (english) await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: new URL(page.url()).origin }]);
    await open(page, route);
  };
  let labels = await labelsNow(page);
  for (let i = 0; i < labels.length; i++) {
    const b = page.locator(BUTTONS).nth(i);
    const label = labels[i].slice(0, 40);
    const key = label.replace(/[\d٠-٩.,،]+/g, "#");
    if (done.has(key)) continue;
    done.add(key);
    try {
      if (!(await b.isVisible()) || (await b.isDisabled())) continue;
      await b.click({ timeout: 1500 });
      await settle(page);
      const dialog = page.locator("[role=dialog]:visible, [role=alertdialog]:visible");
      const open1 = (await dialog.count()) > 0;
      add(open1 ? `${where} [dialog «${label}»]` : `${where} [after «${label}»]`, await page.evaluate(layoutIssues));
      // close whatever the press opened — a dialog, a menu or a popover (a menu left open blocks every later press)
      if (open1 || (await page.locator("[role=menu]:visible, [data-radix-popper-content-wrapper]").count())) {
        await page.keyboard.press("Escape");
        await settle(page);
      }
      const lang = (await context.cookies()).find((c) => c.name === "NEXT_LOCALE")?.value;
      const left = new URL(page.url()).pathname !== route;
      // the press changed the page (an inline form, another tab…): start again from a fresh page so the
      // buttons still line up with the labels read at the start
      const changed = !left && JSON.stringify(await labelsNow(page)) !== JSON.stringify(labels);
      if (left || changed || lang !== (english ? "en" : undefined)) {
        await reopen();
        labels = await labelsNow(page);
      }
    } catch {
      // a button that can't be pressed (covered, detached) isn't a layout problem: start from a fresh page
      await reopen();
      labels = await labelsNow(page);
    }
  }
}

test.describe("layout on every screen size", () => {
  test.describe.configure({ mode: "parallel" });
  test.use({ reducedMotion: "reduce" });

  for (const route of previewRoutes()) {
    test(`${route}`, async ({ page, context, baseURL }) => {
      test.setTimeout(20 * 60_000);
      await page.addInitScript(() => {
        window.print = () => {};
      });
      page.on("dialog", (d) => d.dismiss().catch(() => {}));
      const issues: string[] = [];
      const add = (where: string, found: string[]) => found.forEach((f) => issues.push(`${where}: ${f}`));

      for (const [w, h] of SIZES) {
        await context.clearCookies();
        await page.setViewportSize({ width: w, height: h });
        await open(page, route);
        add(`${w}px`, await page.evaluate(layoutIssues));
        if (CLICK_SIZES.has(w)) await pressAll(page, context, route, `${w}px`, add);

        if (ENGLISH_SIZES.has(w)) {
          await context.clearCookies();
          await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL! }]);
          await open(page, route);
          add(`${w}px [English]`, await page.evaluate(layoutIssues));
          // dialogs in English too (one size is enough)
          if (w === ENGLISH_CLICK_SIZE) await pressAll(page, context, route, `${w}px [English]`, add, true);
        }
      }
      expect([...new Set(issues)], `layout problems on ${route}`).toEqual([]);
    });
  }
});
