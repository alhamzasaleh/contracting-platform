import { expect, test } from "@playwright/test";

/*
 * The assistant (owner, Nov 2026: «إذا سألته سؤال تفشل الصفحة»): newer Chrome returns a Promise from
 * scrollIntoView({behavior: "smooth"}); an effect that returned it handed React a "cleanup" that
 * isn't a function, and the next message crashed the whole page («This page couldn't load»).
 */
test("asking twice keeps the page: both answers show, no crash", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dev/preview/assistant");
  const box = page.locator("textarea").last();
  for (const [i, q] of ["كم حصّلت هالشهر؟", "وكم الربح؟"].entries()) {
    await box.fill(q);
    await page.keyboard.press("Enter");
    await expect(page.getByText(q)).toBeVisible();
    await expect(page.getByText("هالشهر حصّلت 54,600 ر.س.")).toHaveCount(i + 1);
  }
  await expect(page.getByText("هالشهر حصّلت 54,600 ر.س.")).toHaveCount(2);
  await expect(page.getByText("This page couldn’t load")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the floating assistant on any page: two questions, the app stays (it crashed every page before)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dev/preview");
  await page.getByRole("button", { name: "اسأل المساعد" }).click();
  const box = page.locator("textarea").last();
  for (const [i, q] of ["كم حصّلت هالشهر؟", "وكم الربح؟"].entries()) {
    await box.fill(q);
    await page.keyboard.press("Enter");
    await expect(page.getByText(q)).toBeVisible();
    await expect(page.getByText("هالشهر حصّلت 54,600 ر.س.")).toHaveCount(i + 1);
  }
  await expect(page.getByText("هالشهر حصّلت 54,600 ر.س.")).toHaveCount(2);
  expect(errors).toEqual([]);
});
