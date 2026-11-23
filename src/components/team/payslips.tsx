"use client";
import { useTranslations } from "next-intl";
import { BrandLogo } from "@/components/brand-logo";
import { useFormatter } from "@/components/formatter-provider";
import type { PayrollLineView } from "@/lib/data/payroll";

/** One printable payslip per employee (A4 page each). */
export function Payslips({ org, month, lines }: { org: { name: string; legal_name: string | null; logoUrl: string | null }; month: string; lines: PayrollLineView[] }) {
  const t = useTranslations("payroll");
  const { fmt } = useFormatter();
  const label = fmt.monthYear(`${month}-01T12:00:00Z`);
  const row = (k: string, v: number, strong = false) => (
    <div className={strong ? "flex justify-between border-t-2 border-basalt pt-2 text-[16px] font-extrabold" : "flex justify-between border-b border-sand py-1.5"}>
      <span>{k}</span>
      <span className="font-latin tabular-nums">{fmt.money(v)}</span>
    </div>
  );
  return (
    <div className="grid gap-6 print:gap-0">
      {lines.map((l) => (
        <article key={l.id} className="mx-auto grid w-full max-w-[720px] gap-4 rounded-3xl border border-border bg-white p-8 text-[14px] text-basalt print:break-after-page print:rounded-none print:border-0">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-primary pb-3">
            <div className="flex items-center gap-3">
              {org.logoUrl && <BrandLogo src={org.logoUrl} label={org.name} className="w-[120px] text-basalt" />}
              <p className="font-extrabold">{org.legal_name ?? org.name}</p>
            </div>
            <div className="text-end">
              <p className="text-[18px] font-extrabold text-primary">{t("payslip")}</p>
              <p className="text-[12px] text-doc-muted">{label}</p>
            </div>
          </header>
          <div className="grid gap-1">
            <p className="text-[16px] font-bold">{l.full_name}</p>
            {l.iban && <p className="font-latin text-[12px] text-doc-muted" dir="ltr">{l.iban}</p>}
          </div>
          <div className="grid gap-0.5">
            {row(t("basic"), l.basic)}
            {row(t("housing"), l.housing)}
            {row(t("transport"), l.transport)}
            {l.other > 0 && row(t("other"), l.other)}
            {l.overtime > 0 && row(t("overtime"), l.overtime)}
            {l.deductions > 0 && row(t("deductions"), -l.deductions)}
            {l.advances > 0 && row(t("advances"), -l.advances)}
            {row(t("net"), l.net, true)}
          </div>
          {l.note && <p className="text-[12px] text-doc-muted">{l.note}</p>}
          <footer className="mt-6 grid grid-cols-2 gap-6 text-[12px] text-doc-muted">
            <p className="border-t border-sand pt-2">{t("employerSignature")}</p>
            <p className="border-t border-sand pt-2">{t("employeeSignature")}</p>
          </footer>
        </article>
      ))}
    </div>
  );
}
