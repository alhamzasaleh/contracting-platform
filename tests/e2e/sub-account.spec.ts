import { expect, test } from "@playwright/test";

/* Subcontractor account (owner, Nov 2026): totals over all projects, statement, vouchers, his own page. */
test("subcontractors page: his account across projects, statement, voucher numbers, his page link", async ({ page }) => {
  await page.goto("/dev/preview/purchases/subcontractors");
  await expect(page.getByText("حسابه في كل المشاريع (1)").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "كشف الحساب" }).first()).toHaveAttribute("href", "/dev/preview/print/subcontractors/SC-2026-001/statement");
  await expect(page.getByRole("link", { name: "SP-2026-001" })).toHaveAttribute("href", "/dev/preview/print/sub-payments/SP-2026-001");
  const link = page.getByTestId("sub-link").first();
  await link.getByRole("button", { name: "رابط جديد (يلغي القديم)" }).click();
  await expect(link.getByText("https://example.test/s/SC-2026-001/preview")).toBeVisible();
});

test("statement: every entry by date with a running balance", async ({ page }) => {
  await page.goto("/dev/preview/print/subcontractors/SC-2026-001/statement");
  const doc = page.getByTestId("sub-statement");
  await expect(doc.getByText("كشف حساب مقاول باطن")).toBeVisible();
  await expect(doc.getByText("دفعة مصروفة")).toBeVisible();
  // 1800 + 2400 earned − 1800 paid = 2400 due
  await expect(doc.getByText(/2,400\.00/).first()).toBeVisible();
});

test("his page: projects, payments with vouchers, statement PDF", async ({ page }) => {
  await page.goto("/dev/preview/sub-page");
  await expect(page.getByTestId("sub-item")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "SP-2026-001" })).toHaveAttribute("href", "/s/SC-2026-001/previewtoken0001/voucher/SP-2026-001");
  await expect(page.getByRole("link", { name: /تحميل كشف الحساب PDF/ })).toHaveAttribute("href", "/s/SC-2026-001/previewtoken0001/pdf/statement");
});

test("payment voucher document", async ({ page }) => {
  await page.goto("/dev/preview/print/sub-payments/SP-2026-001");
  const doc = page.getByTestId("sub-voucher");
  await expect(doc.getByText("سند صرف")).toBeVisible();
  await expect(doc.getByText(/مؤسسة الإتقان للجبس/).first()).toBeVisible();
});

test("project page: its subcontractors, linked to their card", async ({ page }) => {
  await page.goto("/dev/preview/projects/detail");
  const box = page.getByTestId("project-subs");
  await expect(box.getByRole("link", { name: /مؤسسة الإتقان للجبس/ })).toHaveAttribute("href", "/dev/preview/purchases/subcontractors?s=SC-2026-001#SC-2026-001");
});
