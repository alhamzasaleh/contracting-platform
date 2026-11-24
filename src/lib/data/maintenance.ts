import "server-only";
import { can, type SessionContext } from "@/lib/auth/session";
import type { MaintenanceStatus } from "@/lib/supabase/database.types";
import { once, rows } from "@/lib/data/query";
import { createClient } from "@/lib/supabase/server";

export type MaintenanceItem = {
  id: string; number: string; contract: string; client: string; client_phone: string | null; body: string; photos: string[]; source: "client" | "staff";
  status: MaintenanceStatus; assigned_to: string | null; covered: boolean; cost: number; reply: string | null; internal_note: string | null;
  created_at: string; resolved_at: string | null; client_confirmed_at: string | null;
  /** closed / rejected: when, and by which staff member (null = the client confirmed) */
  closed_at?: string | null; closed_by?: string | null;
};
export type WarrantyItem = { number: string; client: string; handover_at: string; warranty_end: string; active: boolean };
export type MaintenancePageData = {
  requests: MaintenanceItem[];
  warranties: WarrantyItem[];
  members: { id: string; name: string }[];
  canManage: boolean;
  /** signs the ready WhatsApp messages */
  orgName?: string;
};

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });

export async function loadMaintenance(session: SessionContext): Promise<MaintenancePageData> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const rowsP = once(supabase.from("maintenance_requests").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(300));
  const membershipsP = once(supabase.from("memberships").select("user_id").eq("organization_id", orgId).eq("status", "active"));
  // chained onto the requests (their contracts → clients, photo links) and the members (names): ~3 round trips in all
  const contractsP = rowsP.then(({ data }) => {
    const contractIds = [...new Set((data ?? []).map((r) => r.contract_id))];
    return contractIds.length ? rows(supabase.from("contracts").select("id, number, client_id").in("id", contractIds)) : [];
  });
  const [{ data: list0 }, { data: warranties }, contracts, clients, signed, profiles] = await Promise.all([
    rowsP,
    supabase.rpc("contract_warranties", { p_org: orgId }),
    contractsP,
    contractsP.then((cs) => {
      const clientIds = [...new Set(cs.map((c) => c.client_id))];
      return clientIds.length ? rows(supabase.from("clients").select("id, name, phone").in("id", clientIds)) : [];
    }),
    rowsP.then(async ({ data }) => {
      const paths = [...new Set((data ?? []).flatMap((r) => r.photos))];
      return paths.length ? ((await supabase.storage.from("project-photos").createSignedUrls(paths, 600)).data ?? []) : [];
    }),
    membershipsP.then(({ data }) => {
      const ids = (data ?? []).map((m) => m.user_id);
      return ids.length ? rows(supabase.from("profiles").select("id, full_name, phone").in("id", ids)) : [];
    }),
  ]);
  const list = list0 ?? [];
  const contract = new Map(contracts.map((c) => [c.id, c]));
  const client = new Map(clients.map((c) => [c.id, c]));
  const url = new Map(signed.map((s) => [s.path, s.signedUrl]));

  const d = today();
  return {
    requests: list.map((r) => {
      const c = contract.get(r.contract_id);
      const cl = c ? client.get(c.client_id) : undefined;
      return {
        id: r.id, number: r.number, contract: c?.number ?? "—", client: cl?.name ?? "—", client_phone: cl?.phone ?? null, body: r.body,
        photos: r.photos.map((p) => url.get(p)).filter((u): u is string => !!u), source: r.source, status: r.status, assigned_to: r.assigned_to,
        covered: r.covered, cost: Number(r.cost), reply: r.reply, internal_note: r.internal_note, created_at: r.created_at, resolved_at: r.resolved_at, client_confirmed_at: r.client_confirmed_at,
        closed_at: r.closed_at, closed_by: r.closed_by,
      };
    }),
    warranties: (warranties ?? [])
      .filter((w) => w.handover_at && w.warranty_end)
      .map((w) => ({ number: w.number, client: w.client_name, handover_at: w.handover_at!, warranty_end: w.warranty_end!, active: w.warranty_end! >= d }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.warranty_end.localeCompare(b.warranty_end)),
    members: (profiles ?? []).map((p) => ({ id: p.id, name: p.full_name || (p.phone ? `0${p.phone.slice(3)}` : "—") })),
    canManage: can(session, "projects.manage"),
    orgName: session.organization.name,
  };
}
