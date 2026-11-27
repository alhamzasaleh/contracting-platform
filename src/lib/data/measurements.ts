import "server-only";
import { toBasis, type MeasureBasis, type Measurement, type MeasureLine } from "@/lib/measurements";
import { notFound } from "next/navigation";
import type { SessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createClient>>;
export type MeasurementRowLite = Omit<Measurement, "photos"> & { photos: string[] };

/**
 * A project's measurement sheets (RLS: projects.view / quotes.view / finance.view + project access) and what can
 * be measured (public.measurement_basis — the agreed work types, price per m², discount and VAT). Photos are
 * returned as paths; the page signs them with its other photos.
 */
export async function loadMeasurements(supabase: Supa, contractId: string): Promise<{ basis: MeasureBasis | null; sheets: MeasurementRowLite[] }> {
  const [{ data: rows }, { data: basis }] = await Promise.all([
    supabase
      .from("contract_measurements")
      .select("id, number, status, lines, notes, photos, diff_subtotal, diff_vat, diff_total, sent_at, client_decided_at, client_name, client_note, credit_amount, refunded_at")
      .eq("contract_id", contractId)
      .order("created_at"),
    supabase.rpc("measurement_basis", { p_contract: contractId }),
  ]);
  return {
    basis: toBasis(basis),
    sheets: (rows ?? []).map((m) => ({
      ...m,
      lines: (m.lines ?? []).map((l) => ({
        work_type: l.work_type, measured_area: Number(l.measured_area), agreed_area: Number(l.agreed_area ?? 0), price_per_m2: Number(l.price_per_m2 ?? 0),
        diff_area: Number(l.diff_area ?? 0), diff_amount: Number(l.diff_amount ?? 0),
      })) as MeasureLine[],
      diff_subtotal: Number(m.diff_subtotal), diff_vat: Number(m.diff_vat), diff_total: Number(m.diff_total), credit_amount: Number(m.credit_amount),
    })),
  };
}

/** One sheet for the print page (projects.view under RLS; drafts aren't documents). */
export async function loadMeasurementDoc(session: SessionContext, number: string) {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: m } = await supabase
    .from("contract_measurements")
    .select("id, number, status, lines, notes, photos, diff_subtotal, diff_vat, diff_total, sent_at, client_decided_at, client_name, client_note, credit_amount, refunded_at, client_signature, contract_id")
    .eq("organization_id", orgId)
    .eq("number", number)
    .maybeSingle();
  if (!m || m.status === "draft") notFound();
  const [{ data: c }, signed] = await Promise.all([
    supabase.from("contracts").select("number, client_id").eq("id", m.contract_id).maybeSingle(),
    m.photos.length ? supabase.storage.from("project-photos").createSignedUrls(m.photos, 600).then((r) => r.data ?? []) : Promise.resolve([]),
  ]);
  if (!c) notFound();
  const { data: client } = await supabase.from("clients").select("name").eq("id", c.client_id).maybeSingle();
  return {
    client: { name: client?.name ?? "—" },
    contract: { number: c.number },
    sheet: {
      ...m,
      lines: m.lines.map((l) => ({ work_type: l.work_type, measured_area: Number(l.measured_area), agreed_area: Number(l.agreed_area ?? 0), price_per_m2: Number(l.price_per_m2 ?? 0), diff_area: Number(l.diff_area ?? 0), diff_amount: Number(l.diff_amount ?? 0) })),
      diff_subtotal: Number(m.diff_subtotal), diff_vat: Number(m.diff_vat), diff_total: Number(m.diff_total), credit_amount: Number(m.credit_amount),
      photos: signed.map((s) => s.signedUrl).filter((u): u is string => !!u),
      signature: m.client_signature,
    },
  };
}
