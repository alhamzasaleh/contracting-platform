import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bill-of-quantities loaders (review #4, #5): a refused quote_version_quantities() is an error —
 * never "nothing to buy"; and the project table reads stock items exactly like the purchase form
 * (same loader, ordered), so "bought" can't differ between the two.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

type Call = { table: string; ops: [string, unknown[]][] };
const calls: Call[] = [];
let rpcResult: { data: unknown; error: unknown } = { data: { items: [], needs: [] }, error: null };
const TABLES: Record<string, unknown> = {
  quotes: { id: "q1", number: "Q-2026-001", service: "interior", client_id: "cl", current_version: 1, options: null },
  contracts: { id: "k1", number: "C-2026-001", status: "accepted", service: "interior", quote_id: "q1", quote_version: 1, client_id: "cl", options: null },
  clients: { name: "سعد", phone: null, city: null },
  quote_versions: { id: "v1", version: 1, created_at: "2026-11-20T00:00:00Z" },
};

function builder(table: string) {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const op of ["select", "eq", "in", "order", "limit"]) b[op] = (...a: unknown[]) => { call.ops.push([op, a]); return b; };
  b.maybeSingle = () => Promise.resolve({ data: TABLES[table] ?? null, error: null });
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res, rej);
  return b;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (t: string) => builder(t), rpc: async () => rpcResult }),
}));

const session = (perms: string[]) => ({ organization: { id: "org" }, permissions: new Set(perms), isOwner: false }) as never;
vi.mock("@/lib/auth/session", () => ({ can: (s: { permissions: Set<string> }, p: string) => s.permissions.has(p) }));

beforeEach(() => {
  calls.length = 0;
  rpcResult = { data: { items: [], needs: [] }, error: null };
});

describe("bill of quantities loaders", () => {
  it("#5 a refused quote_version_quantities() is an error, not an empty table", async () => {
    const { loadQuoteMaterials } = await import("@/lib/data/materials");
    rpcResult = { data: null, error: { code: "42501", message: "not allowed" } };
    await expect(loadQuoteMaterials(session(["quotes.view"]), "Q-2026-001", false)).rejects.toThrow(/quote_version_quantities/);
  });

  it("without costs.view the priced table is never read, even when asked", async () => {
    const { loadQuoteMaterials } = await import("@/lib/data/materials");
    const doc = await loadQuoteMaterials(session(["quotes.view"]), "Q-2026-001", true);
    expect(doc.prices).toBe(false);
    expect(calls.some((c) => c.table === "quote_version_costs")).toBe(false);
  });

  it("#4 the project table loads stock items like the purchase form (ordered by name)", async () => {
    const { loadProjectMaterials } = await import("@/lib/data/materials");
    await loadProjectMaterials(session(["quotes.view", "purchases.view"]), "C-2026-001", false);
    const items = calls.filter((c) => c.table === "inventory_items");
    expect(items).toHaveLength(1);
    expect(items[0].ops.filter(([op]) => op === "order").map(([, a]) => a[0])).toEqual(["name", "id"]);
  });
});
