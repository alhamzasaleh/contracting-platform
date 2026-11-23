import { NextResponse } from "next/server";
import { can, getSession } from "@/lib/auth/session";
import { payrollCsv } from "@/lib/hr";
import { createClient } from "@/lib/supabase/server";

/** Bank / WPS transfer file for a month (hr.view). Personal data: never cached. */
export async function GET(_req: Request, { params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  if (!/^\d{4}-\d{2}$/.test(month)) return new NextResponse("Bad request", { status: 400 });
  const session = await getSession();
  if (!can(session, "hr.view")) return new NextResponse("Forbidden", { status: 403 });
  const supabase = await createClient();
  const { data: run } = await supabase.from("payroll_runs").select("id").eq("organization_id", session.organization.id).eq("month", `${month}-01`).maybeSingle();
  if (!run) return new NextResponse("Not found", { status: 404 });
  const { data: lines } = await supabase.from("payroll_lines").select("full_name, iban, net").eq("run_id", run.id).order("full_name");
  const csv = payrollCsv((lines ?? []).map((l) => ({ full_name: l.full_name, iban: l.iban, net: Number(l.net) })), month);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payroll-${month}.csv"`,
      "Cache-Control": "no-store, private",
    },
  });
}
