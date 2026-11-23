import { expect, test } from "@playwright/test";

test.describe("before Supabase is connected", () => {
  test("protected pages send visitors to the setup page", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("design system", () => {
  test("is Arabic and right-to-left by default", async ({ page }) => {
    await page.goto("/dev/preview");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("صالح");
  });

  test("switches to English left-to-right", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL! }]);
    await page.goto("/dev/preview/settings");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("shows Arabic-Indic digits when chosen", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "numerals", value: "arab", url: baseURL! }]);
    await page.goto("/dev/preview/settings/members");
    await expect(page.getByText("+٩٦٦ ٥٥ ١٢٣ ٤٥٦٧")).toBeVisible();
  });

  test("sends security headers", async ({ request }) => {
    const res = await request.get("/dev/preview");
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["strict-transport-security"]).toContain("max-age=");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-powered-by"]).toBeUndefined();
  });
});

test.describe("login (design preview)", () => {
  test("validates the Saudi mobile number", async ({ page }) => {
    await page.goto("/dev/preview/login");
    await page.getByLabel("رقم الجوال").fill("12345");
    await page.getByRole("button", { name: "أرسل رمز التحقق" }).click();
    await expect(page.locator("#phone-error")).toContainText("05");
    await expect(page.getByLabel("رقم الجوال")).toHaveAttribute("aria-invalid", "true");
  });

  test("moves to the code step for a valid number", async ({ page }) => {
    await page.goto("/dev/preview/login");
    await page.getByLabel("رقم الجوال").fill("055 123 4567");
    await page.getByRole("button", { name: "أرسل رمز التحقق" }).click();
    await expect(page.getByLabel("رمز التحقق")).toBeFocused();
    await expect(page.getByText("+966 55 123 4567")).toBeVisible();
  });
});

test.describe("settings (design preview)", () => {
  test("opens the invite dialog with role choices", async ({ page }) => {
    await page.goto("/dev/preview/settings/members");
    await page.getByRole("button", { name: /دعوة عضو/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("مشرف")).toBeVisible();
  });
});

test.describe("pricing calculator (design preview)", () => {
  test("prices interior paint by steps and explains a line", async ({ page }) => {
    await page.goto("/dev/preview/catalogue/calculator");
    await page.getByRole("radio", { name: "دهان داخلي" }).click();
    await expect(page.getByText("نطاق", { exact: false }).or(page.getByText("مشمول في السعر")).first()).toBeVisible();
    await page.getByRole("button", { name: /^معجون —/ }).click();
    await expect(page.getByText("المساحة × الأوجه").first()).toBeVisible();
  });
});

test.describe("clients, survey and quotes (design preview)", () => {
  test("survey shows quantities per service from the rooms", async ({ page }) => {
    await page.goto("/dev/preview/clients/survey");
    await expect(page.getByRole("heading", { name: "الكميات لكل خدمة" })).toBeVisible();
    await expect(page.getByRole("button", { name: "سعّر جبس" })).toBeVisible();
  });

  test("quote shows the client document, approval and purchase list", async ({ page }) => {
    await page.goto("/dev/preview/quotations/detail");
    await expect(page.getByText("عرض سعر", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /موافقة/ })).toBeVisible();
    await expect(page.getByText("قائمة المشتريات")).toBeVisible();
  });

  test("quote editor prices from the survey quantities", async ({ page }) => {
    await page.goto("/dev/preview/quotations/editor");
    await expect(page.getByText("الكميات من المعاينة")).toBeVisible();
    await expect(page.getByRole("button", { name: "حفظ عرض السعر" })).toBeVisible();
  });
});

test.describe("contracts and client page (design preview)", () => {
  test("contract editor requires the payments to add up to 100%", async ({ page }) => {
    await page.goto("/dev/preview/contracts/new");
    const create = page.getByRole("button", { name: "إنشاء العقد" });
    await expect(create).toBeDisabled();
    const percents = page.getByLabel("النسبة");
    for (const [i, v] of ["40", "30", "20", "10"].entries()) await percents.nth(i).fill(v);
    await expect(page.getByText("المجموع 100.00%")).toBeVisible();
  });

  test("client page shows the acceptance with name, optional signature and agreement", async ({ page }) => {
    await page.goto("/dev/preview/portal");
    await expect(page.getByRole("heading", { name: /أهلاً/ })).toBeVisible();
    const accept = page.getByRole("button", { name: "أوافق على العرض والعقد" });
    await expect(accept).toBeDisabled();
    await page.getByRole("checkbox").check();
    await expect(accept).toBeEnabled();
    const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(width).toBeLessThanOrEqual(1);
  });

  test("a malformed client link is refused before any lookup", async ({ page }) => {
    await page.goto("/p/C-2026-001/short");
    await expect(page.getByText("الرابط غير صالح")).toBeVisible();
  });
});
