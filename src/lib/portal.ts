import "server-only";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import type { ClientView } from "@/lib/quotes";
import type { ReceiptItem } from "@/lib/receipts";
import { termsSchema, type ContractTermsConfig } from "@/lib/contracts/terms";
import type { InvoiceParty } from "@/lib/supabase/database.types";
import type { Brand } from "@/lib/supabase/database.types";
import { blobToDataUrl } from "@/lib/org";
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
  execution?: PortalExecution | null;
  addenda?: PortalAddendum[];
  /** Payments ("p<seq>") and addenda (AD- number) that have an official invoice from Qoyod. */
  invoices?: string[];
  receipts?: ReceiptItem[];
  invoiceDocs?: PortalInvoice[];
  terms?: ContractTermsConfig | null;
  warranty?: PortalWarranty | null;
  /** 2–3 options offered side by side; the client picks one while accepting (empty = single quote) */
  options?: PortalOption[];
};

export type PortalOption = { version: number; label: string; subtotal: number; vat: number; total: number; date: string; notes: string | null; client_view: ClientView };

export type PortalInvoice = {
  id: string; number: string; kind: "tax" | "simple"; issue_date: string; due_date: string; description: string; seller: InvoiceParty; buyer: InvoiceParty;
  subtotal: number; vat_percent: number; vat: number; total: number; paid: number; official: string; has_official: boolean; created_at?: string;
};

export type PortalMaintenance = {
  id: string; number: string; body: string; photos: string[]; status: "open" | "in_progress" | "resolved" | "closed" | "rejected";
  reply: string | null; created_at: string; resolved_at: string | null; client_confirmed_at: string | null;
};
/** Warranty after the final handover, and the client's maintenance requests (photos as 10-minute signed URLs). */
export type PortalWarranty = { handover_at: string | null; warranty_end: string | null; active: boolean; requests: PortalMaintenance[] };

export type PortalAddendum = {
  id: string; number: string; title: string; description: string; amount: number; vat_percent: number; vat: number; total: number; extra_days: number;
  status: "sent" | "accepted"; payment_status: string; accepted_at: string | null; accepted_name: string | null;
};

export type PortalStage = {
  id: string; seq: number; name: string; status: "pending" | "in_progress" | "awaiting_client" | "confirmed"; progress: number; is_final: boolean;
  report: string | null; sent_at: string | null; confirmed_at: string | null; confirmed_name: string | null; photos: string[];
};
export type PortalNote = { id: string; body: string; photos: string[]; status: string; reply: string | null; stage_id: string | null; created_at: string };
/** Stages, notes and short-lived photo URLs (paths are replaced by signed URLs before reaching the page). */
export type PortalExecution = { stages: PortalStage[]; notes: PortalNote[] };

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
  // the approved SVG logo when stored (organization found through the token-checked link)
  const { data: link } = await admin.rpc("portal_warranty", { p_number: number, p_token: token });
  const orgId = (link as { org_id?: string } | null)?.org_id;
  if (orgId) {
    const { data: o } = await admin.from("organizations").select("logo_svg").eq("id", orgId).maybeSingle();
    if (o?.logo_svg) logoUrl = `data:image/svg+xml;base64,${Buffer.from(o.logo_svg, "utf8").toString("base64")}`;
  }
  if (!logoUrl && d.org.logo_path) {
    // embedded (same origin) so the page can colour it with a CSS mask; signed URL only for large files
    const { data: file } = await admin.storage.from("org-assets").download(d.org.logo_path);
    logoUrl = await blobToDataUrl(file);
    if (!logoUrl) {
      const { data: s } = await admin.storage.from("org-assets").createSignedUrl(d.org.logo_path, 600);
      logoUrl = s?.signedUrl ?? null;
    }
  }
  // execution: stages, the client's notes, and 10-minute signed photo URLs (this contract's files only)
  let execution: PortalExecution | null = null;
  if (d.contract.status === "accepted") {
    const { data: ex } = await admin.rpc("portal_execution", { p_number: number, p_token: token });
    const e = ex as unknown as (PortalExecution & { org_id: string; contract_id: string }) | null;
    if (e) {
      const prefix = `${e.org_id}/${e.contract_id}/`;
      const paths = [...new Set([...e.stages.flatMap((x) => x.photos), ...e.notes.flatMap((x) => x.photos)])].filter((p) => p.startsWith(prefix));
      const { data: signed } = paths.length ? await admin.storage.from("project-photos").createSignedUrls(paths, 600) : { data: [] };
      const url = new Map((signed ?? []).map((x) => [x.path, x.signedUrl]));
      const sign = (list: string[]) => list.map((p) => url.get(p)).filter((u): u is string => !!u);
      execution = {
        stages: e.stages.map((x) => ({ ...x, photos: sign(x.photos) })),
        notes: e.notes.map((x) => ({ ...x, photos: sign(x.photos) })),
      };
    }
  }
  let addenda: PortalAddendum[] = [];
  if (d.contract.status === "accepted") {
    const { data: ad } = await admin.rpc("portal_addenda", { p_number: number, p_token: token });
    addenda = ((ad as unknown as PortalAddendum[] | null) ?? []).map((a) => ({ ...a, amount: Number(a.amount), vat: Number(a.vat), total: Number(a.total) }));
  }
  let invoices: string[] = [];
  if (d.contract.status === "accepted") {
    const { data: inv } = await admin.rpc("portal_invoices", { p_number: number, p_token: token });
    invoices = ((inv as { items?: { key: string }[] } | null)?.items ?? []).map((x) => x.key);
  }
  let receipts: ReceiptItem[] = [];
  if (d.contract.status === "accepted") {
    const { data: rv } = await admin.rpc("portal_receipts", { p_number: number, p_token: token });
    receipts = ((rv as ReceiptItem[] | null) ?? []).map((r) => ({ ...r, amount: Number(r.amount) }));
  }
  let options: PortalOption[] = [];
  if (d.contract.status === "sent" || d.contract.status === "draft") {
    const { data: op } = await admin.rpc("portal_options", { p_number: number, p_token: token });
    options = ((op as PortalOption[] | null) ?? []).map((o) => ({ ...o, subtotal: Number(o.subtotal), vat: Number(o.vat), total: Number(o.total) }));
  }
  const { data: rawTerms } = await admin.rpc("portal_contract_terms", { p_number: number, p_token: token });
  const parsedTerms = termsSchema.safeParse(rawTerms ?? {});
  const terms = parsedTerms.success ? parsedTerms.data : null;
  let invoiceDocs: PortalInvoice[] = [];
  if (d.contract.status === "accepted") {
    const { data: inv } = await admin.rpc("portal_invoice_docs", { p_number: number, p_token: token });
    invoiceDocs = ((inv as PortalInvoice[] | null) ?? []).map((i) => ({ ...i, subtotal: Number(i.subtotal), vat_percent: Number(i.vat_percent), vat: Number(i.vat), total: Number(i.total), paid: Number(i.paid) }));
  }
  let warranty: PortalWarranty | null = null;
  if (d.contract.status === "accepted") {
    const { data: w } = await admin.rpc("portal_warranty", { p_number: number, p_token: token });
    const x = w as unknown as (PortalWarranty & { org_id: string; contract_id: string }) | null;
    if (x?.handover_at) {
      const prefix = `${x.org_id}/${x.contract_id}/`;
      const paths = [...new Set(x.requests.flatMap((r) => r.photos))].filter((p) => p.startsWith(prefix));
      const { data: signed } = paths.length ? await admin.storage.from("project-photos").createSignedUrls(paths, 600) : { data: [] };
      const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
      warranty = {
        handover_at: x.handover_at, warranty_end: x.warranty_end, active: x.active,
        requests: x.requests.map((r) => ({ ...r, photos: r.photos.map((p) => url.get(p)).filter((u): u is string => !!u) })),
      };
    }
  }
  return { data: { ...d, options, execution, addenda, invoices, receipts, warranty, invoiceDocs, terms, contract: { ...d.contract, total: Number(d.contract.total) }, payments: d.payments.map((p) => ({ ...p, percent: Number(p.percent), amount: Number(p.amount) })) }, logoUrl, limited: false };
}
