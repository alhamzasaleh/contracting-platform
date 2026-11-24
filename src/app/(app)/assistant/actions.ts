"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import type { ActionResult } from "@/lib/actions";
import { askAssistant, type AssistantAnswer } from "@/lib/ai/assistant";
import { buildFacts, monthTotals } from "@/lib/assistant/context";
import { quoteMonthStats } from "@/lib/portal-flow";
import type { QuoteStatus } from "@/lib/supabase/database.types";
import { companyPaidRepairs } from "@/lib/finance";
import { can, getSession } from "@/lib/auth/session";
import { loadOwnerFinance } from "@/lib/data/finance";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const schema = z
  .object({
    question: z.string().trim().min(2).max(500),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) }).strict()).max(8),
  })
  .strict();

/** Ask the finance assistant (read-only; finance.view; 30 questions an hour per user). */
export async function askFinanceAssistant(input: unknown): Promise<ActionResult<AssistantAnswer>> {
  const session = await getSession();
  if (!can(session, "finance.view")) return { ok: false, error: "noAccess" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if ((await rateLimit(`ai:assistant:${session.userId}`, 30, 3600)) !== "ok") return { ok: false, error: "limited" };

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  const since = `${Number(today.slice(0, 4)) - 1}${today.slice(4, 7)}-01`;
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [finance, { data: receipts }, { data: purchases }, { data: maint }, { data: quotes }] = await Promise.all([
    loadOwnerFinance(session, today),
    supabase.from("client_receipts").select("paid_on, amount").eq("organization_id", orgId).gte("paid_on", since),
    supabase.from("purchases").select("invoice_date, recorded_at, total").eq("organization_id", orgId).eq("status", "recorded").gte("created_at", since),
    supabase.from("maintenance_requests").select("created_at, cost, covered").eq("organization_id", orgId).gte("created_at", since),
    // quotes and the client's answers (RLS: quotes.view — none without it)
    can(session, "quotes.view")
      ? supabase.from("quotes").select("number, status, created_at, client_decision, client_decided_at").eq("organization_id", orgId).gte("created_at", since)
      : Promise.resolve({ data: [] as { number: string; status: QuoteStatus; created_at: string; client_decision: null; client_decided_at: null }[] }),
  ]);
  const facts = buildFacts(finance, {
    company: session.organization.name,
    vatRegistered: !!session.organization.vat_number,
    collected: monthTotals((receipts ?? []).map((r) => ({ date: r.paid_on, amount: Number(r.amount) }))),
    purchases: monthTotals((purchases ?? []).map((p) => ({ date: p.invoice_date ?? p.recorded_at, amount: Number(p.total) }))),
    // what the company pays: repairs covered by the warranty (charged-to-client repairs are not a cost)
    quotes: quoteMonthStats((quotes ?? []).map((q) => ({ number: q.number, created_at: q.created_at, decision: q.client_decision ?? null, decided_at: q.client_decided_at ?? null, status: q.status }))),
    maintenance: monthTotals(companyPaidRepairs((maint ?? []).map((m) => ({ covered: m.covered, cost: Number(m.cost), created_at: m.created_at }))).map((m) => ({ date: m.created_at, amount: m.cost }))),
  });
  const r = await askAssistant(parsed.data.question, parsed.data.history, facts, (await getLocale()) === "en" ? "en" : "ar", session.permissions);
  return r.ok ? { ok: true, data: r.answer } : { ok: false, error: r.error };
}
