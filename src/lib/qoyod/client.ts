import "server-only";
import { errorText, QOYOD_BASE } from "./payloads";

export class QoyodError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** One call to Qoyod. The key is sent only in the API-KEY header and never logged. */
export async function qoyod<T = Record<string, unknown>>(key: string, method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${QOYOD_BASE}${path}`, {
      method,
      headers: { "API-KEY": key, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new QoyodError(0, "network");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text.slice(0, 200);
  }
  if (!res.ok) throw new QoyodError(res.status, errorText(res.status, json));
  return json as T;
}

export type QoyodOptions = {
  accounts: { id: number; code: string; name: string; receive: boolean; type: string }[];
  inventories: { id: number; name: string }[];
  products: { id: number; name: string; sku: string; sale: boolean }[];
};

/** Lists the owner picks from (accounts, warehouses, products) — also proves the key works. */
export async function qoyodOptions(key: string): Promise<QoyodOptions> {
  const [a, i, p] = await Promise.all([
    qoyod<{ accounts?: { id: number; code: string; name_ar?: string; name_en?: string; receive_payments?: boolean; type?: string; status?: string }[] }>(key, "GET", "/accounts"),
    qoyod<{ inventories?: { id: number; ar_name?: string; name?: string }[] }>(key, "GET", "/inventories"),
    qoyod<{ products?: { id: number; name_ar?: string; name_en?: string; sku?: string; is_sold?: boolean }[] }>(key, "GET", "/products"),
  ]);
  return {
    accounts: (a.accounts ?? []).filter((x) => x.status !== "Inactive").map((x) => ({ id: x.id, code: x.code, name: x.name_ar || x.name_en || String(x.id), receive: !!x.receive_payments, type: x.type ?? "" })),
    inventories: (i.inventories ?? []).map((x) => ({ id: x.id, name: x.ar_name || x.name || String(x.id) })),
    products: (p.products ?? []).map((x) => ({ id: x.id, name: x.name_ar || x.name_en || String(x.id), sku: x.sku ?? "", sale: x.is_sold !== false })),
  };
}
