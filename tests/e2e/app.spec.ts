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
    await page.getByRole("radio", { name: "دهانات داخلية" }).click();
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

test.describe("schedule (design preview)", () => {
  test("timeline shows projects, teams, clashes and the earliest free date", async ({ page }) => {
    await page.goto("/dev/preview/schedule");
    await expect(page.getByText(/مشروع واحد بدون فريق/)).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(width).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: /أبو محمد العتيبي · \W?C-2026-004/ }).click();
    await expect(page.getByText(/مشغول في هذه الفترة/)).toBeVisible();
    await page.getByRole("button", { name: /أقرب موعد متاح/ }).click();
    await expect(page.getByText(/مشغول في هذه الفترة/)).toHaveCount(0);
  });

  test("teams tab lists teams with their works", async ({ page }) => {
    await page.goto("/dev/preview/schedule");
    await page.getByRole("radio", { name: "الفرق" }).click();
    await expect(page.getByText("فريق الجبس")).toBeVisible();
    await expect(page.getByText("مقاول خارجي")).toBeVisible();
  });

  test("contract editor suggests the earliest start", async ({ page }) => {
    await page.goto("/dev/preview/contracts/new");
    await expect(page.getByText(/أقرب بدء متاح/)).toBeVisible();
  });
});

test.describe("purchases & stock (design preview)", () => {
  test("new purchase offers the camera, lines and totals", async ({ page }) => {
    await page.goto("/dev/preview/purchases/new");
    await expect(page.getByRole("button", { name: "صوّر الفاتورة" })).toBeVisible();
    await page.getByLabel("الكمية").first().fill("10");
    await page.getByLabel("سعر الوحدة").first().fill("22");
    await page.getByRole("button", { name: "15%" }).click();
    await expect(page.getByText("253.00").first()).toBeVisible();
  });

  test("purchase above the limit shows the approval and AI flags", async ({ page }) => {
    await page.goto("/dev/preview/purchases/detail");
    await expect(page.getByText(/فوق حد الموافقة/)).toBeVisible();
    await expect(page.getByText(/الضريبة ليست 15%/)).toBeVisible();
  });

  test("stock and estimated vs actual", async ({ page }) => {
    await page.goto("/dev/preview/purchases/inventory");
    await expect(page.getByText("خاصة بالمشروع")).toBeVisible();
    await page.goto("/dev/preview/purchases/costs");
    await expect(page.getByText(/تجاوز 9%/)).toBeVisible();
  });
});

test.describe("execution (design preview)", () => {
  test("project page: check-in, stages, client notes and visits", async ({ page }) => {
    await page.goto("/dev/preview/projects/detail");
    await expect(page.getByRole("button", { name: "تسجيل وصول للموقع" })).toBeVisible();
    await expect(page.getByText("بانتظار تأكيد العميل").first()).toBeVisible();
    await expect(page.getByText(/يبعد \d+ م عن موقع المشروع/)).toBeVisible();
    await expect(page.getByRole("button", { name: "تمت المعالجة" })).toBeVisible();
  });

  test("client page: confirm a stage, final needs signature, send notes", async ({ page }) => {
    await page.goto("/dev/preview/portal/work");
    await expect(page.getByText("سير العمل")).toBeVisible();
    await expect(page.getByRole("button", { name: "أؤكد استلام المرحلة" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "إرسال الملاحظة" })).toBeDisabled();
    await page.getByLabel("ملاحظاتك").fill("ملاحظة تجريبية");
    await expect(page.getByRole("button", { name: "إرسال الملاحظة" })).toBeEnabled();
    const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(width).toBeLessThanOrEqual(1);
  });
});

test.describe("additional works, subcontractors, petty cash (design preview)", () => {
  test("contract shows addenda with owner approval and new delivery date", async ({ page }) => {
    await page.goto("/dev/preview/contracts/detail");
    await expect(page.getByText("الأعمال الإضافية (ملاحق العقد)")).toBeVisible();
    await expect(page.getByText(/التسليم المتوقع بعد الملاحق/)).toBeVisible();
    await expect(page.getByText("بانتظار موافقة المالك")).toBeVisible();
  });

  test("client page lists an addendum to accept", async ({ page }) => {
    await page.goto("/dev/preview/portal/work");
    await expect(page.getByText("أعمال إضافية", { exact: true })).toBeVisible();
    const accept = page.getByRole("button", { name: "أوافق على الملحق" });
    await expect(accept).toBeDisabled();
  });

  test("subcontractors show earned, paid and due; petty cash shows balance", async ({ page }) => {
    await page.goto("/dev/preview/purchases/subcontractors");
    await expect(page.getByText(/مستحق الآن/).first()).toBeVisible();
    await page.goto("/dev/preview/purchases/petty-cash");
    await expect(page.getByText("الرصيد")).toBeVisible();
    await expect(page.getByText("675.00").first()).toBeVisible();
  });
});

test.describe("owner finance (design preview)", () => {
  test("home shows KPIs, cash-flow warning, approvals and profit", async ({ page }) => {
    await page.goto("/dev/preview");
    await expect(page.getByText("المستحق على العملاء")).toBeVisible();
    await expect(page.getByText(/الرصيد بيصير بالسالب/)).toBeVisible();
    await expect(page.getByText("شراء فوق حد الموافقة")).toBeVisible();
    await expect(page.getByText("الربح المتوقع مقابل الفعلي")).toBeVisible();
  });

  test("collections: late payment flagged, record payment opens", async ({ page }) => {
    await page.goto("/dev/preview/reports");
    await expect(page.getByText("متأخرة").first()).toBeVisible();
    await page.getByRole("button", { name: "تسجيل استلام" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("radio", { name: "الأرباح" }).click();
    await expect(page.getByText("التكلفة الفعلية").first()).toBeVisible();
  });
});

test.describe("payroll (design preview)", () => {
  test("payroll shows expiring documents, live net pay and advances", async ({ page }) => {
    await page.goto("/dev/preview/team/payroll");
    await expect(page.getByText("وثائق تنتهي قريباً")).toBeVisible();
    await expect(page.getByText(/منتهية من 8 يوم/)).toBeVisible();
    const overtime = page.locator("tbody tr").nth(1).locator("input").first();
    await overtime.fill("100");
    await expect(page.locator("tbody tr").nth(1).getByText("3,000.00").first()).toBeVisible();
    await expect(page.getByText("مسودة").first()).toBeVisible();
  });
});

test.describe("notifications (design preview)", () => {
  test("bell lists notifications, approves inline and marks all read", async ({ page }) => {
    await page.goto("/dev/preview");
    const bell = page.getByRole("button", { name: /التنبيهات \(3 غير مقروء\)/ });
    await expect(async () => {
      await bell.click();
      await expect(page.getByRole("menu")).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(page.getByText(/ملاحظة من العميل على/)).toBeVisible();
    await expect(page.getByRole("menu").getByRole("button", { name: "موافقة" })).toBeVisible();
    await page.getByRole("button", { name: "تعليم الكل كمقروء" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "التنبيهات", exact: true })).toBeVisible();
  });

  test("preferences: WhatsApp follows in-app", async ({ page }) => {
    await page.goto("/dev/preview/settings/notifications");
    await expect(page.getByText(/إرسال الواتساب يشتغل بعد ربط/)).toBeVisible();
    const inApp = page.getByRole("switch", { name: "ملاحظات العملاء — داخل التطبيق" });
    const wa = page.getByRole("switch", { name: "ملاحظات العملاء — واتساب" });
    await wa.click();
    await expect(wa).toBeChecked();
    await inApp.click();
    await expect(wa).not.toBeChecked();
    await expect(wa).toBeDisabled();
  });
});

test.describe("qoyod (design preview)", () => {
  test("settings show the connection, the choices and the sync log", async ({ page }) => {
    await page.goto("/dev/preview/settings/qoyod");
    await expect(page.getByText("مفتاح قيود محفوظ")).toBeVisible();
    await expect(page.getByLabel("منتج «الدهانات الخارجية» في قيود")).toHaveValue("");
    await page.getByLabel("منتج «الدهانات الخارجية» في قيود").selectOption("13");
    await expect(page.getByText(/تعذّر الوصول لقيود/)).toBeVisible();
    await expect(page.getByRole("button", { name: "تجهيز تلقائي" })).toBeVisible();
    await expect(page.getByRole("button", { name: "إعادة المتعذّر" })).toBeVisible();
    await page.getByRole("radio", { name: "معتمدة مباشرة" }).click();
    await expect(page.getByText(/تُعتمد فوراً/)).toBeVisible();
  });
});

test.describe("receipt voucher (design preview)", () => {
  test("voucher shows amount in words and running totals; client page lists it", async ({ page }) => {
    await page.goto("/dev/preview/receipt");
    await expect(page.getByText("سند قبض", { exact: true })).toBeVisible();
    await expect(page.getByText("فقط ثمانية عشر ألف وأربعمائة ريال سعودي لا غير")).toBeVisible();
    await expect(page.getByText("المتبقي")).toBeVisible();
    await page.goto("/dev/preview/portal/work");
    await expect(page.getByRole("heading", { name: "سندات القبض" })).toBeVisible();
  });
});

test.describe("warranty & maintenance (design preview)", () => {
  test("staff follow requests and see warranties", async ({ page }) => {
    await page.goto("/dev/preview/maintenance");
    await expect(page.getByText("ظهر شق بسيط في سقف المجلس")).toBeVisible();
    await expect(page.getByText("MR-2026-001")).toHaveCount(0);
    await page.getByRole("radio", { name: "الكل" }).click();
    await expect(page.getByText("باب الصيانة في الممر ما يقفل.")).toBeVisible();
    await page.getByRole("button", { name: "متابعة" }).first().click();
    await expect(page.getByLabel("رد للعميل")).toBeVisible();
    await expect(page.getByRole("heading", { name: "الضمانات" })).toBeVisible();
  });

  test("client page shows the warranty, the request form and confirm button", async ({ page }) => {
    await page.goto("/dev/preview/portal/work");
    await expect(page.getByRole("heading", { name: "الضمان والصيانة" })).toBeVisible();
    await expect(page.getByRole("button", { name: "إرسال طلب صيانة" })).toBeDisabled();
    await page.getByPlaceholder("اكتب الملاحظة (المكان والمشكلة)").fill("تسريب بسيط");
    await expect(page.getByRole("button", { name: "إرسال طلب صيانة" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "تم الإصلاح — أؤكد" })).toBeVisible();
  });
});

test.describe("assistant (design preview)", () => {
  test("shows the conversation, figures, links and the question box", async ({ page }) => {
    await page.goto("/dev/preview/assistant");
    await expect(page.getByText("كم ربحت هالشهر؟")).toBeVisible();
    await expect(page.getByText("الربح المتوقع", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "تقرير الأرباح" })).toHaveAttribute("href", "/dev/preview/reports");
    await page.getByLabel("اكتب سؤالك…").fill("مين متأخر؟");
    await expect(page.getByRole("button", { name: "إرسال" })).toBeEnabled();
  });
});

test.describe("installable app", () => {
  test("manifest, service worker and offline page are served", async ({ page, request }) => {
    const m = await request.get("/manifest.webmanifest");
    expect(m.ok()).toBeTruthy();
    const json = await m.json();
    expect(json.display).toBe("standalone");
    expect(json.icons.length).toBeGreaterThanOrEqual(2);
    const sw = await request.get("/sw.js");
    expect(sw.ok()).toBeTruthy();
    expect(await sw.text()).toContain("OFFLINE_URL");
    await page.goto("/offline");
    await expect(page.getByText("ما فيه اتصال بالإنترنت")).toBeVisible();
  });
});

test.describe("floating assistant (design preview)", () => {
  test("opens from any page and keeps the question box", async ({ page }) => {
    await page.goto("/dev/preview/clients");
    await expect(async () => {
      await page.getByRole("button", { name: "اسأل المساعد" }).click();
      await expect(page.getByRole("dialog", { name: "المساعد" })).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(page.getByRole("dialog", { name: "المساعد" }).getByLabel("اكتب سؤالك…")).toBeVisible();
    await page.getByRole("button", { name: "إغلاق" }).click();
    await expect(page.getByRole("button", { name: "اسأل المساعد" })).toBeVisible();
  });
});

test.describe("invoices (design preview)", () => {
  test("list filters unpaid/paid and the document shows totals in words", async ({ page }) => {
    await page.goto("/dev/preview/invoices");
    await expect(page.getByText("INV-2026-003")).toBeVisible();
    await expect(page.getByText("INV-2026-001")).toHaveCount(0);
    await page.getByRole("radio", { name: "مسددة", exact: true }).click();
    await expect(page.getByText("INV-2026-001")).toBeVisible();
    await page.goto("/dev/preview/invoices/detail");
    await expect(page.getByText("فاتورة", { exact: true })).toBeVisible();
    await expect(page.getByText("فقط تسعة آلاف ومئتان ريال سعودي لا غير")).toBeVisible();
    await page.goto("/dev/preview/portal/work");
    await expect(page.getByRole("heading", { name: "الفواتير", exact: true })).toBeVisible();
  });
});

test.describe("contract clauses (design preview)", () => {
  test("hide, edit and add clauses in the company template", async ({ page }) => {
    await page.goto("/dev/preview/settings/contract");
    await expect(page.locator('input[value="الكهرباء والماء"]')).toBeVisible();
    await page.getByRole("button", { name: /^\d+\.\s*القوة القاهرة/ }).click();
    await expect(page.getByLabel("النص").first()).toBeVisible();
    await page.getByLabel("العنوان").last().fill("التأمين");
    await page.locator("#new-body").fill("يلتزم الطرف الأول بالتأمين على العمالة.");
    await page.getByRole("button", { name: "إضافة البند" }).click();
    await expect(page.locator('input[value="التأمين"]')).toBeVisible();
  });
});

test.describe("biometric sign-in (design preview)", () => {
  test("the sign-in page offers biometrics and settings list this user's devices", async ({ page }) => {
    await page.goto("/dev/preview/login");
    await expect(page.getByRole("button", { name: /الدخول (بالبصمة|بـ Face ID|بـ Touch ID)/ })).toBeVisible();
    await page.goto("/dev/preview/settings/preferences");
    await expect(page.getByText("iPad Safari")).toBeVisible();
    await page.getByRole("button", { name: "إزالة" }).first().click();
    await expect(page.getByText("iPad Safari")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "تفعيل على هذا الجهاز" })).toBeVisible();
  });
});

test.describe("documents (design preview)", () => {
  test("a tax invoice carries the ZATCA QR; a plain invoice does not", async ({ page }) => {
    await page.goto("/dev/preview/invoices/tax");
    await expect(page.getByRole("img", { name: /رمز الاستجابة السريعة/ })).toBeVisible();
    await page.goto("/dev/preview/invoices/detail");
    await expect(page.getByRole("img", { name: /رمز الاستجابة السريعة/ })).toHaveCount(0);
  });
});

test.describe("multi-option quotes (design preview)", () => {
  test("staff pick versions as options and name them", async ({ page }) => {
    await page.goto("/dev/preview/quotations/detail");
    await expect(page.getByText("عرض بأكثر من خيار (اختياري)")).toBeVisible();
    const save = page.getByRole("button", { name: "اعتماد الخيارات" });
    await expect(save).toBeDisabled();
    for (const box of await page.getByRole("checkbox").all()) await box.check();
    await expect(page.getByLabel(/اسم الخيار/)).toHaveCount(2);
    await expect(save).toBeEnabled();
  });

  test("the client compares options and must pick one before accepting", async ({ page }) => {
    await page.goto("/dev/preview/portal/options");
    await expect(page.getByRole("heading", { name: "اختر الخيار المناسب لك" })).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(3);
    await page.getByLabel("الاسم الكامل").fill("أبو محمد");
    await page.getByRole("checkbox").check();
    await expect(page.getByRole("button", { name: "أوافق على العرض والعقد" })).toBeDisabled();
    await page.getByRole("radio", { name: /الجزيرة/ }).click();
    await expect(page.getByRole("radio", { name: /الجزيرة/ })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: "أوافق على خيار «الجزيرة»" })).toBeEnabled();
  });
});

test.describe("AI helpers (design preview)", () => {
  test("survey: notes → draft rooms to review, rows with missing sizes stay unticked", async ({ page }) => {
    await page.goto("/dev/preview/clients/survey");
    await page.getByRole("button", { name: "مسودة من صوت أو صور" }).first().click();
    await page.getByLabel("ملاحظات الرفع المساحي").fill("المجلس ٦ في ٥");
    await page.getByRole("button", { name: "جهّز المسودة" }).click();
    await expect(page.getByText("عرض المطبخ غير مذكور")).toBeVisible();
    await expect(page.getByRole("button", { name: "إضافة 2 غرف" })).toBeEnabled();
  });

  test("materials: a datasheet becomes a pre-filled new product", async ({ page }) => {
    await page.goto("/dev/preview/catalogue/products");
    await page.getByRole("button", { name: "قراءة نشرة فنية" }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: "tds.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
    await expect(page.getByText("10–12 م²/لتر للوجه")).toBeVisible();
    await page.getByRole("button", { name: "إنشاء المنتج بهذي البيانات" }).click();
    await expect(page.locator('input[name="name"]')).toHaveValue("Jotun Fenomastic My Home Smooth");
    await expect(page.locator('input[name="ref_area"]')).toHaveValue(/180/);
  });

  test("pricing shows suggestions from past quotes; calibration asks before changing", async ({ page }) => {
    await page.goto("/dev/preview/quotations/editor");
    await expect(page.getByText("من مشاريعك السابقة")).toBeVisible();
    await page.getByRole("button", { name: /استخدم الهامش المقترح/ }).click();
    await expect(page.locator("#margin")).toHaveValue("26.5");
    await page.goto("/dev/preview/catalogue/calibration");
    await expect(page.getByRole("button", { name: "اعتماد التغيير" })).toHaveCount(1);
    await expect(page.getByText(/راجع معدل الاستهلاك/)).toBeVisible();
  });
});
