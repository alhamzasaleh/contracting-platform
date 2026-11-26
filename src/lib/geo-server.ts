import "server-only";
import { isShortMapLink, parseMapCoords, resolveShortMapLink, type LatLng } from "@/lib/geo";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Coordinates of a map link: written in it, else (short WhatsApp link) by following it on the
 * server — rate-limited per user. `rateLimited` is said apart (not "no location in the link").
 */
export async function linkCoords(userId: string, url: string | null | undefined): Promise<{ pin: LatLng | null; rateLimited?: boolean }> {
  if (!url) return { pin: null };
  const direct = parseMapCoords(url);
  if (direct || !isShortMapLink(url)) return { pin: direct };
  if ((await rateLimit(`maplink:${userId}`, 60, 3600)) !== "ok") return { pin: null, rateLimited: true };
  return { pin: await resolveShortMapLink(url, (u, init) => fetch(u, init)) };
}
