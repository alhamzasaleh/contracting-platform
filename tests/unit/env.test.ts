import { afterEach, describe, expect, it, vi } from "vitest";
import { isDesignPreviewEnabled } from "@/env";

const SUPA = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxxxxxxxxxxxxxxx" };

function withEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "", VERCEL_ENV: "", ENABLE_DESIGN_PREVIEW: "", ...env })) {
    vi.stubEnv(k, v ?? "");
  }
}
afterEach(() => vi.unstubAllEnvs());

describe("design preview gate", () => {
  it("is off in production without the flag", () => {
    withEnv({ NODE_ENV: "production", VERCEL_ENV: "production" });
    expect(isDesignPreviewEnabled()).toBe(false);
  });
  it("is on in production with the flag only until Supabase is connected", () => {
    withEnv({ NODE_ENV: "production", VERCEL_ENV: "production", ENABLE_DESIGN_PREVIEW: "1" });
    expect(isDesignPreviewEnabled()).toBe(true);
    withEnv({ NODE_ENV: "production", VERCEL_ENV: "production", ENABLE_DESIGN_PREVIEW: "1", ...SUPA });
    expect(isDesignPreviewEnabled()).toBe(false);
  });
  it("stays available on preview deployments with the flag", () => {
    withEnv({ NODE_ENV: "production", VERCEL_ENV: "preview", ENABLE_DESIGN_PREVIEW: "1", ...SUPA });
    expect(isDesignPreviewEnabled()).toBe(true);
  });
});

describe("Supabase URL normalisation", async () => {
  const { normalizeSupabaseUrl } = await import("@/env");
  it.each([
    ["https://abc.supabase.co/rest/v1/", "https://abc.supabase.co"],
    ["https://abc.supabase.co/", "https://abc.supabase.co"],
    [" https://abc.supabase.co ", "https://abc.supabase.co"],
  ])("%s → %s", (input, out) => expect(normalizeSupabaseUrl(input)).toBe(out));
});
