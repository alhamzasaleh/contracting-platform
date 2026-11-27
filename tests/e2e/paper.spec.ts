import { expect, test } from "@playwright/test";

/**
 * A document is one sheet of paper on every screen (owner, Nov 2026): the same layout as on a
 * wide screen, scaled as a whole — never re-flowed, no column hidden behind a sideways scroll.
 */
for (const width of [360, 820, 1280]) {
  test(`the quote on the client page at ${width}px keeps the paper's layout`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dev/preview/portal/quote");
    const sheet = page.locator(".paper-sheet").first();
    await expect(sheet).toBeVisible();
    const fit = await sheet.evaluate((el) => {
      const zoom = Number(getComputedStyle(el).zoom || "1");
      const box = el.getBoundingClientRect();
      const amount = el.querySelector("thead th:last-child")!.getBoundingClientRect();
      const title = el.querySelector("header > div:last-child")!.getBoundingClientRect();
      const org = el.querySelector("header > div:first-child")!.getBoundingClientRect();
      const table = el.querySelector("table")!.parentElement!;
      return {
        zoom,
        inside: box.left >= -1 && box.right <= window.innerWidth + 1,
        amountVisible: amount.left >= box.left - 1 && amount.right <= box.right + 1,
        sameRow: Math.abs(title.top - org.top) < 30,
        tableScrolls: table.scrollWidth > table.clientWidth + 1,
      };
    });
    expect(fit.inside).toBe(true);
    expect(fit.amountVisible).toBe(true);
    expect(fit.sameRow).toBe(true);
    expect(fit.tableScrolls).toBe(false);
    if (width < 800) expect(fit.zoom).toBeLessThan(1);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways).toBeLessThanOrEqual(1);
  });
}

test("print keeps the page's own size (no scaling)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto("/dev/preview/portal/quote");
  await page.emulateMedia({ media: "print" });
  const zoom = await page.locator(".paper-sheet").first().evaluate((el) => getComputedStyle(el).zoom);
  expect(Number(zoom)).toBe(1);
});
