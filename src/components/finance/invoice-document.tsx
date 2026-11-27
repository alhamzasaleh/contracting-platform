"use client";
import { Paper } from "@/components/documents/paper";
import { useLocale, useTranslations } from "next-intl";
import { BrandLogo } from "@/components/brand-logo";
import { useFormatter } from "@/components/formatter-provider";
import { invoiceRemaining, type InvoiceDoc } from "@/lib/invoices";
import { amountInWords } from "@/lib/tafqeet";
import { useListSep } from "@/components/forms/form-kit";

/** Invoice (فاتورة / فاتورة ضريبية) — print-grade and branded; "tax" only when issued with a VAT number. */
export function InvoiceDocument({ data, logoUrl, qr, credit }: { data: InvoiceDoc; logoUrl?: string | null; qr?: string | null; credit?: { invoice: string } }) {
  const sep = useListSep();
  const t = useTranslations("invoice");
  const locale = useLocale() as "ar" | "en";
  const { fmt } = useFormatter();
  const s = data.seller;
  const b = data.buyer;
  const seller = s.legal_name ?? s.name ?? "";
  const tax = data.kind === "tax";
  return (
    <Paper>
      <article className="relative mx-auto grid min-w-0 max-w-[820px] gap-6 overflow-hidden rounded-3xl border border-border bg-white text-[14px] leading-7 text-basalt print:rounded-none print:border-0 print:px-0 print:pb-0 print:pt-10 p-10">
      <span aria-hidden className="absolute end-0 top-0 size-10 bg-clay [clip-path:polygon(0_0,100%_0,100%_100%)] rtl:[clip-path:polygon(0_0,100%_0,0_100%)] print:size-8" />
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-primary pb-4">
        <div className="flex flex-wrap items-center gap-3">
          {logoUrl && <BrandLogo src={logoUrl} label={s.name ?? ""} className="text-basalt" fit="h-auto w-[140px] max-h-16" />}
          <div className="text-[12px] leading-6 text-doc-muted">
            <p className="text-[14px] font-extrabold text-basalt">{seller}</p>
            {s.cr_number && <p>{t("cr", { n: s.cr_number })}</p>}
            {s.vat_number && <p>{t("vat", { n: s.vat_number })}</p>}
            {(s.city || s.address) && <p>{[s.address, s.city].filter(Boolean).join(sep)}</p>}
          </div>
        </div>
        <div className="text-end">
          <p className="text-[26px] font-extrabold text-primary">{credit ? (tax ? t("creditTaxTitle") : t("creditTitle")) : tax ? t("taxTitle") : t("title")}</p>
          {tax && <p className="font-latin text-[12px] text-doc-muted">{credit ? "Tax Credit Note" : "Tax Invoice"}</p>}
          <p className="font-latin text-[13px]"><bdi dir="ltr" className="whitespace-nowrap">{data.number}</bdi></p>
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element -- a small server-made data URL
            <img src={qr} alt={t("qrAlt")} width={96} height={96} className="ms-auto mt-2 size-24" />
          )}
        </div>
      </header>

      <section className="grid gap-4 grid-cols-2">
        <dl className="grid gap-1 rounded-2xl bg-gypsum p-4 text-[13px]">
          <dt className="font-bold">{t("billTo")}</dt>
          <dd className="font-semibold">{b.name}</dd>
          {b.id_number && <dd className="text-doc-muted">{t("idNumber", { n: b.id_number })}</dd>}
          {b.phone && <dd className="text-doc-muted"><bdi dir="ltr" className="font-latin">{b.phone.startsWith("966") ? `0${b.phone.slice(3)}` : b.phone}</bdi></dd>}
          {(b.city || b.district) && <dd className="text-doc-muted">{[b.district, b.city].filter(Boolean).join(sep)}</dd>}
        </dl>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-2xl border border-sand p-4 text-[13px]">
          <dt className="text-doc-muted">{t("issueDate")}</dt><dd className="font-semibold">{fmt.date(data.issue_date)}</dd>
          {credit ? (
            <>
              <dt className="text-doc-muted">{t("againstInvoice")}</dt><dd className="font-semibold"><bdi dir="ltr" className="font-latin whitespace-nowrap">{credit.invoice}</bdi></dd>
            </>
          ) : (
            <>
              <dt className="text-doc-muted">{t("dueDate")}</dt><dd className="font-semibold">{fmt.date(data.due_date)}</dd>
            </>
          )}
          <dt className="text-doc-muted">{t("contract")}</dt><dd className="font-semibold"><bdi dir="ltr" className="font-latin whitespace-nowrap">{data.contract}</bdi></dd>
        </dl>
      </section>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-sand text-doc-muted">
              <th className="py-2 text-start font-semibold">{t("item")}</th>
              <th className="py-2 text-end font-semibold">{tax ? t("amountBeforeVat") : t("amount")}</th>
              {tax && <th className="py-2 text-end font-semibold">{t("vatCol", { p: fmt.number(data.vat_percent) })}</th>}
              <th className="py-2 text-end font-semibold">{t("lineTotal")}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-sand/60">
              <td className="py-3">{data.description}</td>
              <td className="py-3 text-end tabular-nums">{fmt.money(data.subtotal)}</td>
              {tax && <td className="py-3 text-end tabular-nums">{fmt.money(data.vat)}</td>}
              <td className="py-3 text-end font-semibold tabular-nums">{fmt.money(data.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <section className="grid gap-4 grid-cols-[1fr_auto]">
        <p className="self-end text-[13px] font-semibold">{amountInWords(data.total, locale)}</p>
        <dl className="grid min-w-[16rem] grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[13px]">
          {tax && (
            <>
              <dt className="text-doc-muted">{t("subtotal")}</dt><dd className="text-end tabular-nums">{fmt.money(data.subtotal)}</dd>
              <dt className="text-doc-muted">{t("vatTotal", { p: fmt.number(data.vat_percent) })}</dt><dd className="text-end tabular-nums">{fmt.money(data.vat)}</dd>
            </>
          )}
          <dt className="border-t border-sand pt-1.5 font-bold">{t("total")}</dt><dd className="border-t border-sand pt-1.5 text-end text-[16px] font-extrabold tabular-nums">{fmt.money(data.total)}</dd>
          {!credit && (
            <>
              <dt className="text-doc-muted">{t("paid")}</dt><dd className="text-end tabular-nums">{fmt.money(data.paid)}</dd>
              {!!data.credited && (
                <>
                  <dt className="text-doc-muted">{t("credited")}</dt><dd className="text-end tabular-nums">{fmt.money(data.credited)}</dd>
                </>
              )}
              <dt className="font-bold">{t("remaining")}</dt><dd className="text-end font-bold tabular-nums">{fmt.money(invoiceRemaining(data))}</dd>
            </>
          )}
        </dl>
      </section>

      <footer className="border-t border-sand pt-4 text-[12px] text-doc-muted">
        {credit ? t("noteCredit") : tax ? t("noteTax") : t("noteSimple")}
      </footer>
    </article>
    </Paper>
  );
}
