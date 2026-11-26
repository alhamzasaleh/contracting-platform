import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { localStyle, MAP_LAYERS, storedLayer, TILE_HOSTS, VECTOR_HOSTS, VECTOR_STYLES } from "@/components/maps/tiles";

describe("vector maps (OpenFreeMap) — owner, Nov 2026", () => {
  it("place, street and water names show in Arabic; house numbers and other text stay", () => {
    const s = localStyle({
      version: 8,
      layers: [
        { id: "bg", type: "background" },
        { id: "road", type: "symbol", "source-layer": "transportation_name", layout: { "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]], "text-size": 12 } },
        { id: "city", type: "symbol", "source-layer": "place", layout: { "text-field": "{name:latin}\n{name:nonlatin}" } },
        { id: "nums", type: "symbol", "source-layer": "housenumber", layout: { "text-field": "{housenumber}" } },
        { id: "shield", type: "symbol", "source-layer": "transportation_name", layout: { "text-field": "{ref}" } },
      ],
    }, "ar");
    const field = (id: string) => s.layers!.find((l) => (l as { id: string }).id === id)!.layout?.["text-field"];
    expect(field("road")).toEqual(["coalesce", ["get", "name:ar"], ["get", "name"]]);
    expect(field("city")).toEqual(["coalesce", ["get", "name:ar"], ["get", "name"]]);
    expect(field("nums")).toBe("{housenumber}");
    expect(field("shield")).toBe("{ref}");
    expect(s.layers![1].layout?.["text-size"]).toBe(12);
    // an English user reads the English names
    const en = localStyle({ layers: [{ type: "symbol", "source-layer": "place", layout: { "text-field": "{name}" } }] }, "en");
    expect(en.layers![0].layout?.["text-field"]).toEqual(["coalesce", ["get", "name:en"], ["get", "name"]]);
  });
  it("three backgrounds; the remembered one is kept, anything else is the street map", () => {
    expect(MAP_LAYERS).toEqual(["map", "light", "satellite"]);
    expect(storedLayer("light")).toBe("light");
    expect(storedLayer("satellite")).toBe("satellite");
    expect(storedLayer(null)).toBe("map");
    expect(storedLayer("x")).toBe("map");
    expect(VECTOR_STYLES.map?.style).toMatch(/^https:\/\/tiles\.openfreemap\.org\/styles\//);
  });
  it("the CSP allows the map hosts (images and fetches)", () => {
    const proxy = fs.readFileSync("src/proxy.ts", "utf8");
    expect(proxy).toContain("TILE_HOSTS");
    expect(TILE_HOSTS).toContain("https://tiles.openfreemap.org");
    expect(proxy).toContain("VECTOR_HOSTS");
    expect(VECTOR_HOSTS.length).toBeGreaterThan(0);
  });
  it("the map's worker file in public/ is the installed library's own", () => {
    expect(fs.readFileSync("public/maplibre/maplibre-gl-worker.mjs").equals(fs.readFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"))).toBe(true);
  });
});
