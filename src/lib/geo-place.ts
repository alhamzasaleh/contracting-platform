/**
 * One place for the site (owner, Nov 2026): a pasted map link is read at once, and the city and
 * district fill themselves from the pin. Pure (the fetch is passed in), so the rules are unit-tested.
 * The address comes from OpenStreetMap's reverse lookup (Nominatim) — coordinates only, never a
 * client's name or phone; few requests (one per pin change, rate-limited on the server).
 */
import type { LatLng } from "@/lib/geo";

export type Place = { city: string | null; district: string | null };

/** A Google Maps link complete enough to read (https, a maps host and a path), or a geo: URI. */
export function looksLikeMapLink(text: string): boolean {
  const s = text.trim();
  if (/^geo:-?\d/.test(s)) return true;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "maps.app.goo.gl") return u.pathname.length > 1;
    if (host === "goo.gl") return u.pathname.startsWith("/maps");
    return /^(www\.|maps\.)?google\.[a-z.]+$/.test(host) && (host.startsWith("maps.") || u.pathname.startsWith("/maps"));
  } catch {
    return false;
  }
}

const clean = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  const t = s.trim().replace(/^حي\s+/, "").slice(0, 80);
  return t || null;
};

/** City and district from a reverse lookup's `address` (Saudi cities: district = suburb / neighbourhood / quarter). */
export function placeFromReverse(json: unknown): Place | null {
  if (!json || typeof json !== "object" || !("address" in json)) return null;
  const a = (json as { address?: Record<string, unknown> }).address;
  if (!a || typeof a !== "object") return null;
  return {
    city: clean(a.city ?? a.town ?? a.village ?? a.municipality),
    district: clean(a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district),
  };
}

const same = (a: string, b: string) => clean(a) === clean(b);

/** Fill the empty fields from the map; a different non-empty value is offered, never overwritten. */
export function fillPlace(current: { city: string; district: string }, found: Place): { city: string; district: string; offer: Place | null } {
  const city = current.city.trim() || found.city || "";
  const district = current.district.trim() || found.district || "";
  const differs =
    (!!found.city && !!current.city.trim() && !same(current.city, found.city)) ||
    (!!found.district && !!current.district.trim() && !same(current.district, found.district));
  return { city, district, offer: differs ? found : null };
}

/** Reverse lookup (server side). Any failure is «nothing found». */
export async function reversePlace(p: LatLng, fetchFn: (u: string, init: RequestInit) => Promise<Response>): Promise<Place | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1&accept-language=ar&lat=${encodeURIComponent(p.lat)}&lon=${encodeURIComponent(p.lng)}`;
  try {
    const res = await fetchFn(url, { headers: { "user-agent": "malmas-site-pin/1.0", accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return placeFromReverse(await res.json());
  } catch {
    return null;
  }
}
