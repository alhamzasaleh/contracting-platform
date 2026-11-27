import { expect, test } from "@playwright/test";

/*
 * Measurement sheets (owner, Nov 2026): staff record the actual m² per work type, the client signs or comments
 * on his page, the difference (contract price per m², discount, VAT) is settled in the final payment.
 */
test("project page: the sheets, the client's comment, edit with a live difference", async ({ page }) => {
  await page.goto("/dev/preview/projects/detail");
  const card = page.locator("#measurements");
  await expect(card.getByText("كشوف القياس", { exact: true })).toBeVisible();
  await expect(card.getByText("وقّعه العميل")).toBeVisible();
  await expect(card.getByText(/القواطع 39 م²/)).toBeVisible();
  // the settlement payment is listed with the project's payments
  await expect(page.getByText("4. تسوية الأمتار")).toBeVisible();
  await card.getByRole("button", { name: "تعديل", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/قواطع/).fill("39");
  // −1 m² × 95 = −95 · VAT 15 % → 109.25 off for the client
  await expect(dialog.getByText("المبلغ المخصوم للعميل")).toBeVisible();
  await expect(dialog.getByText(/109\.25/)).toBeVisible();
});

test("client page: the sheet is read first, then signed — or a comment is sent", async ({ page }) => {
  await page.goto("/dev/preview/portal/work");
  await page.getByRole("link", { name: "انزل لكشف القياس" }).click();
  const box = page.locator("#measurements");
  await expect(box).toBeInViewport();
  await expect(box.getByRole("button", { name: "أوافق وأوقّع" })).toBeDisabled(); // no signature yet
  await box.getByRole("button", { name: "عندي ملاحظة" }).click();
  await expect(box.getByLabel("اكتب ملاحظتك على القياس")).toBeVisible();
  await expect(box.getByRole("button", { name: "إرسال الملاحظة" })).toBeDisabled();
});

test("printed sheet: agreed vs actual, the difference and the client's signature", async ({ page }) => {
  await page.goto("/dev/preview/print/measurements/MS-2026-001");
  await expect(page.getByText("كشف قياس الأعمال المنفذة")).toBeVisible();
  await expect(page.getByText("المبلغ الإضافي على العميل")).toBeVisible();
  await expect(page.getByText(/وقّعه م\. خالد/)).toBeVisible();
});

test("contract page: the value after the quantity settlement", async ({ page }) => {
  await page.goto("/dev/preview/contracts/detail");
  await expect(page.getByText("قيمة العقد بعد تسوية الأمتار (شامل الضريبة)")).toBeVisible();
  await expect(page.getByRole("link", { name: "افتح كشوف القياس في صفحة المشروع" })).toHaveAttribute("href", "/dev/preview/projects/C-2026-004#measurements");
});
