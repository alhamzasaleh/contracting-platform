"use client";
import { Download } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DocNo } from "@/components/doc-no";
import { useFormatter } from "@/components/formatter-provider";
import { PortalHero } from "@/components/portal/portal-view";
import { Badge } from "@/components/ui/badge";
import { lastValidDay } from "@/lib/contracts";
import type { SubPortalData } from "@/lib/sub-portal";
import { cn } from "@/lib/utils";

/** The subcontractor's own page: his projects, the work recorded for him, his payments and his balance. */
export function SubPortalView({ data, logoUrl, token }: { data: SubPortalData; logoUrl: string | null; token: string }) {
  const t = useTranslations("subPage");
  const ts = useTranslations("subs");
  const tc = useTranslations("common");
  const { fmt } = useFormatter();
  const base = `/s/${encodeURIComponent(data.subcontractor.number)}/${token}`;
  const org = { ...data.org, cr_number: null, vat_number: null, city: null, address: null, signatory_name: null, signatory_title: null, logo_path: null };
  const tot = data.statement.totals;
  return (
    <main className="min-h-dvh bg-background pb-10">
      <PortalHero org={org} logoUrl={logoUrl} clientName={data.subcontractor.name} intro={t("intro")} number={data.subcontractor.number} />
      <div className="relative z-10 mx-auto -mt-6 grid max-w-[880px] gap-4 px-4 [&>*]:min-w-0">
        <section className="grid grid-cols-2 gap-3 rounded-3xl border border-border bg-surface p-5 shadow-sm sm:grid-cols-4">
          <Stat label={t("projects")} value={fmt.number(data.agreements.length)} />
          <Stat label={ts("earned")} value={fmt.money(tot.earned)} />
          <Stat label={ts("paid")} value={fmt.money(tot.paid)} />
          <Stat label={tot.balance < 0 ? ts("paidAhead") : ts("due")} value={fmt.money(Math.abs(tot.balance))} strong />
        </section>
        <div className="flex flex-wrap justify-center gap-4 print:hidden">
          <Link href={`${base}/statement`} target="_blank" className="inline-flex items-center gap-2 text-[14px] font-semibold text-primary hover:underline">
            {ts("statement")}
          </Link>
          <a href={`${base}/pdf/statement`} className="inline-flex items-center gap-2 text-[14px] font-semibold text-primary hover:underline">
            <Download className="size-4" /> {t("statementPdf")}
          </a>
        </div>
        {data.agreements.length === 0 ? (
          <p className="rounded-3xl border border-border bg-surface p-5 text-[14px] text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="grid gap-3">
            {data.agreements.map((g) => {
              const agreed = g.basis === "lump" ? g.rate : g.rate * (g.quantity_m2 ?? 0);
              const earned = g.work.reduce((a, w) => a + w.amount, 0);
              const paid = g.payments.reduce((a, p) => a + p.amount, 0);
              const place = [g.district, g.city].filter(Boolean).join(" — ");
              return (
                <li key={g.id} className="grid gap-3 rounded-3xl border border-border bg-surface p-5 text-[14px]" data-testid="sub-item">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 font-bold">
                      {g.client} · <DocNo>{g.contract}</DocNo>
                    </p>
                    {g.status === "closed" && <Badge tone="neutral">{ts("closed")}</Badge>}
                  </div>
                  <p className="text-[13px] text-muted-foreground">
                    {g.scope}
                    {place && ` · ${place}`} · {g.basis === "per_m2" ? ts("perM2", { rate: fmt.money(g.rate) }) : ts("lump")}
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
                    <Stat label={ts("agreed")} value={fmt.money(agreed)} />
                    <Stat label={ts("earned")} value={fmt.money(earned)} />
                    <Stat label={ts("paid")} value={fmt.money(paid)} />
                    <Stat label={earned - paid < 0 ? ts("paidAhead") : ts("due")} value={fmt.money(Math.abs(earned - paid))} strong />
                  </div>
                  {(g.work.length > 0 || g.payments.length > 0) && (
                    <ul className="grid gap-1 text-[12px]">
                      {[...g.work.map((w, i) => ({ key: `w${i}`, date: w.work_date, kind: "work" as const, w })), ...g.payments.map((p) => ({ key: p.number, date: p.paid_on, kind: "pay" as const, p }))]
                        .sort((a, b) => (a.date < b.date ? 1 : -1))
                        .map((e) => (
                          <li key={e.key} className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-1">
                            <span>
                              {fmt.date(e.date)} ·{" "}
                              {e.kind === "work" ? (
                                e.w.quantity_m2 != null ? ts("workM2", { n: fmt.number(e.w.quantity_m2, 1) }) : ts("workPct", { n: fmt.number(e.w.percent ?? 0, 0) })
                              ) : (
                                <>
                                  {ts(`method_${e.p.method}` as "method_cash")} ·{" "}
                                  <Link href={`${base}/voucher/${encodeURIComponent(e.p.number)}`} target="_blank" className="text-primary hover:underline">
                                    <DocNo>{e.p.number}</DocNo>
                                  </Link>
                                </>
                              )}
                            </span>
                            <span className={cn("font-latin tabular-nums", e.kind === "pay" && "text-success")}>
                              {e.kind === "pay" ? "− " : "+ "}
                              {fmt.money(e.kind === "pay" ? e.p.amount : e.w.amount)}
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-center text-[12px] text-subtle-foreground">{t("validUntil", { date: fmt.date(lastValidDay(data.expires_at)) })}</p>
        <p className="text-center text-[12px] text-subtle-foreground">{tc("rights", { year: new Date().getFullYear(), name: data.org.legal_name ?? data.org.name })}</p>
      </div>
    </main>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className={cn("font-latin tabular-nums", strong ? "text-[16px] font-extrabold" : "font-bold")}>{value}</span>
    </div>
  );
}
