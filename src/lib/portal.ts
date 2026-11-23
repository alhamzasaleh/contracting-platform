import "server-only";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import type { ClientView } from "@/lib/quotes";
import type { Brand } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The public client page. Reads go through the server only: rate limited
 * per IP, then the database checks the token by its hash, expiry and
 * revocation (public.portal_view, service role only).
 */
export type PortalData = {
  org: { name: string; legal_name: string | null; cr_number: string | null; vat_number: string | null; phone: string | null; city: string | null; address: string | null; signatory_name: string | null; signatory_title: string | null; logo_path: string | null; brand: Brand };
  client: { name: string; phone: string | null; city: string | null; district: string | null; id_number: string | null };
  contract: {
    number: string; status: "draft" | "sent" | "accepted" | "cancelled"; service: "gypsum" | "interior" | "exterior"; project_type: "full" | "labour" | "supply";
    start_date: string; duration_days: number; warranty_months: number; total: number; notes: string | null; accepted_at: string | null; accepted_name: string | null; created_at: string;
  };
  quote: { number: string; version: number; date: string; valid_until: string | null; client_view: ClientView; notes: string | null };
  payments: { seq: number; label: string; percent: number; amount: number; due_event: string; status: string }[];
  expires_at: string;
};

export const TOKEN_RE = /^[A-Za-z0-9_-]{32,100}$/;
export const NUMBER_RE = /^[A-Z]{1,3}-\d{4}-\d{3,6}$/;

export async function loadPortal(number: string, token: string): Promise<{ data: PortalData | null; logoUrl: string | null; limited: boolean; unavailable?: boolean }> {
  if (!NUMBER_RE.test(number) || !TOKEN_RE.test(token)) return { data: null, logoUrl: null, limited: false };
  const ip = await clientIp();
  const rl = await rateLimit(`portal:view:${ip}`, 60, 60);
  if (rl === "limited") return { data: null, logoUrl: null, limited: true };
  // can't check the limit (database unreachable) → refuse, never let it through
  if (rl !== "ok") return { data: null, logoUrl: null, limited: false, unavailable: true };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("portal_view", { p_number: number, p_token: token });
  if (error) {
    console.error("[portal] view failed", { code: error.code });
    return { data: null, logoUrl: null, limited: false };
  }
  const d = data as unknown as PortalData | null;
  if (!d) return { data: null, logoUrl: null, limited: false };
  let logoUrl: string | null = null;
  if (d.org.logo_path) {
    const { data: s } = await admin.storage.from("org-assets").createSignedUrl(d.org.logo_path, 600);
    logoUrl = s?.signedUrl ?? null;
  }
  return { data: { ...d, contract: { ...d.contract, total: Number(d.contract.total) }, payments: d.payments.map((p) => ({ ...p, percent: Number(p.percent), amount: Number(p.amount) })) }, logoUrl, limited: false };
}
