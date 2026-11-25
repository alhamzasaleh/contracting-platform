import "server-only";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import type { Brand } from "@/lib/supabase/database.types";
import type { CommissionStatus } from "@/lib/marketers";
import { MARKETER_NUMBER_RE } from "@/lib/marketers";
import { portalLogo } from "@/lib/portal";
import { TOKEN_RE } from "@/lib/portal-token";
import type { PaymentVoucherDoc } from "@/lib/data/marketers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The success partner's own page (/m/<MK-…>/<token>). Read by the server only: rate limited per IP,
 * then the database checks the token by its hash, expiry, revocation and that the partner is active
 * (public.marketer_portal_view, service role only). It holds no costs, margins, client phones or IDs.
 */
export type MarketerPortalItem = {
  client: string; contract: string; date: string; contract_status: "draft" | "sent" | "accepted" | "cancelled"; handed_over: boolean;
  base: number; percent: number; amount: number; status: CommissionStatus; due_at: string | null; paid_at: string | null;
  vouchers: { number: string; paid_on: string; amount: number; method: string }[];
};
export type MarketerPortalData = {
  org: { name: string; legal_name: string | null; phone: string | null; brand: Brand };
  marketer: { number: string; name: string; commission_percent: number };
  expires_at: string;
  items: MarketerPortalItem[];
};

type Loaded = { data: MarketerPortalData | null; logoUrl: string | null; limited: boolean; unavailable?: boolean };

export async function loadMarketerPortal(number: string, token: string): Promise<Loaded> {
  if (!MARKETER_NUMBER_RE.test(number) || !TOKEN_RE.test(token)) return { data: null, logoUrl: null, limited: false };
  const rl = await rateLimit(`marketer:view:${await clientIp()}`, 30, 60);
  if (rl === "limited") return { data: null, logoUrl: null, limited: true };
  // can't check the limit (database unreachable) → refuse, never let it through
  if (rl !== "ok") return { data: null, logoUrl: null, limited: false, unavailable: true };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("marketer_portal_view", { p_number: number, p_token: token });
  if (error) {
    // never log the message (it may contain the token)
    console.error("[marketer-portal] view failed", { code: error.code });
    return { data: null, logoUrl: null, limited: false };
  }
  const raw = data as unknown as (MarketerPortalData & { org: { id: string; logo_path: string | null } }) | null;
  if (!raw) return { data: null, logoUrl: null, limited: false };
  const n = (v: unknown) => Number(v ?? 0);
  const logoUrl = await portalLogo(admin, raw.org.id, raw.org.logo_path);
  return {
    logoUrl,
    limited: false,
    data: {
      org: { name: raw.org.name, legal_name: raw.org.legal_name, phone: raw.org.phone, brand: raw.org.brand },
      marketer: { ...raw.marketer, commission_percent: n(raw.marketer.commission_percent) },
      expires_at: raw.expires_at,
      items: (raw.items ?? []).map((i) => ({ ...i, base: n(i.base), percent: n(i.percent), amount: n(i.amount), vouchers: (i.vouchers ?? []).map((v) => ({ ...v, amount: n(v.amount) })) })),
    },
  };
}

export const VOUCHER_RE = /^PV-\d{4}-\d{3,6}$/;

/** One of the partner's own payment vouchers (print / PDF): the same token checks and per-IP limit as his page. */
export async function loadMarketerVoucher(number: string, token: string, voucher: string): Promise<{ doc: PaymentVoucherDoc | null; brand: Brand | null }> {
  if (!MARKETER_NUMBER_RE.test(number) || !TOKEN_RE.test(token) || !VOUCHER_RE.test(voucher)) return { doc: null, brand: null };
  if ((await rateLimit(`marketer:view:${await clientIp()}`, 30, 60)) !== "ok") return { doc: null, brand: null };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("marketer_portal_voucher", { p_number: number, p_token: token, p_voucher: voucher });
  if (error) {
    console.error("[marketer-portal] voucher failed", { code: error.code });
    return { doc: null, brand: null };
  }
  const raw = data as unknown as (Omit<PaymentVoucherDoc, "org"> & { org: PaymentVoucherDoc["org"] & { id: string; logo_path: string | null; brand: Brand } }) | null;
  if (!raw) return { doc: null, brand: null };
  const n = (v: unknown) => Number(v ?? 0);
  const { id, logo_path, brand, ...org } = raw.org;
  return {
    brand,
    doc: {
      org: { ...org, logoUrl: await portalLogo(admin, id, logo_path) },
      voucher: { ...raw.voucher, amount: n(raw.voucher.amount) },
      marketer: raw.marketer,
      contract: { ...raw.contract, base: n(raw.contract.base), percent: n(raw.contract.percent) },
    },
  };
}
