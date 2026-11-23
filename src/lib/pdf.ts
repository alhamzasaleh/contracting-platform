import "server-only";
import type { Browser } from "puppeteer-core";

/**
 * Server-side PDF (§1): the app's own print pages rendered by headless Chromium,
 * so Arabic RTL, the Almarai font and the brand look exactly as on screen.
 * On Vercel the compact Chromium build (@sparticuz/chromium) is used; elsewhere
 * CHROMIUM_PATH or the pre-installed browser.
 */

export { STAFF_DOCS } from "@/lib/pdf-docs";

async function launch(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true, defaultViewport: { width: 1024, height: 1400 } });
  }
  return puppeteer.launch({
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1024, height: 1400 },
  });
}

/**
 * Render one same-origin page to an A4 PDF. `cookies` (the caller's own session)
 * are set for that origin only, so the page loads with the caller's permissions.
 */
export async function renderPdf(origin: string, path: string, cookies: { name: string; value: string }[] = []): Promise<Uint8Array> {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("bad path");
  const url = new URL(path, origin);
  if (url.origin !== new URL(origin).origin) throw new Error("bad origin");
  const browser = await launch();
  try {
    const page = await browser.newPage();
    if (cookies.length) {
      await browser.setCookie(...cookies.map((c) => ({ name: c.name, value: c.value, domain: url.hostname, path: "/", secure: url.protocol === "https:", httpOnly: true, sameSite: "Lax" as const })));
    }
    // only the app itself and its file storage (signed logo URLs) — nothing else
    await page.setRequestInterception(true);
    const storage = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin + "/storage/" : null;
    page.on("request", (r) => {
      const u = r.url();
      if (u.startsWith(url.origin + "/") || u.startsWith("data:") || u.startsWith("blob:") || (storage && u.startsWith(storage))) void r.continue();
      else void r.abort();
    });
    const res = await page.goto(url.href, { waitUntil: "networkidle0", timeout: 25_000 });
    if (!res || !res.ok()) throw new Error(`page ${res?.status() ?? "failed"}`);
    // a redirect (signed out, no permission) must never become someone else's PDF
    if (new URL(page.url()).pathname !== url.pathname) throw new Error("redirected");
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" } });
  } finally {
    await browser.close();
  }
}

/** A safe file name for the download header. */
export function pdfFileName(name: string): string {
  return `${name.replace(/[^A-Za-z0-9-]/g, "_").slice(0, 60) || "document"}.pdf`;
}
