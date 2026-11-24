import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Staff names in loaders (review of «staff names», Nov 2026): names for every member (a suspended
 * assignee / closer / holder / visitor / actor keeps his name), pick lists of active members only,
 * profile queries limited to the ids needed, and the linked employee's «name · job».
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/lib/ai/invoice", () => ({ aiConfigured: () => false }));
vi.mock("@/lib/data/purchases", () => ({ loadProjectCosts: async () => [] }));
vi.mock("@/lib/data/contracts", () => ({ loadBookingTeam: async () => null, loadWarrantyEnd: async () => null }));

type Call = { table: string; ops: [string, unknown[]][] };
const calls: Call[] = [];
let TABLES: Record<string, unknown[]> = {};
const RPC: Record<string, unknown[]> = {
  staff_employee_names: [{ user_id: "u2", full_name: "محمد القحطاني", job_title: "مشرف" }],
  contract_warranties: [],
};

function builder(table: string) {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const op of ["select", "eq", "neq", "in", "is", "gt", "order", "limit"]) b[op] = (...a: unknown[]) => { call.ops.push([op, a]); return b; };
  b.maybeSingle = () => Promise.resolve({ data: (TABLES[table] ?? [])[0] ?? null, error: null });
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: TABLES[table] ?? [], error: null, count: 0 }).then(res, rej);
  return b;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (t: string) => builder(t),
    rpc: (name: string) => Promise.resolve({ data: RPC[name] ?? [], error: null }),
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
  }),
}));
const session = { organization: { id: "org", name: "Org" }, userId: "u1", permissions: new Set(["projects.view", "purchases.view", "audit.view"]), isOwner: false } as never;
vi.mock("@/lib/auth/session", () => ({ can: (s: { permissions: Set<string> }, p: string) => s.permissions.has(p) }));

const MEMBERS = [
  { user_id: "u1", status: "active" },
  { user_id: "u2", status: "suspended" },
];
const PROFILES = [
  { id: "u1", full_name: "صالح", phone: "966500000001" },
  { id: "u2", full_name: "حساب محمد", phone: "966500000002" },
  { id: "u3", full_name: null, phone: "966500000003" },
];

beforeEach(() => {
  calls.length = 0;
  TABLES = { memberships: MEMBERS, profiles: PROFILES };
});

describe("maintenance", () => {
  it("a suspended assignee / closer keeps his «name · job»; the pick list has active members only", async () => {
    TABLES.maintenance_requests = [{ id: "m", number: "MR-2026-001", contract_id: "k", photos: [], status: "closed", assigned_to: "u2", closed_by: "u2", cost: 0 }];
    const { loadMaintenance } = await import("@/lib/data/maintenance");
    const d = await loadMaintenance(session);
    expect(d.members).toEqual([{ id: "u1", name: "صالح" }]);
    expect(d.names).toMatchObject({ u1: "صالح", u2: "محمد القحطاني · مشرف" });
  });
});

describe("petty cash", () => {
  it("a suspended holder keeps his name; new accounts can only go to active members", async () => {
    TABLES.petty_cash_accounts = [{ id: "a", name: "عهدة", holder_id: "u2", is_active: true }];
    const { loadPettyCash } = await import("@/lib/data/subcontractors");
    const d = await loadPettyCash(session);
    expect(d.accounts[0].holder).toBe("محمد القحطاني · مشرف");
    expect(d.members).toEqual([{ id: "u1", name: "صالح" }]);
  });
});

describe("project visits", () => {
  it("names come from the visits' own users only, with the linked employee's job", async () => {
    TABLES.contracts = [{ id: "k", number: "C-2026-001", status: "accepted", start_date: "2026-11-01", duration_days: 10, client_id: "cl", quote_id: "q", quote_version: 1 }];
    TABLES.site_visits = [{ id: "v1", checked_in_at: "2026-11-02T08:00:00Z", latitude: null, longitude: null, accuracy_m: null, note: null, created_by: "u2" }, { id: "v2", checked_in_at: "2026-11-03T08:00:00Z", latitude: null, longitude: null, accuracy_m: null, note: null, created_by: "u3" }];
    const { loadProject } = await import("@/lib/data/projects");
    const d = await loadProject(session, "C-2026-001");
    expect(d.visits.map((v) => v.by)).toEqual(["محمد القحطاني · مشرف", "0500000003"]);
    const profiles = calls.filter((c) => c.table === "profiles");
    expect(profiles).toHaveLength(1);
    expect(profiles[0].ops).toContainEqual(["in", ["id", ["u2", "u3"]]]);
  });
});

describe("audit log", () => {
  it("actors show «name · job»; no name → the phone", async () => {
    TABLES.audit_log = [
      { id: 2, created_at: "2026-11-02T08:00:00Z", actor_id: "u2", action: "update", table_name: "clients", before: null, after: null },
      { id: 1, created_at: "2026-11-01T08:00:00Z", actor_id: "u3", action: "insert", table_name: "clients", before: null, after: null },
    ];
    const { loadAudit } = await import("@/lib/data/audit");
    const items = await loadAudit(session);
    expect(items.map((i) => i.actor)).toEqual(["محمد القحطاني · مشرف", "0500000003"]);
  });
});
