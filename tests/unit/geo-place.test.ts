import { describe, expect, it, vi } from "vitest";
import { fillPlace, looksLikeMapLink, placeFromReverse, reversePlace } from "@/lib/geo-place";

/**
 * Owner (Nov 2026): one place for the site — paste the link and the pin is set at once; the city and
 * district fill themselves from the pin (only empty fields; a different one is offered, never forced).
 */
describe("a pasted map link", () => {
  it("is read as soon as it looks like a Google Maps link", () => {
    expect(looksLikeMapLink("https://maps.app.goo.gl/AbC123")).toBe(true);
    expect(looksLikeMapLink("  https://www.google.com/maps/place/x/@24.8,46.6,17z ")).toBe(true);
    expect(looksLikeMapLink("https://goo.gl/maps/x")).toBe(true);
    expect(looksLikeMapLink("geo:24.5,46.6")).toBe(true);
    expect(looksLikeMapLink("https://maps.app.goo.gl/")).toBe(false); // still typing
    expect(looksLikeMapLink("http://maps.app.goo.gl/AbC")).toBe(false);
    expect(looksLikeMapLink("https://example.com/maps")).toBe(false);
    expect(looksLikeMapLink("")).toBe(false);
  });
});

describe("city and district from the map", () => {
  it("reads the address of a reverse lookup (Saudi forms)", () => {
    expect(placeFromReverse({ address: { suburb: "حي الملقا", city: "الرياض", state: "منطقة الرياض" } })).toEqual({ city: "الرياض", district: "الملقا" });
    expect(placeFromReverse({ address: { neighbourhood: "النرجس", town: "الخرج" } })).toEqual({ city: "الخرج", district: "النرجس" });
    expect(placeFromReverse({ address: { quarter: "حي العليا", city: "الرياض" } })).toEqual({ city: "الرياض", district: "العليا" });
    expect(placeFromReverse({ address: { state: "منطقة الرياض" } })).toEqual({ city: null, district: null });
    expect(placeFromReverse({ error: "Unable to geocode" })).toBeNull();
    expect(placeFromReverse(null)).toBeNull();
  });
  it("fills only empty fields; a different district is offered, not forced", () => {
    expect(fillPlace({ city: "", district: "" }, { city: "الرياض", district: "الملقا" })).toEqual({ city: "الرياض", district: "الملقا", offer: null });
    expect(fillPlace({ city: "الرياض", district: "" }, { city: "الرياض", district: "الملقا" })).toEqual({ city: "الرياض", district: "الملقا", offer: null });
    expect(fillPlace({ city: "الرياض", district: "النرجس" }, { city: "الرياض", district: "الملقا" })).toEqual({ city: "الرياض", district: "النرجس", offer: { city: "الرياض", district: "الملقا" } });
    // same names written another way are the same
    expect(fillPlace({ city: "الرياض", district: "حي الملقا" }, { city: "الرياض", district: "الملقا" }).offer).toBeNull();
    expect(fillPlace({ city: "a", district: "b" }, { city: null, district: null })).toEqual({ city: "a", district: "b", offer: null });
  });
  it("asks the address service in Arabic, by coordinates only (no client data); a failure is «nothing»", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ address: { suburb: "حي الملقا", city: "الرياض" } }), { status: 200 }));
    expect(await reversePlace({ lat: 24.8031, lng: 46.6105 }, f)).toEqual({ city: "الرياض", district: "الملقا" });
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain("lat=24.8031");
    expect(url).toContain("lon=46.6105");
    expect(url).toContain("accept-language=ar");
    expect(await reversePlace({ lat: 1, lng: 2 }, vi.fn().mockResolvedValue(new Response("x", { status: 500 })))).toBeNull();
    expect(await reversePlace({ lat: 1, lng: 2 }, vi.fn().mockRejectedValue(new Error("offline")))).toBeNull();
  });
});
