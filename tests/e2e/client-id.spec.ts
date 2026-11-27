import { expect, test } from "@playwright/test";

/** The client's ID number is asked on his page only when his record has none (owner, Nov 2026). */
test("accepting the quote asks for a valid ID number when it's missing", async ({ page }) => {
  await page.goto("/dev/preview/portal/quote-no-id");
  const accept = page.getByRole("button", { name: /أوافق على العرض/ });
  await page.getByRole("radio").first().click();
  await page.getByRole("checkbox").check();
  const id = page.getByLabel(/رقم الهوية أو الإقامة/);
  await expect(accept).toBeDisabled();
  await id.fill("12345");
  await expect(accept).toBeDisabled();
  // a commercial registration has no check digit: a warning, never a refusal
  await id.fill("1010123456");
  await expect(page.getByText("تأكد من الرقم قبل الموافقة")).toBeVisible();
  await expect(accept).toBeEnabled();
  await id.fill("١٠٠٠٠٠٠٠٠٨");
  await expect(page.getByText("تأكد من الرقم قبل الموافقة")).toHaveCount(0);
  await expect(accept).toBeEnabled();
});

test("a client with an ID number on record isn't asked", async ({ page }) => {
  await page.goto("/dev/preview/portal/quote");
  await expect(page.getByLabel(/رقم الهوية أو الإقامة/)).toHaveCount(0);
});

test("the contract asks for it too when still missing", async ({ page }) => {
  await page.goto("/dev/preview/portal/contract-no-id");
  const accept = page.getByRole("button", { name: /^أوافق/ }).last();
  await page.getByRole("checkbox").last().check();
  await expect(accept).toBeDisabled();
  await page.getByLabel(/رقم الهوية أو الإقامة/).fill("2000000006");
  await expect(accept).toBeEnabled();
  await page.goto("/dev/preview/portal");
  await expect(page.getByLabel(/رقم الهوية أو الإقامة/)).toHaveCount(0);
});
