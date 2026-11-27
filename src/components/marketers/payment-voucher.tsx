"use client";
import { Paper } from "@/components/documents/paper";
import { useLocale, useTranslations } from "next-intl";
import { BrandLogo } from "@/components/brand-logo";
import { useFormatter } from "@/components/formatter-provider";
import { useListSep } from "@/components/forms/form-kit";
import type { PaymentVoucherDoc } from "@/lib/data/marketers";
import { amountInWords } from "@/lib/tafqeet";

/** سند صرف — the success partner's reward paid (PV-), print-grade and branded like the receipt voucher. */
export function PaymentVoucher({ data }: { data: PaymentVoucherDoc }) {
  const sep = useListSep();
  const t = useTranslations("voucher");
  const locale = useLocale() as "ar" | "en";
  const { fmt } = useFormatter();
  const v = data.voucher;
  const org = data.org.legal_name ?? data.org.name;
  return (
    <Paper>
      <article className="relative mx-auto grid min-w-0 max-w-[820px] gap-6 overflow-hidden rounded-3xl border border-border bg-white text-[14px] leading-7 text-basalt print:rounded-none print:border-0 print:px-0 print:pb-0 print:pt-10 p-10" data-testid="payment-voucher">
      <span aria-hidden className="absolute end-0 top-0 size-10 bg-clay [clip-path:polygon(0_0,100%_0,100%_100%)] rtl:[clip-path:polygon(0_0,100%_0,0_100%)] print:size-8" />
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-primary pb-4">
        <div className="flex flex-wrap items-center gap-3">
          {data.org.logoUrl && <BrandLogo src={data.org.logoUrl} label={data.org.name} className="text-basalt" fit="h-auto w-[140px] max-h-16" />}
          <div className="text-[12px] leading-6 text-doc-muted">
            <p className="text-[14px] font-extrabold text-basalt">{org}</p>
            {data.org.cr_number && <p>{t("cr", { n: data.org.cr_number })}</p>}
            {(data.org.city || data.org.address) && <p>{[data.org.address, data.org.city].filter(Boolean).join(sep)}</p>}
          </div>
        </div>
        <div className="text-end">
          <p className="text-[26px] font-extrabold text-primary">{t("title")}</p>
          <p className="font-latin text-[13px]"><bdi dir="ltr" className="whitespace-nowrap">{v.number}</bdi></p>
          <p className="text-[12px] text-doc-muted">{fmt.date(v.paid_on)}</p>
        </div>
      </header>

      <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-2xl bg-gypsum px-5 py-4">
        <span className="text-doc-muted">{t("amount")}</span>
        <span className="text-[26px] font-extrabold">{fmt.money(v.amount)}</span>
        <span className="w-full text-[13px] font-semibold">{amountInWords(v.amount, locale)}</span>
      </div>

      <dl>
        <Row label={t("paidTo")}>
          {data.marketer.name} — <bdi dir="ltr" className="font-latin whitespace-nowrap">{data.marketer.number}</bdi>
        </Row>
        <Row label={t("for")}>
          {t("forText", { percent: fmt.number(data.contract.percent), client: data.contract.client })}{" "}
          <bdi dir="ltr" className="font-latin whitespace-nowrap">{data.contract.number}</bdi>
        </Row>
        <Row label={t("base")}>{fmt.money(data.contract.base)}</Row>
        {!!v.paid_before && <Row label={t("paidBefore")}>{fmt.money(v.paid_before)}</Row>}
        <Row label={t("method")}>{t(`m_${v.method}`)}</Row>
        {v.reference && <Row label={t("reference")}><bdi dir="ltr" className="font-latin">{v.reference}</bdi></Row>}
        {data.marketer.iban && <Row label={t("iban")}><bdi dir="ltr" className="font-latin break-all">{data.marketer.iban}</bdi></Row>}
        {v.note && <Row label={t("note")}>{v.note}</Row>}
      </dl>

      <footer className="grid gap-6 border-t border-sand pt-5 grid-cols-2">
        <div className="grid content-start gap-1">
          <p className="font-bold">{t("payer")}</p>
          <p className="text-[13px]">{org}</p>
          {data.org.signatory_name && <p className="text-[13px] text-doc-muted">{[data.org.signatory_name, data.org.signatory_title].filter(Boolean).join(" — ")}</p>}
        </div>
        <div className="grid content-start gap-1">
          <p className="font-bold">{t("receiver")}</p>
          <p className="text-[13px]">{data.marketer.name}</p>
          <p className="mt-6 border-t border-dashed border-sand pt-1 text-[12px] text-doc-muted">{t("signature")}</p>
        </div>
      </footer>
    </article>
    </Paper>
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
