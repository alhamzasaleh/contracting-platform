import { NextResponse } from "next/server";
import { can, getSession } from "@/lib/auth/session";
import { qoyodInvoicePdf } from "@/lib/qoyod/sync";
import { createClient } from "@/lib/supabase/server";

/** Staff: open the official Qoyod PDF of a synced invoice (finance.view; the job is read under RLS). */
export async function GET(_req: Request, { params }: { params: Promise<{ job: string }> }) {
  const { job } = await params;
  const session = await getSession();
  if (!can(session, "finance.view") || !/^[0-9a-f-]{36}$/.test(job)) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from("qoyod_sync_jobs").select("qoyod_id, kind, status").eq("id", job).eq("organization_id", session.organization.id).maybeSingle();
  if (!data || data.kind !== "invoice" || data.status !== "done" || !data.qoyod_id) return new NextResponse("Not found", { status: 404 });
  const url = await qoyodInvoicePdf(session.organization.id, data.qoyod_id);
  if (!url) return new NextResponse("Unavailable", { status: 503 });
  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
