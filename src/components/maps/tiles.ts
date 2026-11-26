/**
 * Map backgrounds (owner, Nov 2026): «خريطة» and «هادئة» = OpenFreeMap vector maps (free, no key,
 * commercial use allowed; styles Liberty / Positron, labels in the user's language), «ستلايت» = Esri
 * World Imagery. When a vector map can't load (no WebGL, the style doesn't answer) the map falls
 * back to the OpenStreetMap raster tiles by itself. One place to change the provider — e.g. Google
 * Maps once the owner's CNTXT account is ready (then the CSP in src/proxy.ts changes with it).
 */
export type MapLayer = "map" | "light" | "satellite";
export const MAP_LAYERS: MapLayer[] = ["map", "light", "satellite"];

export const OPENFREEMAP = "https://tiles.openfreemap.org";
const OFM_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

/** vector backgrounds: their style URL */
export const VECTOR_STYLES: Partial<Record<MapLayer, { style: string; attribution: string }>> = {
  map: { style: `${OPENFREEMAP}/styles/liberty`, attribution: OFM_ATTRIBUTION },
  light: { style: `${OPENFREEMAP}/styles/positron`, attribution: OFM_ATTRIBUTION },
};

/** raster backgrounds: satellite, and the street map used when a vector map can't load */
export const TILE_LAYERS: Record<"map" | "satellite", { url: string; attribution: string; maxZoom: number }> = {
  map: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
  },
};
/** hosts the CSP must allow for map images */
export const TILE_HOSTS = ["https://tile.openstreetmap.org", "https://server.arcgisonline.com", OPENFREEMAP];
/** hosts the vector maps fetch (style, tiles, fonts, icons) */
export const VECTOR_HOSTS = [OPENFREEMAP];

/** the remembered background (a per-device convenience; anything unknown → «خريطة») */
export function storedLayer(v: string | null): MapLayer {
  return MAP_LAYERS.includes(v as MapLayer) ? (v as MapLayer) : "map";
}

type StyleLayer = { type?: string; "source-layer"?: string; layout?: Record<string, unknown> };
/**
 * Labels in the user's language: every symbol layer whose text is a place / street / water name
 * shows `name:ar` (Arabic) or `name:en` (English), else the local name — house numbers and other
 * labels stay as they are. Returns a copy.
 */
export function localStyle<S extends { layers?: StyleLayer[] }>(style: S, locale: string): S {
  const name = ["coalesce", ["get", locale === "en" ? "name:en" : "name:ar"], ["get", "name"]];
  return {
    ...style,
    layers: style.layers?.map((l) => {
      const field = l.layout?.["text-field"];
      if (l.type !== "symbol" || field == null || l["source-layer"] === "housenumber" || !/name/.test(JSON.stringify(field))) return l;
      return { ...l, layout: { ...l.layout, "text-field": name } };
    }),
  };
}
