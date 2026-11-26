/**
 * Maps (owner, Nov 2026): the project's site is a pin — `clients.latitude/longitude` — set on a map,
 * from the phone's position, or read from a Google Maps link. Long links carry the coordinates;
 * short WhatsApp links (maps.app.goo.gl) are followed on the server, to Google hosts only.
 * Pure (the fetch is passed in), so the rules are unit-tested.
 */
export type LatLng = { lat: number; lng: number };

/** Distance in metres (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

const valid = (lat: number, lng: number): LatLng | null =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : null;

/**
 * Coordinates written in a map link. The place pin (`!3d…!4d…`) wins over the view centre (`@…`);
 * also `?q=` / `query=` / `destination=` / `ll=` and `geo:`.
 */
export function parseMapCoords(url: string | null | undefined): LatLng | null {
  if (!url) return null;
  let s = url;
  try {
    s = decodeURIComponent(url);
  } catch {
    /* keep as is */
  }
  const pin = s.match(/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
  if (pin) return valid(Number(pin[1]), Number(pin[2]));
  const geo = s.match(/^geo:(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (geo) return valid(Number(geo[1]), Number(geo[2]));
  const param = s.match(/[?&](?:q|query|destination|ll|daddr)=(-?\d{1,2}\.\d+),\s*\+?(-?\d{1,3}\.\d+)/);
  if (param) return valid(Number(param[1]), Number(param[2]));
  const at = s.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (at) return valid(Number(at[1]), Number(at[2]));
  return null;
}

const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? { host: u.hostname.toLowerCase(), path: u.pathname } : null;
  } catch {
    return null;
  }
};

/** A short Google Maps link (no coordinates in it; the server follows it). */
export function isShortMapLink(url: string | null | undefined): boolean {
  const h = url ? hostOf(url) : null;
  return !!h && (h.host === "maps.app.goo.gl" || (h.host === "goo.gl" && h.path.startsWith("/maps")));
}

/** The only hosts a short link may lead through. */
const GOOGLE = /^(maps\.app\.goo\.gl|goo\.gl|(www\.|maps\.)?google\.com(\.sa)?)$/;

/**
 * Follow a short link's redirects (manual, ≤ 5 hops, Google hosts only, no body read) until a
 * redirect target carries coordinates. Anything else — another host, a loop, an error — is null.
 */
export async function resolveShortMapLink(url: string, fetchFn: (u: string, init: RequestInit) => Promise<Response>): Promise<LatLng | null> {
  if (!isShortMapLink(url)) return null;
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    let res: Response;
    try {
      res = await fetchFn(current, { redirect: "manual", method: "GET", headers: { "user-agent": "Mozilla/5.0 (compatible; site-pin)" }, signal: AbortSignal.timeout(5000) });
    } catch {
      return null;
    }
    const to = res.headers.get("location");
    if (!to || res.status < 300 || res.status >= 400) return null;
    let next: string;
    try {
      next = new URL(to, current).toString();
    } catch {
      return null;
    }
    const h = hostOf(next);
    if (!h || !GOOGLE.test(h.host)) return null;
    const found = parseMapCoords(next);
    if (found) return found;
    current = next;
  }
  return null;
}

/** The project's site: the stored pin, else coordinates in its map link. */
export function siteOf(c: { latitude: number | null; longitude: number | null; location_url: string | null }): LatLng | null {
  if (c.latitude != null && c.longitude != null) return valid(Number(c.latitude), Number(c.longitude));
  return parseMapCoords(c.location_url);
}

/** Beyond this from the site a check-in reads «far». */
export const FAR_METERS = 300;

export type VisitPin = LatLng & { id: string; at: string; distance: number | null; far: boolean };
export function visitPins(site: LatLng | null, visits: { id: string; latitude: number | null; longitude: number | null; checked_in_at: string }[]): VisitPin[] {
  return visits
    .filter((v) => v.latitude != null && v.longitude != null)
    .map((v) => {
      const p = { lat: Number(v.latitude), lng: Number(v.longitude) };
      const d = site ? distanceMeters(site, p) : null;
      return { ...p, id: v.id, at: v.checked_in_at, distance: d, far: d != null && d > FAR_METERS };
    });
}

/** Active projects: those with a site become pins, the rest are listed apart (to set their site). */
export function activePins<T extends { site: LatLng | null }>(projects: T[]): { pins: (T & { site: LatLng })[]; missing: T[] } {
  return {
    pins: projects.filter((p): p is T & { site: LatLng } => !!p.site),
    missing: projects.filter((p) => !p.site),
  };
}

/** A Google Maps link that opens on the pin (navigation from the phone). */
export const mapLink = (p: LatLng) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.lat},${p.lng}`)}`;
