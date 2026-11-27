import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

/*
 * Android draws its splash screen from the manifest: background_color + the app icon. The icon is a
 * basalt square, so the background must be basalt too — on gypsum it showed a dark box (owner, Nov 2026).
 */
describe("app splash screen", () => {
  it("the splash background is the icon's own basalt, so the logo stands alone", () => {
    const m = manifest();
    expect(m.background_color).toBe("#22262A");
    expect(m.theme_color).toBe("#22262A");
  });
});
