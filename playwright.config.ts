import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "ipad", use: { ...devices["iPad Pro 11"], browserName: "chromium" } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
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
