import "server-only";
import { isShortMapLink, parseMapCoords, resolveShortMapLink, type LatLng } from "@/lib/geo";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Owner (Nov 2026): «حطيت رابط موقعه». A client whose short WhatsApp map link couldn't be read when
 * it was saved (or was saved before the maps) is `pin_pending`; the server follows the **stored** link
 * by itself — never a value from the browser — and stores the pin, so the project has its site.
 * Service role: a supervisor opening the project may not hold clients.manage; the only thing written
 * is the pin read from the link the client record holds — and only while it still holds that link.
 * A link that can't be read counts a try (oldest tries first); after MAX_PIN_TRIES it is given up, so
 * dead links never block the others. Bounded by a deadline (pages and the daily job never hang on Google).
 */
export const MAX_PIN_TRIES = 5;
export type PinRow = { id: string; location_url: string | null; pin_tries: number };
type PinValues = { latitude?: number; longitude?: number; pin_pending: boolean; pin_tries?: number; pin_tried_at?: string };
export type PinDb = { pending: () => Promise<PinRow[]>; save: (row: PinRow, values: PinValues) => Promise<void> };

export async function resolvePendingPins(
  db: PinDb,
  deps: { fetchFn: (u: string, init: RequestInit) => Promise<Response>; allow: (id: string) => Promise<boolean>; deadline: number },
): Promise<Map<string, LatLng>> {
  const found = new Map<string, LatLng>();
  let rows: PinRow[];
  try {
    rows = await db.pending();
  } catch {
    return found;
  }
  for (const r of rows) {
    if (Date.now() >= deps.deadline) break;
    const direct = parseMapCoords(r.location_url);
    if (!direct && !isShortMapLink(r.location_url)) {
      await db.save(r, { pin_pending: false }).catch(() => undefined);
      continue;
    }
    if (!direct && !(await deps.allow(r.id))) continue;
    const pin = direct ?? (await resolveShortMapLink(r.location_url!, deps.fetchFn));
    if (!pin) {
      if (Date.now() >= deps.deadline) break; // cut by the deadline: not a real try
      const tries = r.pin_tries + 1;
      await db.save(r, { pin_tries: tries, pin_tried_at: new Date().toISOString(), pin_pending: tries < MAX_PIN_TRIES }).catch(() => undefined);
      continue;
    }
    const p = { lat: Math.round(pin.lat * 1e6) / 1e6, lng: Math.round(pin.lng * 1e6) / 1e6 };
    try {
      await db.save(r, { latitude: p.lat, longitude: p.lng, pin_pending: false });
      found.set(r.id, p);
    } catch {
      /* tried again later */
    }
  }
  return found;
}

/**
 * Read pending pins: of the given clients (a page, awaited with a short budget) or of an organization /
 * all organizations (background, daily job). Never throws; returns the pins it stored.
 */
export async function readPendingPins(opts: { orgId: string | null; clientIds?: string[]; limit?: number; budgetMs: number }): Promise<Map<string, LatLng>> {
  try {
    const deadline = Date.now() + opts.budgetMs;
    const stop = AbortSignal.timeout(opts.budgetMs);
    const admin = createAdminClient();
    const db: PinDb = {
      pending: async () => {
        let q = admin.from("clients").select("id, location_url, pin_tries").eq("pin_pending", true).is("latitude", null);
        if (opts.orgId) q = q.eq("organization_id", opts.orgId);
        if (opts.clientIds) q = q.in("id", opts.clientIds);
        const { data, error } = await q.order("pin_tried_at", { ascending: true, nullsFirst: true }).limit(opts.limit ?? 5);
        if (error) throw error;
        return (data ?? []).map((r) => ({ ...r, pin_tries: r.pin_tries ?? 0 }));
      },
      save: async (row, values) => {
        // only while the client still holds the link that was read, and no pin was set meanwhile
        let q = admin.from("clients").update(values).eq("id", row.id).eq("pin_pending", true).is("latitude", null);
        q = row.location_url == null ? q.is("location_url", null) : q.eq("location_url", row.location_url);
        const { error } = await q;
        if (error) throw error;
      },
    };
    return await resolvePendingPins(db, {
      deadline,
      fetchFn: (u, init) => fetch(u, { ...init, signal: init.signal ? AbortSignal.any([init.signal, stop]) : stop }),
      // one try per client per 10 minutes (pages load often)
      allow: async (id) => (await rateLimit(`pinread:${id}`, 1, 600)) === "ok",
    });
  } catch {
    return new Map();
  }
}
