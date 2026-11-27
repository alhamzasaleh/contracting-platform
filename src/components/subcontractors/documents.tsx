"use client";
import { useLocale, useTranslations } from "next-intl";
import { BrandLogo } from "@/components/brand-logo";
import { useFormatter } from "@/components/formatter-provider";
import { useListSep } from "@/components/forms/form-kit";
import type { SubStatementDoc, SubVoucherDoc } from "@/lib/data/subcontractors";
import { amountInWords } from "@/lib/tafqeet";

export type DocOrg = { name: string; legal_name: string | null; cr_number?: string | null; city?: string | null; address?: string | null; signatory_name?: string | null; signatory_title?: string | null; logoUrl?: string | null };

function Header({ org, title, number, date }: { org: DocOrg; title: string; number: string; date?: string }) {
  const sep = useListSep();
  const t = useTranslations("voucher");
  const { fmt } = useFormatter();
  const name = org.legal_name ?? org.name;
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-primary pb-4">
      <div className="flex flex-wrap items-center gap-3">
        {org.logoUrl && <BrandLogo src={org.logoUrl} label={org.name} className="text-basalt" fit="h-auto w-[min(140px,40vw)] max-h-16" />}
        <div className="text-[12px] leading-6 text-doc-muted">
          <p className="text-[14px] font-extrabold text-basalt">{name}</p>
          {org.cr_number && <p>{t("cr", { n: org.cr_number })}</p>}
          {(org.city || org.address) && <p>{[org.address, org.city].filter(Boolean).join(sep)}</p>}
        </div>
      </div>
      <div className="text-end">
        <p className="text-[20px] font-extrabold text-primary sm:text-[24px]">{title}</p>
        <p className="font-latin text-[13px]">
          <bdi dir="ltr" className="whitespace-nowrap">{number}</bdi>
        </p>
        {date && <p className="text-[12px] text-doc-muted">{fmt.date(date)}</p>}
      </div>
    </header>
  );
}

const Corner = () => <span aria-hidden className="absolute end-0 top-0 size-10 bg-clay [clip-path:polygon(0_0,100%_0,100%_100%)] rtl:[clip-path:polygon(0_0,100%_0,0_100%)] print:size-8" />;
const ARTICLE = "relative mx-auto grid min-w-0 max-w-[820px] gap-6 overflow-hidden rounded-3xl border border-border bg-white p-6 text-[14px] leading-7 text-basalt sm:p-10 print:rounded-none print:border-0 print:px-0 print:pb-0 print:pt-10";

/** سند صرف — a payment to a subcontractor (SP-), signed by him on receipt. */
export function SubVoucherDocument({ org, data }: { org: DocOrg; data: SubVoucherDoc }) {
  const t = useTranslations("voucher");
  const ts = useTranslations("subs");
  const locale = useLocale() as "ar" | "en";
  const { fmt } = useFormatter();
  const v = data.voucher;
  return (
    <article className={ARTICLE} data-testid="sub-voucher">
      <Corner />
      <Header org={org} title={t("title")} number={v.number} date={v.paid_on} />
      <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-2xl bg-gypsum px-5 py-4">
        <span className="text-doc-muted">{t("amount")}</span>
        <span className="text-[26px] font-extrabold">{fmt.money(v.amount)}</span>
        <span className="w-full text-[13px] font-semibold">{amountInWords(v.amount, locale)}</span>
      </div>
      <dl>
        <Row label={t("paidTo")}>
          {data.sub.name} — <bdi dir="ltr" className="font-latin whitespace-nowrap">{data.sub.number}</bdi>
        </Row>
        <Row label={t("for")}>
          {ts("voucherFor", { scope: data.agreement.scope, client: data.agreement.client })} <bdi dir="ltr" className="font-latin whitespace-nowrap">{data.agreement.contract}</bdi>
        </Row>
        <Row label={t("method")}>{t(`m_${v.method}` as "m_cash")}</Row>
        {v.reference && <Row label={t("reference")}><bdi dir="ltr" className="font-latin">{v.reference}</bdi></Row>}
        {data.sub.iban && <Row label={t("iban")}><bdi dir="ltr" className="font-latin break-all">{data.sub.iban}</bdi></Row>}
        {v.note && <Row label={t("note")}>{v.note}</Row>}
      </dl>
      <footer className="grid gap-6 border-t border-sand pt-5 sm:grid-cols-2 print:break-inside-avoid">
        <div className="grid content-start gap-1">
          <p className="font-bold">{t("payer")}</p>
          <p className="text-[13px]">{org.legal_name ?? org.name}</p>
          {org.signatory_name && <p className="text-[13px] text-doc-muted">{[org.signatory_name, org.signatory_title].filter(Boolean).join(" — ")}</p>}
        </div>
        <div className="grid content-start gap-1">
          <p className="font-bold">{t("receiver")}</p>
          <p className="text-[13px]">{data.sub.name}</p>
          <p className="mt-6 border-t border-dashed border-sand pt-1 text-[12px] text-doc-muted">{t("signature")}</p>
        </div>
      </footer>
    </article>
  );
}

/** كشف حساب مقاول الباطن — every work and payment by date with a running balance, and per project. */
export function SubStatementDocument({ org, data }: { org: DocOrg; data: Pick<SubStatementDoc, "sub" | "statement" | "agreements" | "today"> }) {
  const t = useTranslations("subs");
  const { fmt } = useFormatter();
  const { rows, totals } = data.statement;
  const cell = "px-2 py-1.5";
  return (
    <article className={ARTICLE} data-testid="sub-statement">
      <Corner />
      <Header org={org} title={t("statementTitle")} number={data.sub.number} date={data.today} />
      <p className="font-bold">
        {data.sub.name}
      </p>
      <div className="grid grid-cols-1 gap-3 rounded-2xl bg-gypsum p-4 text-[13px] min-[400px]:grid-cols-3">
        <Total label={t("earned")} value={fmt.money(totals.earned)} />
        <Total label={t("paid")} value={fmt.money(totals.paid)} />
        <Total label={totals.balance < 0 ? t("paidAhead") : t("due")} value={fmt.money(Math.abs(totals.balance))} strong />
      </div>
      {data.agreements.length > 0 && (
        <div className="-mx-1 overflow-x-auto px-1 print:mx-0 print:overflow-visible print:px-0">
          <table className="w-full min-w-[480px] text-[12px] print:min-w-0">
            <thead className="text-doc-muted">
              <tr className="border-b border-sand">
                <th className={`${cell} text-start font-semibold`}>{t("project")}</th>
                <th className={`${cell} text-end font-semibold`}>{t("agreed")}</th>
                <th className={`${cell} text-end font-semibold`}>{t("earned")}</th>
                <th className={`${cell} text-end font-semibold`}>{t("paid")}</th>
              </tr>
            </thead>
            <tbody className="font-latin tabular-nums">
              {data.agreements.map((a, i) => (
                <tr key={`${a.contract}-${i}`} className="border-b border-sand/60">
                  <td className={`${cell} font-sans`}>
                    <bdi dir="ltr">{a.contract}</bdi> · {a.client} — {a.scope}
                  </td>
                  <td className={`${cell} text-end`}>{fmt.money(a.agreed)}</td>
                  <td className={`${cell} text-end`}>{fmt.money(a.earned)}</td>
                  <td className={`${cell} text-end`}>{fmt.money(a.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="-mx-1 overflow-x-auto px-1 print:mx-0 print:overflow-visible print:px-0">
        <table className="w-full min-w-[560px] text-[12px] print:min-w-0">
          <thead className="text-doc-muted">
            <tr className="border-b border-sand">
              <th className={`${cell} text-start font-semibold`}>{t("date")}</th>
              <th className={`${cell} text-start font-semibold`}>{t("entry")}</th>
              <th className={`${cell} text-end font-semibold`}>{t("earned")}</th>
              <th className={`${cell} text-end font-semibold`}>{t("paid")}</th>
              <th className={`${cell} text-end font-semibold`}>{t("balance")}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className={`${cell} text-doc-muted`}>{t("statementEmpty")}</td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-sand/60 align-top">
                <td className={`${cell} whitespace-nowrap font-latin`}>{fmt.date(r.date)}</td>
                <td className={cell}>
                  {r.kind === "work"
                    ? r.quantity_m2 != null
                      ? t("workM2", { n: fmt.number(r.quantity_m2, 1) })
                      : t("workPct", { n: fmt.number(r.percent ?? 0, 0) })
                    : t("paymentLine")}
                  {r.voucher && <> · <bdi dir="ltr" className="font-latin">{r.voucher}</bdi></>}
                  <span className="text-doc-muted"> · <bdi dir="ltr" className="font-latin">{r.contract}</bdi> — {r.scope}</span>
                </td>
                <td className={`${cell} text-end font-latin`}>{r.earned ? fmt.money(r.earned) : ""}</td>
                <td className={`${cell} text-end font-latin`}>{r.paid ? fmt.money(r.paid) : ""}</td>
                <td className={`${cell} text-end font-latin font-bold`}>{fmt.money(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-doc-muted">{t("statementNote")}</p>
    </article>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-doc-muted">{label}</span>
      <span className={strong ? "font-latin text-[16px] font-extrabold" : "font-latin font-bold"}>{value}</span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-3 border-b border-sand/70 py-2.5 last:border-0">
      <dt className="text-doc-muted">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}
