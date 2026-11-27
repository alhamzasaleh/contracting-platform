"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DocNo } from "@/components/doc-no";
import { useFormatter } from "@/components/formatter-provider";
import { PortalHero } from "@/components/portal/portal-view";
import { Badge } from "@/components/ui/badge";
import type { MarketerPortalData } from "@/lib/marketer-portal";
import { commissionTotals, type CommissionStatus } from "@/lib/marketers";
import { lastValidDay } from "@/lib/contracts";

const TONE: Record<CommissionStatus, "neutral" | "warning" | "success" | "danger"> = { expected: "neutral", due: "warning", paid: "success", cancelled: "danger" };

/** The success partner's own page: his contracts and his reward — nothing about costs or the clients' contact details. */
export function MarketerPortalView({ data, logoUrl, token }: { data: MarketerPortalData; logoUrl: string | null; /** his link's token: his vouchers open under the same link */ token: string }) {
  const t = useTranslations("partnerPage");
  const tc = useTranslations("common");
  const { fmt } = useFormatter();
  const totals = commissionTotals(data.items);
  const org = { ...data.org, cr_number: null, vat_number: null, city: null, address: null, signatory_name: null, signatory_title: null, logo_path: null };
  return (
    <main className="min-h-dvh bg-background pb-10">
      <PortalHero org={org} logoUrl={logoUrl} clientName={data.marketer.name} intro={t("intro", { percent: fmt.number(data.marketer.commission_percent) })} number={data.marketer.number} />
      <div className="relative z-10 mx-auto -mt-6 grid max-w-[880px] gap-4 px-4 [&>*]:min-w-0">
        <section className="grid grid-cols-2 gap-3 rounded-3xl border border-border bg-surface p-5 shadow-sm sm:grid-cols-4">
          <Stat label={t("contracts")} value={fmt.number(data.items.filter((i) => i.status !== "cancelled").length)} />
          <Stat label={t("expected")} value={fmt.money(totals.expected)} />
          <Stat label={t("due")} value={fmt.money(totals.due)} strong />
          <Stat label={t("paid")} value={fmt.money(totals.paid)} />
        </section>
        {data.items.length === 0 ? (
          <p className="rounded-3xl border border-border bg-surface p-5 text-[14px] text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="grid gap-3">
            {data.items.map((i) => (
              <li key={i.contract} className="grid gap-2 rounded-3xl border border-border bg-surface p-5 text-[14px]" data-testid="partner-item">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 font-bold">
                    {i.client} · <DocNo>{i.contract}</DocNo>
                  </p>
                  <Badge tone={TONE[i.status]}>{t(`status_${i.status}`)}</Badge>
                </div>
                <p className="text-[13px] text-muted-foreground">
                  {t("contractLine", { date: fmt.date(i.date.slice(0, 10)), state: i.contract_status === "cancelled" ? t("cancelled") : i.handed_over ? t("handedOver") : t("underWay") })}
                </p>
                <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-3">
                  <Stat label={t("value")} value={fmt.money(i.base)} />
                  <Stat label={t("percent")} value={`${fmt.number(i.percent)}%`} />
                  <Stat label={t("reward")} value={fmt.money(i.amount)} strong />
                </div>
                {i.paid_amount > 0 && i.amount - i.paid_amount > 0.005 && (
                  <p className="text-[12px] text-muted-foreground">{t("paidLeft", { paid: fmt.money(i.paid_amount), left: fmt.money(i.amount - i.paid_amount) })}</p>
                )}
                {i.status === "expected" && <p className="text-[12px] text-muted-foreground">{t("expectedHint")}</p>}
                {i.vouchers.map((v) => (
                  <p key={v.number} className="text-[13px]">
                    {t("voucherLine", { amount: fmt.money(v.amount), date: fmt.date(v.paid_on) })} ·{" "}
                    <Link href={`/m/${encodeURIComponent(data.marketer.number)}/${token}/voucher/${encodeURIComponent(v.number)}`} className="text-primary hover:underline">
                      <DocNo>{v.number}</DocNo>
                    </Link>
                  </p>
                ))}
              </li>
            ))}
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
    <div className="min-w-0">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={strong ? "font-latin text-[16px] font-extrabold tabular-nums text-primary [overflow-wrap:anywhere]" : "font-latin font-bold tabular-nums [overflow-wrap:anywhere]"}>{value}</p>
    </div>
  );
}
