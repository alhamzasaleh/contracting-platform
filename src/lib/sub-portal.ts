import "server-only";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import type { Brand } from "@/lib/supabase/database.types";
import { portalLogo } from "@/lib/portal";
import { TOKEN_RE } from "@/lib/portal-token";
import { subStatement, SUB_NUMBER_RE, SUB_VOUCHER_RE } from "@/lib/subcontractors/statement";
import type { SubVoucherDoc } from "@/lib/data/subcontractors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DocOrg } from "@/components/subcontractors/documents";

/**
 * The subcontractor's own page (/s/<SC-…>/<token>). Read by the server only: rate limited per IP, then the
 * database checks the token by its hash, expiry, revocation and that he is active (service role only).
 * It holds no costs, client prices, margins, client phones or IDs.
 */
export type SubPortalAgreement = {
  id: string; contract: string; client: string; city: string | null; district: string | null; scope: string; basis: "lump" | "per_m2"; rate: number;
  quantity_m2: number | null; schedule: "weekly" | "progress"; status: "active" | "closed"; created_at: string;
  work: { work_date: string; quantity_m2: number | null; percent: number | null; amount: number; note: string | null }[];
  payments: { number: string; paid_on: string; amount: number; method: string }[];
};
export type SubPortalData = {
  org: { name: string; legal_name: string | null; phone: string | null; brand: Brand };
  subcontractor: { number: string; name: string };
  expires_at: string;
  agreements: SubPortalAgreement[];
  statement: ReturnType<typeof subStatement>;
};

type Loaded = { data: SubPortalData | null; logoUrl: string | null; limited: boolean; unavailable?: boolean };
const n = (v: unknown) => Number(v ?? 0);

export async function loadSubPortal(number: string, token: string): Promise<Loaded> {
  if (!SUB_NUMBER_RE.test(number) || !TOKEN_RE.test(token)) return { data: null, logoUrl: null, limited: false };
  const rl = await rateLimit(`sub:view:${await clientIp()}`, 30, 60);
  if (rl === "limited") return { data: null, logoUrl: null, limited: true };
  if (rl !== "ok") return { data: null, logoUrl: null, limited: false, unavailable: true };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("subcontractor_portal_view", { p_number: number, p_token: token });
  if (error) {
    console.error("[sub-portal] view failed", { code: error.code }); // never the message (it may hold the token)
    return { data: null, logoUrl: null, limited: false };
  }
  const raw = data as unknown as (Omit<SubPortalData, "statement" | "org"> & { org: SubPortalData["org"] & { id: string; logo_path: string | null } }) | null;
  if (!raw) return { data: null, logoUrl: null, limited: false };
  const agreements = (raw.agreements ?? []).map((g) => ({
    ...g, rate: n(g.rate), quantity_m2: g.quantity_m2 == null ? null : n(g.quantity_m2),
    work: (g.work ?? []).map((w) => ({ ...w, amount: n(w.amount), quantity_m2: w.quantity_m2 == null ? null : n(w.quantity_m2), percent: w.percent == null ? null : n(w.percent) })),
    payments: (g.payments ?? []).map((p) => ({ ...p, amount: n(p.amount) })),
  }));
  const statement = subStatement(
    agreements.map((g) => ({ id: g.id, contract: g.contract, client: g.client, scope: g.scope })),
    agreements.flatMap((g) => g.work.map((w) => ({ ...w, agreement_id: g.id }))),
    agreements.flatMap((g) => g.payments.map((p) => ({ ...p, agreement_id: g.id }))),
  );
  return {
    logoUrl: await portalLogo(admin, raw.org.id, raw.org.logo_path),
    limited: false,
    data: { org: { name: raw.org.name, legal_name: raw.org.legal_name, phone: raw.org.phone, brand: raw.org.brand }, subcontractor: raw.subcontractor, expires_at: raw.expires_at, agreements, statement },
  };
}

/** One of his payment vouchers (print / PDF): the same token checks and per-IP limit as his page. */
export async function loadSubPortalVoucher(number: string, token: string, voucher: string): Promise<{ doc: SubVoucherDoc | null; org: DocOrg | null; brand: Brand | null }> {
  if (!SUB_NUMBER_RE.test(number) || !TOKEN_RE.test(token) || !SUB_VOUCHER_RE.test(voucher)) return { doc: null, org: null, brand: null };
  if ((await rateLimit(`sub:view:${await clientIp()}`, 30, 60)) !== "ok") return { doc: null, org: null, brand: null };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("subcontractor_portal_voucher", { p_number: number, p_token: token, p_voucher: voucher });
  if (error) {
    console.error("[sub-portal] voucher failed", { code: error.code });
    return { doc: null, org: null, brand: null };
  }
  const raw = data as unknown as (Omit<SubVoucherDoc, "org"> & { org: DocOrg & { id: string; logo_path: string | null; brand: Brand } }) | null;
  if (!raw) return { doc: null, org: null, brand: null };
  const { id, logo_path, brand, ...org } = raw.org;
  return {
    brand,
    org: { ...org, logoUrl: await portalLogo(admin, id, logo_path) },
    doc: { voucher: { ...raw.voucher, amount: n(raw.voucher.amount) }, sub: (raw as unknown as { subcontractor: SubVoucherDoc["sub"] }).subcontractor, agreement: raw.agreement },
  };
}
