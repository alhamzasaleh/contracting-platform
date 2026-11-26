import { expect, test } from "@playwright/test";

/**
 * One place for the site (owner, Nov 2026): a pasted link sets the pin, then the city and district
 * fill themselves — and the pin must stay (the late address answer once put the old pin back).
 */
test("a pasted link sets the pin, fills the district, and the pin stays", async ({ page }) => {
  await page.goto("/dev/preview/clients/detail");
  await page.getByRole("button", { name: "معاينة جديدة — غرفة غرفة" }).or(page.getByRole("button", { name: /غرفة غرفة/ })).first().click();
  await page.getByText("موقع ثاني").click();
  await page.locator("#sv-site-link").fill("https://www.google.com/maps/place/x/@24.8031,46.6105,17z");
  await expect(page.locator("#sv-district")).toHaveValue("الملقا");
  await expect(page.locator("#sv-city")).toHaveValue("الرياض");
  // the pin is still set after the address arrived
  await expect(page.getByText("تم تحديد الموقع.")).toBeVisible();
  await expect(page.getByText("حدد الموقع الثاني على الخريطة")).toHaveCount(0);
});

test("the client dialog: a typed district is kept, the map's one is offered", async ({ page }) => {
  await page.goto("/dev/preview/clients");
  await page.getByRole("button", { name: /عميل جديد/ }).first().click();
  await page.locator('input[name="district"]').fill("النرجس");
  await page.locator("#cl-site-link").fill("https://www.google.com/maps/place/x/@24.8031,46.6105,17z");
  await expect(page.getByText("حسب الخريطة: الرياض — الملقا")).toBeVisible();
  await expect(page.locator('input[name="district"]')).toHaveValue("النرجس");
  await expect(page.locator('input[name="city"]')).toHaveValue("الرياض");
  await expect(page.getByText("تم تحديد الموقع.")).toBeVisible();
});
