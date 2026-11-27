import { expect, test, type Locator } from "@playwright/test";

/*
 * The client reads, then answers (owner, Nov 2026): on the client page the accept / changes /
 * decline buttons come after the quote or the contract, with a «go to your answer» link at the top.
 */
const top = async (l: Locator) => (await l.boundingBox())!.y;

test("quote stage: the answer comes after the quote document; the top link jumps to it", async ({ page }) => {
  await page.goto("/dev/preview/portal/quote");
  const pdf = page.getByRole("link", { name: /تحميل عرض السعر PDF/ });
  const answer = page.getByText("ردّك على العرض", { exact: true });
  expect(await top(answer)).toBeGreaterThan(await top(pdf));
  await page.getByRole("link", { name: "انزل للرد على العرض" }).click();
  await expect(answer).toBeInViewport();
});

test("contract stage: the signature and acceptance come after the contract and its annex", async ({ page }) => {
  await page.goto("/dev/preview/portal");
  const pdf = page.getByRole("link", { name: /تحميل العقد PDF/ });
  const accept = page.getByText("الموافقة على العرض والعقد", { exact: true });
  expect(await top(accept)).toBeGreaterThan(await top(pdf));
  await page.getByRole("link", { name: "انزل للموافقة والتوقيع" }).click();
  await expect(accept).toBeInViewport();
});

test("contract with options: the option is chosen before the contract text it changes", async ({ page }) => {
  await page.goto("/dev/preview/portal/options");
  const pdf = page.getByRole("link", { name: /تحميل العقد PDF/ });
  expect(await top(page.getByRole("radio").first())).toBeLessThan(await top(pdf));
  expect(await top(page.getByText("الموافقة على العرض والعقد", { exact: true }))).toBeGreaterThan(await top(pdf));
});
