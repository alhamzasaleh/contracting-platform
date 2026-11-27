import type { Measurement } from "@/lib/measurements";
import type { CreditNoteDoc } from "@/lib/credit-notes";
import "server-only";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import type { ClientView } from "@/lib/quotes";
import type { ReceiptItem } from "@/lib/receipts";
import { termsSchema, type ContractTermsConfig } from "@/lib/contracts/terms";
import type { InvoiceParty } from "@/lib/supabase/database.types";
import type { Brand } from "@/lib/supabase/database.types";
import { blobToDataUrl } from "@/lib/org";
import { createAdminClient } from "@/lib/supabase/admin";
import { TOKEN_RE } from "@/lib/portal-token";
import type { QuoteDecision } from "@/lib/portal-flow";
import type { QuoteStatus } from "@/lib/supabase/database.types";

/**
 * The public client page. Reads go through the server only: rate limited
 * per IP, then the database checks the token by its hash, expiry and
 * revocation (public.portal_view, service role only).
 */
export type PortalData = {
  org: { name: string; legal_name: string | null; cr_number: string | null; vat_number: string | null; phone: string | null; city: string | null; address: string | null; signatory_name: string | null; signatory_title: string | null; logo_path: string | null; brand: Brand };
  client: { name: string; phone: string | null; city: string | null; district: string | null; id_number: string | null; site_own?: boolean; site_city?: string | null; site_district?: string | null };
  contract: {
    number: string; status: "draft" | "sent" | "accepted" | "cancelled"; service: "gypsum" | "interior" | "exterior"; project_type: "full" | "labour" | "supply";
    start_date: string; duration_days: number; warranty_months: number; total: number; notes: string | null; accepted_at: string | null; accepted_name: string | null; created_at: string;
  };
  /** client_accepted_at: the client accepted the quote on his page before the contract (one link for every stage) */
  quote: { number: string; version: number; date: string; valid_until: string | null; client_view: ClientView; notes: string | null; client_accepted_at?: string | null };
  /** kind measurement = «تسوية الأمتار» (0 %); adjust = what measurement sheets took off this payment (≤ 0) */
  payments: { seq: number; label: string; percent: number; amount: number; due_event: string; status: string; kind?: "schedule" | "measurement"; adjust?: number }[];
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
  /** measurement sheets sent to the client (sign / comment), photos as 10-minute signed URLs */
  measurements?: PortalMeasurement[];
  /** credit notes (a signed measurement reduced what was invoiced) */
  creditNotes?: CreditNoteDoc[];
};

export type PortalMeasurement = Omit<Measurement, "photos"> & { photos: string[]; client_signature?: string | null };

/**
 * The quote stage of the same link (issued from the quote, before a contract — or while the
 * contract made from it is still being prepared). The document shows only an issued offer.
 */
export type PortalQuoteData = {
  stage: "quote";
  org: PortalData["org"];
  client: PortalData["client"];
  quote: {
    /** version / date / total / document: only for an issued (or answered) offer */
    number: string; status: QuoteStatus; service: "gypsum" | "interior" | "exterior"; version: number | null; date: string | null; valid_until: string | null;
    total: number | null; client_view: ClientView | null; notes: string | null; warranty_months: number;
    decision: QuoteDecision | null; decided_at: string | null; decided_name: string | null; decision_note: string | null; chosen_version: number | null;
  };
  options: PortalOption[];
  /** a contract made from the quote, still being prepared (draft) */
  contract: { number: string; status: string } | null;
  expires_at: string;
};

export type PortalOption = { version: number; label: string; subtotal: number; vat: number; total: number; date: string; notes: string | null; client_view: ClientView };

export type PortalInvoice = {
  id: string; number: string; kind: "tax" | "simple"; issue_date: string; due_date: string; description: string; seller: InvoiceParty; buyer: InvoiceParty;
  subtotal: number; vat_percent: number; vat: number; total: number; paid: number; official: string; has_official: boolean; created_at?: string;
  /** credit notes against it */
  credited?: number;
};

export type PortalMaintenance = {
  id: string; number: string; body: string; photos: string[]; status: "open" | "in_progress" | "resolved" | "closed" | "rejected";
  reply: string | null; created_at: string; resolved_at: string | null; client_confirmed_at: string | null;
  /** when it was closed / rejected; closed_by_staff = a staff member closed / rejected it (closed_by set), not the client's confirmation */
  closed_at?: string | null; closed_by_staff?: boolean;
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

export { TOKEN_RE };
export const NUMBER_RE = /^[A-Z]{1,3}-\d{4}-\d{3,6}$/;

type Loaded = { data: PortalData | null; logoUrl: string | null; limited: boolean; unavailable?: boolean; quoteStage?: PortalQuoteData | null };

/** The company logo for the page: the approved SVG when stored, else the uploaded file (org found through the token-checked link). */
export async function portalLogo(admin: ReturnType<typeof createAdminClient>, orgId: string | null | undefined, logoPath: string | null): Promise<string | null> {
  if (orgId) {
    const { data: o } = await admin.from("organizations").select("logo_svg").eq("id", orgId).maybeSingle();
    if (o?.logo_svg) return `data:image/svg+xml;base64,${Buffer.from(o.logo_svg, "utf8").toString("base64")}`;
  }
  if (!logoPath) return null;
  // embedded (same origin) so the page can colour it with a CSS mask; signed URL only for large files
  const { data: file } = await admin.storage.from("org-assets").download(logoPath);
  const inline = await blobToDataUrl(file);
  if (inline) return inline;
  const { data: su } = await admin.storage.from("org-assets").createSignedUrl(logoPath, 600);
  return su?.signedUrl ?? null;
}

/** Numbers from the database come as strings in JSON: the quote stage's amounts as numbers. */
export function normalizeQuoteStage(q: PortalQuoteData): PortalQuoteData {
  return {
    ...q,
    quote: { ...q.quote, total: q.quote.total == null ? null : Number(q.quote.total) },
    options: (q.options ?? []).map((o) => ({ ...o, subtotal: Number(o.subtotal), vat: Number(o.vat), total: Number(o.total) })),
  };
}

export async function loadPortal(number: string, token: string): Promise<Loaded> {
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
  const raw = data as unknown as (PortalData & { stage?: "contract" }) | PortalQuoteData | null;
  if (!raw) return { data: null, logoUrl: null, limited: false };
  if (raw.stage === "quote") {
    // the quote stage: the org is found through the same token-checked link (portal_warranty → org_id)
    const { data: w } = await admin.rpc("portal_warranty", { p_number: number, p_token: token });
    const orgId = (w as unknown as { org_id?: string } | null)?.org_id;
    return { data: null, quoteStage: normalizeQuoteStage(raw), logoUrl: await portalLogo(admin, orgId, raw.org.logo_path), limited: false };
  }
  const d = raw;
  // Everything below needs only the token-checked view: one parallel round, each part chained only
  // where it needs another's answer (the warranty call is shared: logo + warranty section).
  const accepted = d.contract.status === "accepted";
  type PortalFn = "portal_credit_notes" | "portal_measurements" | "portal_warranty" | "portal_execution" | "portal_addenda" | "portal_invoices" | "portal_receipts" | "portal_options" | "portal_contract_terms" | "portal_invoice_docs";
  const call = async <T,>(fn: PortalFn): Promise<T | null> => {
    const { data: x } = await admin.rpc(fn, { p_number: number, p_token: token });
    return x as unknown as T | null;
  };
  const warrantyP = call<PortalWarranty & { org_id?: string; contract_id: string }>("portal_warranty");
  const [logoUrl, execution, addenda, invoices, receipts, options, rawTerms, invoiceDocs, warranty, measurements, creditNotes] = await Promise.all([
    warrantyP.then((w) => portalLogo(admin, w?.org_id, d.org.logo_path)),
    // execution: stages, the client's notes, and 10-minute signed photo URLs (this contract's files only)
    (async (): Promise<PortalExecution | null> => {
      if (!accepted) return null;
      const e = await call<PortalExecution & { org_id: string; contract_id: string }>("portal_execution");
      if (!e) return null;
      const prefix = `${e.org_id}/${e.contract_id}/`;
      const paths = [...new Set([...e.stages.flatMap((x) => x.photos), ...e.notes.flatMap((x) => x.photos)])].filter((p) => p.startsWith(prefix));
      const { data: signed } = paths.length ? await admin.storage.from("project-photos").createSignedUrls(paths, 600) : { data: [] };
      const url = new Map((signed ?? []).map((x) => [x.path, x.signedUrl]));
      const sign = (list: string[]) => list.map((p) => url.get(p)).filter((u): u is string => !!u);
      return {
        stages: e.stages.map((x) => ({ ...x, photos: sign(x.photos) })),
        notes: e.notes.map((x) => ({ ...x, photos: sign(x.photos) })),
      };
    })(),
    accepted
      ? call<PortalAddendum[]>("portal_addenda").then((ad) => (ad ?? []).map((a) => ({ ...a, amount: Number(a.amount), vat: Number(a.vat), total: Number(a.total) })))
      : Promise.resolve([] as PortalAddendum[]),
    accepted ? call<{ items?: { key: string }[] }>("portal_invoices").then((inv) => (inv?.items ?? []).map((x) => x.key)) : Promise.resolve([] as string[]),
    accepted ? call<ReceiptItem[]>("portal_receipts").then((rv) => (rv ?? []).map((r) => ({ ...r, amount: Number(r.amount) }))) : Promise.resolve([] as ReceiptItem[]),
    d.contract.status === "sent" || d.contract.status === "draft"
      ? call<PortalOption[]>("portal_options").then((op) => (op ?? []).map((o) => ({ ...o, subtotal: Number(o.subtotal), vat: Number(o.vat), total: Number(o.total) })))
      : Promise.resolve([] as PortalOption[]),
    call<unknown>("portal_contract_terms"),
    accepted
      ? call<PortalInvoice[]>("portal_invoice_docs").then((inv) => (inv ?? []).map((i) => ({ ...i, subtotal: Number(i.subtotal), vat_percent: Number(i.vat_percent), vat: Number(i.vat), total: Number(i.total), paid: Number(i.paid) })))
      : Promise.resolve([] as PortalInvoice[]),
    (async (): Promise<PortalWarranty | null> => {
      if (!accepted) return null;
      const x = (await warrantyP) as (PortalWarranty & { org_id: string; contract_id: string }) | null;
      if (!x?.handover_at) return null;
      const prefix = `${x.org_id}/${x.contract_id}/`;
      const paths = [...new Set(x.requests.flatMap((r) => r.photos))].filter((p) => p.startsWith(prefix));
      const { data: signed } = paths.length ? await admin.storage.from("project-photos").createSignedUrls(paths, 600) : { data: [] };
      const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
      return {
        handover_at: x.handover_at, warranty_end: x.warranty_end, active: x.active,
        requests: x.requests.map((r) => ({ ...r, photos: r.photos.map((p) => url.get(p)).filter((u): u is string => !!u) })),
      };
    })(),
    (async (): Promise<PortalMeasurement[]> => {
      if (!accepted) return [];
      const list = (await call<(Omit<PortalMeasurement, "photos"> & { photos: string[] })[]>("portal_measurements")) ?? [];
      if (!list.length) return [];
      // photos of this contract's sheets only (<org>/<contract>/measure/…), signed for 10 minutes
      const paths = [...new Set(list.flatMap((m) => m.photos))].filter((p) => /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/measure\/[0-9a-f-]{36}\.jpg$/.test(p));
      const { data: signed } = paths.length ? await admin.storage.from("project-photos").createSignedUrls(paths, 600) : { data: [] };
      const url = new Map((signed ?? []).map((x) => [x.path, x.signedUrl]));
      return list.map((m) => ({
        ...m,
        lines: m.lines.map((l) => ({ ...l, agreed_area: Number(l.agreed_area), measured_area: Number(l.measured_area), price_per_m2: Number(l.price_per_m2), diff_area: Number(l.diff_area), diff_amount: Number(l.diff_amount) })),
        diff_subtotal: Number(m.diff_subtotal), diff_vat: Number(m.diff_vat), diff_total: Number(m.diff_total), credit_amount: Number(m.credit_amount),
        photos: m.photos.map((p) => url.get(p)).filter((u): u is string => !!u),
      }));
    })(),
    accepted
      ? call<CreditNoteDoc[]>("portal_credit_notes").then((cn) =>
          (cn ?? []).map((c) => ({ ...c, subtotal: Number(c.subtotal), vat_percent: Number(c.vat_percent), vat: Number(c.vat), total: Number(c.total), contract: d.contract.number })),
        )
      : Promise.resolve([] as CreditNoteDoc[]),
  ]);
  // an invoice's remaining part excludes what credit notes took off it
  const creditedOn = new Map<string, number>();
  for (const c of creditNotes) creditedOn.set(c.invoice, (creditedOn.get(c.invoice) ?? 0) + c.total);
  const parsedTerms = termsSchema.safeParse(rawTerms ?? {});
  const terms = parsedTerms.success ? parsedTerms.data : null;
  return { data: { ...d, options, execution, addenda, measurements, creditNotes, invoices, receipts, warranty, invoiceDocs: invoiceDocs.map((i) => ({ ...i, credited: creditedOn.get(i.number) ?? 0 })), terms, contract: { ...d.contract, total: Number(d.contract.total) }, payments: d.payments.map((p) => ({ ...p, percent: Number(p.percent), amount: Number(p.amount), adjust: Number(p.adjust ?? 0) })) }, logoUrl, limited: false };
}
