import { expect, test } from "@playwright/test";

/**
 * «قراءة الواجهات من المخطط» (owner, Nov 2026): the review shows each façade's parts and openings;
 * the paint area follows every edit, and only included façades / parts count.
 */
test("façade review: paint area follows the rows; the fence is out until ticked", async ({ page }) => {
  await page.goto("/dev/preview/clients/survey");
  await page.getByRole("button", { name: "قراءة الواجهات من المخطط" }).click();
  // design preview: picking a file shows the sample reading
  await page.locator('input[type="file"][accept="application/pdf"]').last().setInputFiles({ name: "plan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("الواجهة الشرقية")).toBeVisible();
  // east: (10.86 × 9.3) + (10.86 × 1.1) + (5.4 × 3.3) = 130.76 − 3 × (1.6 × 1.8) − (0.6 × 1.8) = 121.04
  await expect(dialog.getByText("الدهان: 121.04")).toBeVisible();
  // west: 13.05 × 9.3 = 121.37 − 1.2 × 2.4 = 118.49 (stone and glass apart; a window without its width counts nothing yet)
  await expect(dialog.getByText("الدهان: 118.49")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /اعتماد مساحة الواجهات \(239.53/ })).toBeVisible();
  // a window without its width is said before approving
  await expect(dialog.getByText("فيه 1 صفوف ناقصة المقاس")).toBeVisible();
  // tick the fence (12.2 × 2.2 = 26.84) — its gate (3 × 2) is subtracted only now: east 141.88, total 260.37
  await dialog.getByRole("checkbox", { name: "محسوب" }).nth(3).check();
  await expect(dialog.getByText("الدهان: 141.88")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /260.37/ })).toBeVisible();
  // leave the west façade out
  await dialog.getByRole("checkbox", { name: "ضمن الدهان" }).nth(1).uncheck();
  await expect(dialog.getByRole("button", { name: /141.88/ })).toBeVisible();
});

test("approved façades: the summary under the exterior totals, a different typed area is said, review reopens", async ({ page }) => {
  await page.goto("/dev/preview/clients/survey/facades");
  const summary = page.getByTestId("facade-summary");
  await expect(summary.getByText("الواجهة الشرقية")).toBeVisible();
  await expect(summary.getByText("121.04")).toBeVisible();
  await expect(summary.getByText(/المساحة المكتوبة تختلف/)).toBeVisible();
  await page.getByRole("button", { name: "مراجعة الواجهات" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "إزالة قراءة الواجهات" })).toBeVisible();
});
