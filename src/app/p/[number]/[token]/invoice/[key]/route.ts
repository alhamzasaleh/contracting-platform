import { NextResponse } from "next/server";
import { NUMBER_RE, TOKEN_RE } from "@/lib/portal";
import { qoyodInvoicePdf } from "@/lib/qoyod/sync";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/** Client page → the official invoice PDF from Qoyod (fresh short-lived link, checked by token). */
export async function GET(_req: Request, { params }: { params: Promise<{ number: string; token: string; key: string }> }) {
  const { number: rawNumber, token, key: rawKey } = await params;
  const number = decodeURIComponent(rawNumber);
  const key = decodeURIComponent(rawKey);
  const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!NUMBER_RE.test(number) || !TOKEN_RE.test(token) || !/^(p\d{1,2}|AD-\d{4}-\d{3,6})$/.test(key)) return notFound();
  const rl = await rateLimit(`portal:invoice:${await clientIp()}`, 20, 600);
  if (rl !== "ok") return new NextResponse("Too many requests", { status: 429 });
  const admin = createAdminClient();
  const { data } = await admin.rpc("portal_invoices", { p_number: number, p_token: token });
  const d = data as { org?: string; items?: { key: string; qoyod_id: number }[] } | null;
  const hit = d?.items?.find((x) => x.key === key);
  if (!d?.org || !hit) return notFound();
  const url = await qoyodInvoicePdf(d.org, hit.qoyod_id);
  if (!url) return new NextResponse("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
