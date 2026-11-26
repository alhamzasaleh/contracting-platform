import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("no admin in unit tests"); } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => "ok" }));
import { resolvePendingPins } from "@/lib/geo-pins";

/**
 * Owner (Nov 2026): «حطيت رابط موقعه» — a client's short WhatsApp map link is read on the server
 * by itself (no need to open the client and press «من الرابط»), then the project has its site.
 */
function fakeDb(rows: { id: string; location_url: string | null }[]) {
  const updates: { id: string; values: object }[] = [];
  return {
    updates,
    pending: vi.fn(async () => rows),
    save: vi.fn(async (id: string, values: object) => {
      updates.push({ id, values });
    }),
  };
}
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

describe("reading pending client pins", () => {
  it("follows a short link and stores the pin", async () => {
    const db = fakeDb([{ id: "c1", location_url: "https://maps.app.goo.gl/AbC" }]);
    const fetchFn = vi.fn().mockResolvedValueOnce(redirect("https://www.google.com/maps/place/x/data=!3d24.8031!4d46.6105"));
    expect(await resolvePendingPins(db, { fetchFn, allow: async () => true })).toBe(1);
    expect(db.updates).toEqual([{ id: "c1", values: { latitude: 24.8031, longitude: 46.6105, pin_pending: false } }]);
  });
  it("a link with no coordinates that isn't a short link is given up (nothing to follow)", async () => {
    const db = fakeDb([{ id: "c1", location_url: "https://example.com/where" }]);
    const fetchFn = vi.fn();
    expect(await resolvePendingPins(db, { fetchFn, allow: async () => true })).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(db.updates).toEqual([{ id: "c1", values: { pin_pending: false } }]);
  });
  it("Google unreachable → stays pending (tried again later); throttled clients aren't fetched", async () => {
    const db = fakeDb([{ id: "c1", location_url: "https://maps.app.goo.gl/A" }, { id: "c2", location_url: "https://maps.app.goo.gl/B" }]);
    const fetchFn = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await resolvePendingPins(db, { fetchFn, allow: async (id) => id === "c1" })).toBe(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(db.updates).toEqual([]);
  });
  it("a failing database read is just «nothing done»", async () => {
    const db = { pending: vi.fn().mockRejectedValue(new Error("db")), save: vi.fn() };
    expect(await resolvePendingPins(db, { fetchFn: vi.fn(), allow: async () => true })).toBe(0);
  });
});
