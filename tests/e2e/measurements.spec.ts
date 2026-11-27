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

test("owed to the client: the amount is said and finance records the payment back", async ({ page }) => {
  await page.goto("/dev/preview/projects/detail-credit");
  await expect(page.getByText(/مبلغ مستحق للعميل من تسوية الأمتار/)).toBeVisible();
  await page.getByRole("button", { name: "تسجيل صرف المبلغ للعميل" }).click();
  await expect(page.getByRole("dialog").getByText(/MS-2026-003/)).toBeVisible();
});

test("lump-sum contract: no measurement sheet", async ({ page }) => {
  await page.goto("/dev/preview/projects/detail-lump");
  await expect(page.getByText("العقد بمبلغ مقطوع — ما فيه تسوية أمتار.")).toBeVisible();
  await expect(page.getByRole("button", { name: "كشف قياس جديد" })).toHaveCount(0);
});

test("client page: credit notes and the payments after the settlement", async ({ page }) => {
  await page.goto("/dev/preview/portal/work");
  await expect(page.getByRole("heading", { name: "الإشعارات الدائنة" })).toBeVisible();
  await expect(page.getByText("الدفعات بعد تسوية الأمتار").first()).toBeVisible();
});

test("credit note document", async ({ page }) => {
  await page.goto("/dev/preview/print/credit-notes/CN-2026-001");
  await expect(page.getByText("إشعار دائن ضريبي")).toBeVisible();
  await expect(page.getByText("INV-2026-009")).toBeVisible();
});
