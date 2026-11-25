"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { publicEnv } from "@/env";
import { hashPortalToken, newPortalToken } from "@/lib/portal-token";
import { z } from "zod";
import type { ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import { loadPricingSettings } from "@/lib/data/catalogue";
import { loadPricingContext } from "@/lib/data/pricing";
import { priceSelection, type Selection } from "@/lib/pricing";
import { selectionSchema } from "@/lib/pricing/schema";
import { buildSnapshot, issueBlockers, readiness } from "@/lib/quotes";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { surveyGaps, surveyQuantities, type SurveyRoom, type SurveyTotals } from "@/lib/survey";
import type { Json } from "@/lib/supabase/database.types";
import { deleteError } from "@/lib/deletion";
import { loadMarketerChoices } from "@/lib/data/marketers";
import { partnerCheck } from "@/lib/marketers";

const id = z.uuid();
const n = (v: unknown) => Number(v ?? 0);

function fail(error: { code?: string; message?: string } | null, what: string): ActionResult<never> {
  console.error(`[quotes] ${what} failed`, { code: error?.code });
  if (error?.code === "42501") return { ok: false, error: /accepted quote/.test(error.message ?? "") ? "quoteLocked" : "noAccess" };
  if (error?.code === "22023" && /sent to the client/.test(error.message ?? "")) return { ok: false, error: "quoteContractSent" };
  if (error?.code === "22023" && /client accepted this quote/.test(error.message ?? "")) return { ok: false, error: "quoteClientAccepted" };
  if (error?.code === "22023" && /commission changed/.test(error.message ?? "")) return { ok: false, error: "rewardChanged" };
  if (error?.code === "22023" && /marketer inactive/.test(error.message ?? "")) return { ok: false, error: "partnerInactive" };
  return { ok: false, error: "error" };
}

/** A contract made from the quote (draft or sent to the client) freezes it (the database refuses too). */
async function contractSent(supabase: Awaited<ReturnType<typeof createClient>>, quoteId: string): Promise<boolean> {
  const { data } = await supabase.from("contracts").select("id").eq("quote_id", quoteId).in("status", ["draft", "sent"]).limit(1);
  return !!data?.length;
}

/** Quantities always come from the survey on the server — never from the browser. */
async function quantitiesFor(supabase: Awaited<ReturnType<typeof createClient>>, surveyId: string, kind: Selection["kind"]) {
  const [{ data: survey }, { data: rooms }] = await Promise.all([
    supabase.from("surveys").select("id, mode, totals, client_id").eq("id", surveyId).maybeSingle(),
    supabase.from("survey_rooms").select("*").eq("survey_id", surveyId).order("sort_order"),
  ]);
  if (!survey) return null;
  const list: SurveyRoom[] = (rooms ?? []).map((r) => ({
    id: r.id, name: r.name, unit_label: r.unit_label, length_m: n(r.length_m), width_m: n(r.width_m), height_m: n(r.height_m),
    openings_m2: n(r.openings_m2), gypsum_ceiling: r.gypsum_ceiling, ceiling_board: r.ceiling_board, paint_walls: r.paint_walls,
    paint_ceiling: r.paint_ceiling, wall_zone: r.wall_zone,
  }));
  const q = surveyQuantities(kind, survey.mode, list, (survey.totals ?? {}) as SurveyTotals);
  return { survey, q, gaps: surveyGaps(kind, q), estimated: survey.mode === "total" };
}

/** The versions the client is offered: the options, or just the current version. */
function offered(q: { current_version: number; options?: { version: number }[] | null }): number[] {
  return q.options?.length ? q.options.map((o) => o.version) : [q.current_version];
}

const saveSchema = z
  .object({
    quote_id: id.nullable(),
    survey_id: id,
    selection: selectionSchema,
    discount_percent: z.number().min(0).max(100),
    method: z.enum(["unit", "lump"]),
    notes: z.string().trim().max(4000).nullable(),
    /** the success partner on this quote (default: the client's; null = none) */
    marketer_id: id.nullable().optional(),
    /** the reward % the editor showed — must still be the partner's current one */
    commission_percent: z.number().min(0).max(50).optional(),
  })
  .strict();

/**
 * Saves a quote version: recomputes the price from the survey and the chosen
 * steps, freezes it, and asks the owner's approval when the margin is below
 * the minimum or there is a discount.
 */
export async function saveQuoteVersion(input: unknown): Promise<ActionResult<{ number: string; status: string }>> {
  const session = await getSession();
  if (!can(session, "quotes.manage") || !can(session, "costs.view")) return { ok: false, error: "noAccess" };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const orgId = session.organization.id;
  const supabase = await createClient();

  const src = await quantitiesFor(supabase, v.survey_id, v.selection.kind);
  if (!src) return { ok: false, error: "invalid" };
  const [{ ctx }, settings, partners] = await Promise.all([
    loadPricingContext(session),
    loadPricingSettings(session),
    v.marketer_id ? loadMarketerChoices(supabase, orgId) : Promise.resolve([]),
  ]);
  // the partner's CURRENT reward % prices this version (the database re-checks it and freezes it)
  const partner = v.marketer_id ? partners.find((m) => m.id === v.marketer_id) : null;
  // the price on the screen was built with this %; a change in between → re-open the editor
  const refused = partnerCheck(partner, !!v.marketer_id, v.commission_percent);
  if (refused) return { ok: false, error: refused };
  const commissionPercent = partner?.commission_percent ?? 0;
  const sel = v.selection as Selection;
  const outcome = priceSelection(sel, src.q, ctx, { commissionPercent });
  const snap = buildSnapshot(sel, src.q, outcome, { discountPercent: v.discount_percent, method: v.method, estimated: src.estimated, vatPercent: ctx.vatPercent, catalogue: ctx.catalogue, commissionPercent });
  const check = readiness(outcome, snap, n(settings?.min_margin_percent ?? 20), src.gaps);

  // The quote (new, or an existing one getting a new version)
  let quoteId = v.quote_id;
  let number: string;
  if (quoteId) {
    const { data: existing } = await supabase.from("quotes").select("id, number, service, survey_id, status, client_decision").eq("id", quoteId).eq("organization_id", orgId).maybeSingle();
    if (!existing || existing.service !== sel.kind || existing.survey_id !== v.survey_id) return { ok: false, error: "invalid" };
    if (existing.status === "accepted") return { ok: false, error: "quoteLocked" };
    // what the client accepted on his page stays (the database refuses too)
    if (existing.client_decision === "accepted") return { ok: false, error: "quoteClientAccepted" };
    if (await contractSent(supabase, existing.id)) return { ok: false, error: "quoteContractSent" };
    number = existing.number;
  } else {
    const { data: created, error } = await supabase
      .from("quotes")
      .insert({ organization_id: orgId, client_id: src.survey.client_id, survey_id: v.survey_id, service: sel.kind })
      .select("id, number")
      .single();
    if (error) return fail(error, "create");
    quoteId = created.id;
    number = created.number;
  }

  // The version and its costs are written by the database for this user (save_quote_version,
  // service role only): users can't insert versions themselves, so nobody can freeze a price or
  // margin that wasn't computed here.
  const cv = snap.clientView;
  const { data: saved, error: e1 } = await createAdminClient().rpc("save_quote_version", {
    p_user: session.userId,
    p_quote: quoteId,
    p_payload: {
      version: {
        selection: sel as unknown as Json, quantities: src.q as unknown as Json, client_view: cv as unknown as Json,
        pricing_method: v.method, estimated: src.estimated, discount: cv.discount, subtotal: cv.subtotal,
        vat_percent: cv.vatPercent, vat: cv.vat, total: cv.total, notes: v.notes,
        // server-recomputed unpriced items: the database refuses to issue a version that has any
        problems: outcome.problems.length,
      },
      costs: {
        cost: snap.cost, cost_with_contingency: snap.costWithContingency, margin_percent: snap.marginPercent,
        lines: snap.lines as unknown as Json, purchase_list: snap.purchaseList as unknown as Json,
        marketer_id: partner?.id ?? null, commission_percent: commissionPercent,
      },
    } as Json,
  });
  const version = saved?.[0];
  if (e1 || !version) return fail(e1, "version");

  // Approvals for this version (older pending ones are superseded by the database when the version is saved)
  for (const kind of check.approvals) {
    const { error } = await supabase.from("approvals").insert({
      organization_id: orgId, kind, entity: "quote", entity_id: quoteId,
      details: { version: version.version, number, margin: snap.marginPercent, minMargin: n(settings?.min_margin_percent ?? 20), discount: cv.discount, discountPercent: cv.discountPercent } as Json,
    });
    if (error) return fail(error, "approval");
  }
  const status = check.approvals.length ? "pending_approval" : "draft";
  await supabase.from("quotes").update({ status }).eq("id", quoteId);
  revalidatePath("/quotations", "layout");
  revalidatePath("/clients", "layout");
  return { ok: true, data: { number, status } };
}

/** Issue the current version to the client (only when ready and approved). */
export async function issueQuote(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "quotes.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data: quote } = await supabase.from("quotes").select("id, status, current_version, survey_id, service, options").eq("id", parsed.data.id).maybeSingle();
  if (!quote || quote.current_version === 0) return { ok: false, error: "invalid" };
  if (quote.status === "accepted") return { ok: false, error: "quoteLocked" };
  const versions = offered(quote);
  // Only approvals for the offered version(s) count (older versions are superseded).
  const { data: open } = await supabase.from("approvals").select("status, details").eq("entity", "quote").eq("entity_id", quote.id).in("status", ["pending", "rejected"]);
  if ((open ?? []).some((a) => versions.includes(Number((a.details as { version?: number } | null)?.version)))) return { ok: false, error: "needsApproval" };
  // Re-check readiness on every frozen version offered
  const { data: rows } = await supabase.from("quote_versions").select("version, selection, quantities").eq("quote_id", quote.id).in("version", versions);
  if ((rows ?? []).length !== versions.length) return { ok: false, error: "invalid" };
  const { ctx, canSeeCrewCost } = await loadPricingContext(session);
  for (const version of rows ?? []) {
    const sel = version.selection as unknown as Selection;
    const outcome = priceSelection(sel, version.quantities as never, ctx);
    if (issueBlockers(outcome.problems, sel, canSeeCrewCost).length) return { ok: false, error: "notReady" };
  }
  const days = Number(ctx.catalogue.rates["commercial.quoteValidityDays"] ?? 7);
  const validUntil = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  // the database re-checks the approvals (open ones, and approved ones for a low margin / discount)
  const { error } = await supabase.rpc("issue_quote", { p_quote: quote.id, p_valid_until: validUntil });
  if (error) {
    if (/approval/.test(error.message ?? "")) return { ok: false, error: "needsApproval" };
    if (/unpriced/.test(error.message ?? "")) return { ok: false, error: "notReady" };
    return fail(error, "issue");
  }
  revalidatePath("/quotations", "layout");
  return { ok: true };
}

/** Owner decision on an approval request. */
export async function decideApproval(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "approvals.decide")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ id, decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(1000).nullable() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data: a, error } = await supabase
    .from("approvals")
    .update({ status: parsed.data.decision, decision_note: parsed.data.note })
    .eq("id", parsed.data.id)
    .eq("status", "pending")
    .select("entity_id")
    .single();
  if (error) return fail(error, "decide");
  // When nothing is left pending for the quote, it goes back to draft (rejected stays visible).
  const { data: q } = await supabase.from("quotes").select("current_version, options").eq("id", a.entity_id).maybeSingle();
  const { data: left } = await supabase.from("approvals").select("status, details").eq("entity", "quote").eq("entity_id", a.entity_id).in("status", ["pending", "rejected"]);
  const versions = q ? offered(q) : [];
  const open = (left ?? []).filter((x) => versions.includes(Number((x.details as { version?: number } | null)?.version)));
  // only a quote waiting for approval goes back to draft (never an issued or accepted one)
  if (!open.length) await supabase.from("quotes").update({ status: "draft" }).eq("id", a.entity_id).eq("status", "pending_approval");
  revalidatePath("/quotations", "layout");
  return { ok: true };
}

const optionsSchema = z
  .object({
    quote_id: id,
    options: z
      .array(z.object({ version: z.number().int().min(1), label: z.string().trim().min(1).max(60) }).strict())
      .min(2)
      .max(3)
      .refine((xs) => new Set(xs.map((x) => x.version)).size === xs.length)
      .nullable(),
  })
  .strict();

/**
 * Offer 2–3 of the quote's versions side by side (or go back to a single quote with null).
 * Each option keeps its own approvals: margin below the minimum or a discount → owner approval.
 * All options must be the same project type (it decides the contract's clauses).
 */
export async function setQuoteOptions(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "quotes.manage") || !can(session, "costs.view")) return { ok: false, error: "noAccess" };
  const parsed = optionsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { quote_id, options } = parsed.data;
  const orgId = session.organization.id;
  const supabase = await createClient();
  const { data: q } = await supabase.from("quotes").select("id, number, status, current_version").eq("id", quote_id).eq("organization_id", orgId).maybeSingle();
  if (!q) return { ok: false, error: "invalid" };
  if (q.status === "accepted") return { ok: false, error: "quoteLocked" };
  const { data: contract } = await supabase.from("contracts").select("id, status").eq("quote_id", q.id).neq("status", "cancelled").maybeSingle();
  if (contract) return { ok: false, error: contract.status === "sent" ? "quoteContractSent" : "quoteLocked" };

  const approvals: { kind: "quote_margin" | "quote_discount"; version: number; details: Record<string, unknown> }[] = [];
  if (options) {
    const { data: rows } = await supabase.from("quote_versions").select("id, version, selection, client_view").eq("quote_id", q.id).in("version", options.map((o) => o.version));
    if ((rows ?? []).length !== options.length) return { ok: false, error: "invalid" };
    const types = new Set((rows ?? []).map((r) => (r.selection as { options?: { projectType?: string } } | null)?.options?.projectType ?? "full"));
    if (types.size > 1) return { ok: false, error: "optionsMixedType" };
    const settings = await loadPricingSettings(session);
    const minMargin = n(settings?.min_margin_percent ?? 20);
    const { data: costs } = await supabase.from("quote_version_costs").select("quote_version_id, margin_percent").in("quote_version_id", (rows ?? []).map((r) => r.id));
    const margin = new Map((costs ?? []).map((c) => [c.quote_version_id, n(c.margin_percent)]));
    const { data: existing } = await supabase.from("approvals").select("kind, status, details").eq("entity", "quote").eq("entity_id", q.id).in("status", ["pending", "approved", "rejected"]);
    const has = (kind: string, version: number) => (existing ?? []).some((a) => a.kind === kind && Number((a.details as { version?: number } | null)?.version) === version);
    for (const r of rows ?? []) {
      const cv = (r.client_view ?? {}) as { discount?: number; discountPercent?: number };
      const m = margin.get(r.id) ?? 0;
      const details = { version: r.version, number: q.number, margin: m, minMargin, discount: n(cv.discount), discountPercent: n(cv.discountPercent) };
      if (m < minMargin && !has("quote_margin", r.version)) approvals.push({ kind: "quote_margin", version: r.version, details });
      if (n(cv.discount) > 0 && !has("quote_discount", r.version)) approvals.push({ kind: "quote_discount", version: r.version, details });
    }
  }
  const { error } = await supabase.from("quotes").update({ options: options ?? null }).eq("id", q.id);
  if (error) return fail(error, "options");
  for (const a of approvals) {
    const { error: e } = await supabase.from("approvals").insert({ organization_id: orgId, kind: a.kind, entity: "quote", entity_id: q.id, details: a.details as Json });
    if (e) return fail(e, "approval");
  }
  // the offer changed: issue again (after any approvals)
  const { data: left } = await supabase.from("approvals").select("status, details").eq("entity", "quote").eq("entity_id", q.id).eq("status", "pending");
  const versions = options ? options.map((o) => o.version) : [q.current_version];
  const waiting = (left ?? []).some((a) => versions.includes(Number((a.details as { version?: number } | null)?.version)));
  await supabase.from("quotes").update({ status: waiting ? "pending_approval" : "draft" }).eq("id", q.id);
  revalidatePath("/quotations", "layout");
  return { ok: true };
}

// --- The client page from the quote (one link for every stage; owner, Nov 2026) ---------------

/**
 * «إرسال للعميل»: a client-page link for an issued quote, shown ONCE (only its hash is stored);
 * the quote's earlier links are revoked. When a contract is made from the quote the same link
 * follows the contract (database trigger), so the client keeps one address.
 */
export async function sendQuote(input: unknown): Promise<ActionResult<{ url: string }>> {
  const session = await getSession();
  if (!can(session, "quotes.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data: q } = await supabase.from("quotes").select("id, number, status").eq("id", parsed.data.id).eq("organization_id", session.organization.id).maybeSingle();
  if (!q) return { ok: false, error: "invalid" };
  if (q.status !== "issued") return { ok: false, error: "quoteNotIssued" };
  const token = newPortalToken();
  const { error } = await supabase.rpc("issue_quote_link", { p_quote: q.id, p_token_hash: hashPortalToken(token) });
  if (error) {
    if (/contract exists/.test(error.message ?? "")) return { ok: false, error: "quoteHasContract" };
    if (/quote not issued/.test(error.message ?? "")) return { ok: false, error: "quoteNotIssued" };
    return fail(error, "link");
  }
  const h = await headers();
  const base = publicEnv().NEXT_PUBLIC_SITE_URL ?? `https://${h.get("host")}`;
  revalidatePath(`/quotations/${q.number}`);
  return { ok: true, data: { url: `${base}/p/${q.number}/${token}` } };
}

/** Revokes the quote's open client-page link (before a contract takes it over). */
export async function revokeQuoteLink(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "quotes.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_portal_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("quote_id", parsed.data.id)
    .eq("organization_id", session.organization.id)
    .is("contract_id", null)
    .is("revoked_at", null);
  if (error) return fail(error, "revoke");
  revalidatePath("/quotations", "layout");
  return { ok: true };
}

/**
 * Deletes a quote — the owner only (owner, Nov 2026). public.delete_quote checks the owner again and
 * refuses a quote with any contract or accepted by the client on his page; it removes the versions,
 * approvals and the client-page link, all audited.
 */
export async function deleteQuote(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (session.role !== "owner") return { ok: false, error: "noAccess" };
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_quote", { p_quote: parsed.data.id });
  if (error) {
    const key = deleteError(error);
    if (key === "error") console.error("[quotes] delete failed", { code: error.code });
    return { ok: false, error: key };
  }
  // no revalidatePath: it would re-render the deleted quote (404) in this response — the page
  // replaces itself with the client's page, which loads fresh (dynamic pages aren't cached)
  return { ok: true };
}
