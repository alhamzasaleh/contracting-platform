import { describe, expect, it, vi } from "vitest";
import { activePins, distanceMeters, isShortMapLink, mapLink, parseMapCoords, pinToSave, resolveShortMapLink, siteOf, visitPins } from "@/lib/geo";

/**
 * Maps (owner, Nov 2026): the project's site is a pin (lat/lng on the client), set on a map, from the
 * phone's position, or read from a Google Maps link — long links directly, short WhatsApp links
 * (maps.app.goo.gl) by following their redirect on the server, to Google hosts only.
 */
describe("reading coordinates from a map link", () => {
  it("reads the usual Google Maps forms", () => {
    expect(parseMapCoords("https://www.google.com/maps/place/x/@24.8031,46.6105,17z")).toEqual({ lat: 24.8031, lng: 46.6105 });
    expect(parseMapCoords("https://maps.google.com/?q=24.71,46.67")).toEqual({ lat: 24.71, lng: 46.67 });
    expect(parseMapCoords("https://www.google.com/maps/search/?api=1&query=24.7136%2C46.6753")).toEqual({ lat: 24.7136, lng: 46.6753 });
    expect(parseMapCoords("https://www.google.com/maps/place/Villa/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d24.80312!4d46.61055")).toEqual({ lat: 24.80312, lng: 46.61055 });
    expect(parseMapCoords("https://www.google.com/maps/dir/?api=1&destination=24.5,46.5")).toEqual({ lat: 24.5, lng: 46.5 });
    expect(parseMapCoords("geo:24.5,46.6")).toEqual({ lat: 24.5, lng: 46.6 });
    // a dropped pin shared on WhatsApp ends up as /maps/search/<lat>,+<lng>
    expect(parseMapCoords("https://www.google.com/maps/search/24.774265,+46.738586?entry=tts")).toEqual({ lat: 24.774265, lng: 46.738586 });
    expect(parseMapCoords("https://www.google.com/maps/place/24.774265,46.738586")).toEqual({ lat: 24.774265, lng: 46.738586 });
  });
  it("prefers the place pin (!3d!4d) over the view centre (@)", () => {
    expect(parseMapCoords("https://www.google.com/maps/place/x/@24.80,46.61,17z/data=!3d24.8031!4d46.6105")).toEqual({ lat: 24.8031, lng: 46.6105 });
  });
  it("refuses nonsense and short links (no coordinates in them)", () => {
    expect(parseMapCoords("https://maps.app.goo.gl/AbC123")).toBeNull();
    expect(parseMapCoords("https://example.com/@95.1,46.2")).toBeNull();
    expect(parseMapCoords(null)).toBeNull();
  });
  it("knows a short Google Maps link", () => {
    expect(isShortMapLink("https://maps.app.goo.gl/AbC123")).toBe(true);
    expect(isShortMapLink("https://goo.gl/maps/AbC123")).toBe(true);
    expect(isShortMapLink("https://goo.gl/other")).toBe(false);
    expect(isShortMapLink("https://evil.com/maps.app.goo.gl")).toBe(false);
  });
});

describe("following a short link (server)", () => {
  const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
  it("follows Google redirects until the coordinates appear", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(redirect("https://www.google.com/maps/place/Villa/data=!3d24.8031!4d46.6105?entry=tts"));
    expect(await resolveShortMapLink("https://maps.app.goo.gl/AbC123", f)).toEqual({ lat: 24.8031, lng: 46.6105 });
    expect(f).toHaveBeenCalledWith("https://maps.app.goo.gl/AbC123", expect.objectContaining({ redirect: "manual" }));
  });
  it("never leaves Google hosts, never follows more than 5 hops, never fetches a non-short link", async () => {
    const off = vi.fn().mockResolvedValueOnce(redirect("https://evil.example/@24.1,46.1"));
    expect(await resolveShortMapLink("https://maps.app.goo.gl/x", off)).toBeNull();
    const loop = vi.fn().mockResolvedValue(redirect("https://maps.app.goo.gl/x"));
    expect(await resolveShortMapLink("https://maps.app.goo.gl/x", loop)).toBeNull();
    expect(loop).toHaveBeenCalledTimes(5);
    const never = vi.fn();
    expect(await resolveShortMapLink("https://example.com/x", never)).toBeNull();
    expect(never).not.toHaveBeenCalled();
  });
  it("a failed request is just «no coordinates»", async () => {
    expect(await resolveShortMapLink("https://maps.app.goo.gl/x", vi.fn().mockRejectedValue(new Error("offline")))).toBeNull();
  });
});

describe("pins", () => {
  it("the site is the stored pin only (one source of truth: cleared = none, even if the link has coordinates)", () => {
    expect(siteOf({ latitude: 24.1, longitude: 46.2 })).toEqual({ lat: 24.1, lng: 46.2 });
    expect(siteOf({ latitude: "24.5", longitude: "46.5" })).toEqual({ lat: 24.5, lng: 46.5 });
    expect(siteOf({ latitude: null, longitude: null })).toBeNull();
  });
  it("which pin a saved client gets", () => {
    const link = { lat: 24.5, lng: 46.5 };
    // set on the map / phone / «من الرابط» → that pin
    expect(pinToSave({ source: "map", pin: { lat: 1, lng: 2 } }, link)).toEqual({ lat: 1, lng: 2 });
    // untouched, or the link was changed after → read from the (new) link
    expect(pinToSave({ source: "auto", pin: { lat: 1, lng: 2 } }, link)).toEqual(link);
    expect(pinToSave({ source: "auto", pin: null }, null)).toBeNull();
    // «مسح الموقع» → none, whatever the link says
    expect(pinToSave({ source: "none", pin: null }, link)).toBeNull();
  });
  it("visits are marked far beyond 300 m from the site", () => {
    const site = { lat: 24.8, lng: 46.6 };
    const pins = visitPins(site, [
      { id: "a", latitude: 24.8005, longitude: 46.6005, checked_in_at: "2026-11-20T08:00:00Z" },
      { id: "b", latitude: 24.81, longitude: 46.6, checked_in_at: "2026-11-21T08:00:00Z" },
      { id: "c", latitude: null, longitude: null, checked_in_at: "2026-11-22T08:00:00Z" },
    ]);
    expect(pins.map((p) => [p.id, p.far])).toEqual([["a", false], ["b", true]]);
    expect(distanceMeters(site, { lat: 24.81, lng: 46.6 })).toBeGreaterThan(1000);
  });
  it("active projects with a site become pins; the others are listed apart", () => {
    const r = activePins([
      { number: "C-1", client: "أ", progress: 40, site: { lat: 24.7, lng: 46.7 }, late: false },
      { number: "C-2", client: "ب", progress: 0, site: null, late: false },
    ]);
    expect(r.pins.map((p) => p.number)).toEqual(["C-1"]);
    expect(r.missing.map((p) => p.number)).toEqual(["C-2"]);
  });
  it("a Google Maps link for a pin", () => {
    expect(mapLink({ lat: 24.8031, lng: 46.6105 })).toBe("https://www.google.com/maps/search/?api=1&query=24.8031%2C46.6105");
  });
});

describe("check-in refusals and late projects", () => {
  it("reads the database's refusal into a message key (with the distance)", async () => {
    const { visitRefusal } = await import("@/lib/geo");
    expect(visitRefusal("project site not set")).toEqual({ key: "visitNoSite" });
    expect(visitRefusal("visit needs location")).toEqual({ key: "visitNeedsLocation" });
    expect(visitRefusal("visit location inaccurate")).toEqual({ key: "visitInaccurate" });
    expect(visitRefusal("visit too far:1183")).toEqual({ key: "visitTooFar", meters: 1183 });
    expect(visitRefusal("something else")).toBeNull();
  });
  it("a project is late past its delivery (incl. additional works), never once handed over", async () => {
    const { projectLate } = await import("@/lib/geo");
    expect(projectLate({ done: false, start: "2026-11-01", days: 10, extraDays: 0, today: "2026-11-12" })).toBe(true);
    expect(projectLate({ done: false, start: "2026-11-01", days: 10, extraDays: 5, today: "2026-11-12" })).toBe(false);
    expect(projectLate({ done: true, start: "2026-11-01", days: 10, extraDays: 0, today: "2026-12-30" })).toBe(false);
  });
});
