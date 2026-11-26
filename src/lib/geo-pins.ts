import "server-only";
import { isShortMapLink, parseMapCoords, resolveShortMapLink } from "@/lib/geo";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Owner (Nov 2026): «حطيت رابط موقعه». A client whose short WhatsApp map link couldn't be read when
 * it was saved (or was saved before the maps) is `pin_pending`; the server follows the **stored** link
 * by itself — never a value from the browser — and stores the pin, so the project has its site.
 * Service role: a supervisor opening the project may not hold clients.manage; the only thing written
 * is the pin read from the link the client record already holds.
 */
type Row = { id: string; location_url: string | null };
type PinValues = { latitude?: number; longitude?: number; pin_pending: boolean };
export type PinDb = { pending: () => Promise<Row[]>; save: (id: string, values: PinValues) => Promise<void> };

export async function resolvePendingPins(
  db: PinDb,
  deps: { fetchFn: (u: string, init: RequestInit) => Promise<Response>; allow: (id: string) => Promise<boolean> },
): Promise<number> {
  let rows: Row[];
  try {
    rows = await db.pending();
  } catch {
    return 0;
  }
  let done = 0;
  for (const r of rows) {
    const direct = parseMapCoords(r.location_url);
    if (!direct && !isShortMapLink(r.location_url)) {
      await db.save(r.id, { pin_pending: false }).catch(() => undefined);
      continue;
    }
    if (!direct && !(await deps.allow(r.id))) continue;
    const pin = direct ?? (await resolveShortMapLink(r.location_url!, deps.fetchFn));
    if (!pin) continue; // Google unreachable / no answer: tried again later
    try {
      await db.save(r.id, { latitude: Math.round(pin.lat * 1e6) / 1e6, longitude: Math.round(pin.lng * 1e6) / 1e6, pin_pending: false });
      done++;
    } catch {
      /* tried again later */
    }
  }
  return done;
}

/** Read the pending pins of one organization (pages) or of all (daily job). Never throws. */
export async function readPendingPins(orgId: string | null, limit = 5): Promise<number> {
  try {
    const admin = createAdminClient();
    const db: PinDb = {
      pending: async () => {
        let q = admin.from("clients").select("id, location_url").eq("pin_pending", true).is("latitude", null).limit(limit);
        if (orgId) q = q.eq("organization_id", orgId);
        const { data, error } = await q;
        if (error) throw error;
        return data ?? [];
      },
      save: async (id, values) => {
        const { error } = await admin.from("clients").update(values).eq("id", id).eq("pin_pending", true).is("latitude", null);
        if (error) throw error;
      },
    };
    // one try per client per 10 minutes (pages load often)
    return await resolvePendingPins(db, { fetchFn: (u, init) => fetch(u, init), allow: async (id) => (await rateLimit(`pinread:${id}`, 1, 600)) === "ok" });
  } catch {
    return 0;
  }
}
