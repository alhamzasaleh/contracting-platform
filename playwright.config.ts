import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * `PW_CHROMIUM_PATH=<chrome binary>` runs the tests in another Chromium build — e.g. the one CI gets
 * (`node -e "import('@sparticuz/chromium').then(async (m) => console.log(await m.default.executablePath()))"`
 * unpacks a Chromium 153 to /tmp/chromium). Line breaking differs between builds, so a layout that
 * only fits in one of them shows up here instead of only in CI.
 */
const chromiumPath = process.env.PW_CHROMIUM_PATH;
const launch = chromiumPath ? { launchOptions: { executablePath: chromiumPath, args: ["--no-sandbox", "--no-zygote", "--single-process"] } } : {};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...launch }, testIgnore: /layout\.spec\.ts/ },
    { name: "ipad", use: { ...devices["iPad Pro 11"], browserName: "chromium", ...launch }, testIgnore: /layout\.spec\.ts/ },
    { name: "phone", use: { ...devices["Pixel 7"], ...launch }, testIgnore: /layout\.spec\.ts/ },
    // every preview page at 8 widths with its dialogs (sets its own sizes): `npm run test:layout`, a CI job of its own
    { name: "layout", use: { ...devices["Desktop Chrome"], ...launch }, testMatch: /layout\.spec\.ts/ },
  ],
  webServer: {
    // Production build with the sample-data design preview switched on and
    // no Supabase keys (so the "not connected" path is exercised too).
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/setup`,
    reuseExistingServer: !process.env.CI,
    env: { VERCEL_ENV: "preview", ENABLE_DESIGN_PREVIEW: "1", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" },
  },
});
