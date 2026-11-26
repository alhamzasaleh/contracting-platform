import "server-only";
import { notFound } from "next/navigation";
import type { SessionContext } from "@/lib/auth/session";
import type { GypsumFraming } from "@/lib/engine";
import type { ServiceKind } from "@/lib/pricing";
import { createClient } from "@/lib/supabase/server";

/**
 * The technician's framing document (owner, Nov 2026) for a quote (its current version) or a project
 * (its contract's agreed version): read from the version's frozen quantities — never re-priced, no
 * price at all (quotes.view, like the bill of quantities). Versions saved before the framing was
 * frozen have none: the page says to price the quote again.
 */
export type FramingDoc = {
  kind: "quote" | "project";
  number: string;
  quoteNumber: string;
  version: number;
  option: string | null;
  date: string;
  client: { name: string; city: string | null };
  service: ServiceKind;
  framing: GypsumFraming | null;
};

type Option = { version: number; label: string };
const optionLabel = (options: unknown, version: number) => (Array.isArray(options) ? ((options as Option[]).find((o) => o.version === version)?.label ?? null) : null);
const framingOf = (quantities: unknown): GypsumFraming | null => {
  const f = (quantities as { framing?: GypsumFraming } | null)?.framing;
  return f && Array.isArray(f.rooms) && f.rooms.length > 0 ? f : null;
};

export async function loadQuoteFraming(session: SessionContext, number: string): Promise<FramingDoc> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: q } = await supabase.from("quotes").select("id, number, service, client_id, current_version, options").eq("organization_id", orgId).eq("number", number).maybeSingle();
  if (!q) notFound();
  const [{ data: client }, { data: v }] = await Promise.all([
    supabase.from("clients").select("name, city").eq("id", q.client_id).maybeSingle(),
    supabase.from("quote_versions").select("version, created_at, quantities").eq("quote_id", q.id).eq("version", q.current_version).maybeSingle(),
  ]);
  if (!v) notFound();
  return {
    kind: "quote", number: q.number, quoteNumber: q.number, version: v.version, option: optionLabel(q.options, v.version), date: v.created_at,
    client: client ?? { name: "—", city: null }, service: q.service, framing: framingOf(v.quantities),
  };
}

export async function loadProjectFraming(session: SessionContext, number: string): Promise<FramingDoc> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  // RLS (incl. per-project access) decides whether the contract is visible at all
  const { data: c } = await supabase.from("contracts").select("id, number, service, quote_id, quote_version, client_id, options").eq("organization_id", orgId).eq("number", number).maybeSingle();
  if (!c) notFound();
  const [{ data: client }, { data: quote }, { data: v }] = await Promise.all([
    supabase.from("clients").select("name, city").eq("id", c.client_id).maybeSingle(),
    supabase.from("quotes").select("number").eq("id", c.quote_id).maybeSingle(),
    supabase.from("quote_versions").select("version, created_at, quantities").eq("quote_id", c.quote_id).eq("version", c.quote_version).maybeSingle(),
  ]);
  if (!v) notFound();
  return {
    kind: "project", number: c.number, quoteNumber: quote?.number ?? "—", version: v.version, option: optionLabel(c.options, v.version), date: v.created_at,
    client: client ?? { name: "—", city: null }, service: c.service as ServiceKind, framing: framingOf(v.quantities),
  };
}
