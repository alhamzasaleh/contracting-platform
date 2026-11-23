import "server-only";
import { can, type SessionContext } from "@/lib/auth/session";
import type { MaintenanceStatus } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type MaintenanceItem = {
  id: string; number: string; contract: string; client: string; client_phone: string | null; body: string; photos: string[]; source: "client" | "staff";
  status: MaintenanceStatus; assigned_to: string | null; covered: boolean; cost: number; reply: string | null; internal_note: string | null;
  created_at: string; resolved_at: string | null; client_confirmed_at: string | null;
};
export type WarrantyItem = { number: string; client: string; handover_at: string; warranty_end: string; active: boolean };
export type MaintenancePageData = {
  requests: MaintenanceItem[];
  warranties: WarrantyItem[];
  members: { id: string; name: string }[];
  canManage: boolean;
};

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });

export async function loadMaintenance(session: SessionContext): Promise<MaintenancePageData> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: rows }, { data: warranties }, { data: memberships }] = await Promise.all([
    supabase.from("maintenance_requests").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(300),
    supabase.rpc("contract_warranties", { p_org: orgId }),
    supabase.from("memberships").select("user_id").eq("organization_id", orgId).eq("status", "active"),
  ]);
  const list = rows ?? [];
  const contractIds = [...new Set(list.map((r) => r.contract_id))];
  const { data: contracts } = contractIds.length ? await supabase.from("contracts").select("id, number, client_id").in("id", contractIds) : { data: [] };
  const clientIds = [...new Set((contracts ?? []).map((c) => c.client_id))];
  const { data: clients } = clientIds.length ? await supabase.from("clients").select("id, name, phone").in("id", clientIds) : { data: [] };
  const contract = new Map((contracts ?? []).map((c) => [c.id, c]));
  const client = new Map((clients ?? []).map((c) => [c.id, c]));

  const paths = [...new Set(list.flatMap((r) => r.photos))];
  const { data: signed } = paths.length ? await supabase.storage.from("project-photos").createSignedUrls(paths, 600) : { data: [] };
  const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  const ids = (memberships ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("id, full_name, phone").in("id", ids) : { data: [] };
  const d = today();
  return {
    requests: list.map((r) => {
      const c = contract.get(r.contract_id);
      const cl = c ? client.get(c.client_id) : undefined;
      return {
        id: r.id, number: r.number, contract: c?.number ?? "—", client: cl?.name ?? "—", client_phone: cl?.phone ?? null, body: r.body,
        photos: r.photos.map((p) => url.get(p)).filter((u): u is string => !!u), source: r.source, status: r.status, assigned_to: r.assigned_to,
        covered: r.covered, cost: Number(r.cost), reply: r.reply, internal_note: r.internal_note, created_at: r.created_at, resolved_at: r.resolved_at, client_confirmed_at: r.client_confirmed_at,
      };
    }),
    warranties: (warranties ?? [])
      .filter((w) => w.handover_at && w.warranty_end)
      .map((w) => ({ number: w.number, client: w.client_name, handover_at: w.handover_at!, warranty_end: w.warranty_end!, active: w.warranty_end! >= d }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.warranty_end.localeCompare(b.warranty_end)),
    members: (profiles ?? []).map((p) => ({ id: p.id, name: p.full_name || (p.phone ? `0${p.phone.slice(3)}` : "—") })),
    canManage: can(session, "projects.manage"),
  };
}
