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
  // tick the fence (12.2 × 2.2 = 26.84): east 147.88, total 266.37
  await dialog.getByRole("checkbox", { name: "محسوب" }).nth(3).check();
  await expect(dialog.getByText("الدهان: 147.88")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /266.37/ })).toBeVisible();
  // leave the west façade out
  await dialog.getByRole("checkbox", { name: "ضمن الدهان" }).nth(1).uncheck();
  await expect(dialog.getByRole("button", { name: /147.88/ })).toBeVisible();
});
