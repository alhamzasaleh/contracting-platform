import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("no admin in unit tests"); } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => "ok" }));
import { MAX_PIN_TRIES, resolvePendingPins, type PinRow } from "@/lib/geo-pins";

/**
 * Owner (Nov 2026): «حطيت رابط موقعه» — a client's short WhatsApp map link is read on the server
 * by itself (no need to open the client and press «من الرابط»), then the project has its site.
 */
function fakeDb(rows: PinRow[]) {
  const updates: { id: string; url: string | null; values: object }[] = [];
  return {
    updates,
    pending: vi.fn(async () => rows),
    save: vi.fn(async (r: PinRow, values: object) => {
      updates.push({ id: r.id, url: r.location_url, values });
    }),
  };
}
const row = (id: string, url: string | null, tries = 0): PinRow => ({ id, location_url: url, pin_tries: tries });
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
const ok = { allow: async () => true, deadline: Date.now() + 60_000 };

describe("reading pending client pins", () => {
  it("follows a short link and stores the pin (only while the client still holds that same link)", async () => {
    const db = fakeDb([row("c1", "https://maps.app.goo.gl/AbC")]);
    const fetchFn = vi.fn().mockResolvedValueOnce(redirect("https://www.google.com/maps/place/x/data=!3d24.8031!4d46.6105"));
    const r = await resolvePendingPins(db, { ...ok, fetchFn });
    expect(r.get("c1")).toEqual({ lat: 24.8031, lng: 46.6105 });
    // save() is given the row read → the update is conditioned on that link (a link changed meanwhile is untouched)
    expect(db.updates).toEqual([{ id: "c1", url: "https://maps.app.goo.gl/AbC", values: { latitude: 24.8031, longitude: 46.6105, pin_pending: false } }]);
  });
  it("a link with no coordinates that isn't a short link is given up (nothing to follow)", async () => {
    const db = fakeDb([row("c1", "https://example.com/where")]);
    const fetchFn = vi.fn();
    expect((await resolvePendingPins(db, { ...ok, fetchFn })).size).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(db.updates).toEqual([{ id: "c1", url: "https://example.com/where", values: { pin_pending: false } }]);
  });
  it("a failed read counts a try (tried later, oldest first); after the last try the link is given up — a dead link never blocks the others", async () => {
    const db = fakeDb([row("c1", "https://maps.app.goo.gl/A", 0), row("c2", "https://maps.app.goo.gl/B", MAX_PIN_TRIES - 1)]);
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    expect((await resolvePendingPins(db, { ...ok, fetchFn })).size).toBe(0);
    expect(db.updates).toEqual([
      { id: "c1", url: "https://maps.app.goo.gl/A", values: { pin_tries: 1, pin_tried_at: expect.any(String), pin_pending: true } },
      { id: "c2", url: "https://maps.app.goo.gl/B", values: { pin_tries: MAX_PIN_TRIES, pin_tried_at: expect.any(String), pin_pending: false } },
    ]);
  });
  it("throttled clients aren't fetched; nothing starts past the deadline", async () => {
    const db = fakeDb([row("c1", "https://maps.app.goo.gl/A"), row("c2", "https://maps.app.goo.gl/B")]);
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    await resolvePendingPins(db, { fetchFn, allow: async (id) => id === "c1", deadline: Date.now() + 60_000 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    await resolvePendingPins(fakeDb([row("c1", "https://maps.app.goo.gl/A")]), { fetchFn: late, allow: async () => true, deadline: Date.now() - 1 });
    expect(late).not.toHaveBeenCalled();
  });
  it("a failing database read is just «nothing done»", async () => {
    const db = { pending: vi.fn().mockRejectedValue(new Error("db")), save: vi.fn() };
    expect((await resolvePendingPins(db, { ...ok, fetchFn: vi.fn() })).size).toBe(0);
  });
});
