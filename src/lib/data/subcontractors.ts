import "server-only";
import { aiConfigured } from "@/lib/ai/invoice";
import { can, type SessionContext } from "@/lib/auth/session";
import type { ServiceKind } from "@/lib/pricing";
import { createClient } from "@/lib/supabase/server";

const n = (v: unknown) => Number(v ?? 0);
type ProjectRef = { id: string; number: string; client: string };

async function projects(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, canSee: boolean): Promise<ProjectRef[]> {
  if (!canSee) return [];
  const [{ data: contracts }, { data: clients }] = await Promise.all([
    supabase.from("contracts").select("id, number, client_id").eq("organization_id", orgId).eq("status", "accepted").order("created_at", { ascending: false }),
    supabase.from("clients").select("id, name").eq("organization_id", orgId),
  ]);
  const names = new Map((clients ?? []).map((c) => [c.id, c.name]));
  return (contracts ?? []).map((c) => ({ id: c.id, number: c.number, client: names.get(c.client_id) ?? "—" }));
}

export type SubAgreementView = {
  id: string; subcontractor_id: string; contract_id: string; scope: string; basis: "lump" | "per_m2"; rate: number; quantity_m2: number | null;
  schedule: "weekly" | "progress"; status: "active" | "closed";
  work: { id: string; work_date: string; quantity_m2: number | null; percent: number | null; amount: number; note: string | null }[];
  payments: { id: string; paid_on: string; amount: number; method: string; reference: string | null }[];
};
export type SubcontractorsData = {
  subs: { id: string; name: string; phone: string | null; services: ServiceKind[]; iban: string | null; vat_number: string | null; notes: string | null; is_active: boolean }[];
  agreements: SubAgreementView[];
  projects: ProjectRef[];
  canManage: boolean;
  canPay: boolean;
};

export async function loadSubcontractors(session: SessionContext): Promise<SubcontractorsData> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: subs }, { data: agreements }, { data: work }, { data: payments }, projectList] = await Promise.all([
    supabase.from("subcontractors").select("id, name, phone, services, iban, vat_number, notes, is_active").eq("organization_id", orgId).order("name"),
    supabase.from("subcontractor_agreements").select("id, subcontractor_id, contract_id, scope, basis, rate, quantity_m2, schedule, status").eq("organization_id", orgId).order("created_at", { ascending: false }),
    supabase.from("subcontractor_work").select("id, agreement_id, work_date, quantity_m2, percent, amount, note").eq("organization_id", orgId).order("work_date", { ascending: false }).limit(5000),
    supabase.from("subcontractor_payments").select("id, agreement_id, paid_on, amount, method, reference").eq("organization_id", orgId).order("paid_on", { ascending: false }).limit(5000),
    projects(supabase, orgId, can(session, "quotes.view")),
  ]);
  return {
    subs: subs ?? [],
    agreements: (agreements ?? []).map((g) => ({
      ...g, rate: n(g.rate), quantity_m2: g.quantity_m2 == null ? null : n(g.quantity_m2),
      work: (work ?? []).filter((w) => w.agreement_id === g.id).map((w) => ({ ...w, amount: n(w.amount), quantity_m2: w.quantity_m2 == null ? null : n(w.quantity_m2), percent: w.percent == null ? null : n(w.percent) })),
      payments: (payments ?? []).filter((p) => p.agreement_id === g.id).map((p) => ({ ...p, amount: n(p.amount) })),
    })),
    projects: projectList,
    canManage: can(session, "purchases.manage"),
    canPay: can(session, "finance.manage"),
  };
}

export type PettyCashData = {
  accounts: { id: string; name: string; holder_id: string; holder: string; is_active: boolean }[];
  entries: { id: string; account_id: string; kind: "topup" | "expense" | "return"; entry_date: string; amount: number; contract_id: string | null; description: string; supplier_name: string | null; has_receipt: boolean; ai_extracted: boolean }[];
  members: { id: string; name: string }[];
  projects: ProjectRef[];
  userId: string;
  canFinance: boolean;
  canManage: boolean;
  aiEnabled: boolean;
};

export async function loadPettyCash(session: SessionContext): Promise<PettyCashData> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: accounts }, { data: entries }, { data: memberships }, projectList] = await Promise.all([
    supabase.from("petty_cash_accounts").select("id, name, holder_id, is_active").eq("organization_id", orgId).order("name"),
    supabase.from("petty_cash_entries").select("id, account_id, kind, entry_date, amount, contract_id, description, supplier_name, attachment_path, ai_extracted").eq("organization_id", orgId).order("entry_date", { ascending: false }).limit(2000),
    supabase.from("memberships").select("user_id").eq("organization_id", orgId),
    projects(supabase, orgId, can(session, "quotes.view") || can(session, "projects.view")),
  ]);
  const ids = (memberships ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("id, full_name, phone").in("id", ids) : { data: [] };
  const name = new Map((profiles ?? []).map((p) => [p.id, p.full_name || (p.phone ? `0${p.phone.slice(3)}` : "—")]));
  return {
    accounts: (accounts ?? []).map((a) => ({ ...a, holder: name.get(a.holder_id) ?? "—" })),
    entries: (entries ?? []).map(({ attachment_path, ...e }) => ({ ...e, amount: n(e.amount), has_receipt: !!attachment_path })),
    members: ids.map((id) => ({ id, name: name.get(id) ?? "—" })),
    projects: projectList,
    userId: session.userId,
    canFinance: can(session, "finance.manage"),
    canManage: can(session, "purchases.manage"),
    aiEnabled: aiConfigured(),
  };
}
