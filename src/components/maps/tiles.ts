/**
 * Map backgrounds (owner, Nov 2026): «خريطة» (OpenStreetMap streets) and «ستلايت» (Esri World
 * Imagery). One place to change the provider — e.g. Google Maps once the owner's CNTXT account is
 * ready (then the CSP img-src in src/proxy.ts changes with it).
 */
export type MapLayer = "map" | "satellite";
export const TILE_LAYERS: Record<MapLayer, { url: string; attribution: string; maxZoom: number }> = {
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
export const TILE_HOSTS = ["https://tile.openstreetmap.org", "https://server.arcgisonline.com"];
