"use client";
import { useTranslations } from "next-intl";
import { useFormatter } from "@/components/formatter-provider";
import { useContractWork } from "@/components/contracts/contract-terms";
import type { ServiceKind } from "@/lib/pricing";

export type CertificateData = {
  org: { name: string; legal_name: string | null; cr_number: string | null; logoUrl?: string | null };
  client: { name: string; id_number?: string | null };
  contract: { number: string; service: ServiceKind; warranty_months: number };
  final: { confirmed_at: string; confirmed_name: string | null; signature?: string | null };
};

/** §3.12 final handover certificate — e-signed by the client on the client page. */
export function HandoverCertificate({ data }: { data: CertificateData }) {
  const t = useTranslations("projects");
  const { fmt } = useFormatter();
  const work = useContractWork()([data.contract.service]);
  const end = new Date(data.final.confirmed_at);
  end.setMonth(end.getMonth() + data.contract.warranty_months);
  const org = data.org.legal_name ?? data.org.name;
  return (
    <article className="mx-auto grid min-w-0 max-w-[820px] gap-5 rounded-3xl border border-border bg-white p-6 text-[14px] leading-7 text-neutral-900 sm:p-10 print:border-0 print:p-0">
      <header className="flex items-center justify-between gap-4 border-b-2 border-primary pb-4">
        <div className="flex items-center gap-3">
          {data.org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.org.logoUrl} alt="" className="h-14 w-auto object-contain" />
          ) : (
            <span className="flex size-12 items-center justify-center rounded-t-full bg-primary text-[20px] font-bold text-primary-foreground">{data.org.name.slice(0, 1)}</span>
          )}
          <div>
            <p className="font-extrabold">{org}</p>
            {data.org.cr_number && <p className="text-[12px] text-neutral-500">{t("cr", { n: data.org.cr_number })}</p>}
          </div>
        </div>
        <p className="font-latin text-[13px]">{data.contract.number}</p>
      </header>
      <p className="text-center text-[24px] font-extrabold text-primary">{t("certTitle")}</p>
      <p>
        {t("certBody", {
          client: data.client.name,
          id: data.client.id_number ? t("certId", { n: data.client.id_number }) : "",
          work,
          number: data.contract.number,
          org,
          date: fmt.date(data.final.confirmed_at),
        })}
      </p>
      <p>{t("certWarranty", { n: data.contract.warranty_months, from: fmt.date(data.final.confirmed_at), to: fmt.date(end) })}</p>
      <p className="text-[13px] text-neutral-600">{t("certNote")}</p>
      <section className="grid gap-4 border-t border-neutral-200 pt-5 sm:grid-cols-2">
        <div className="grid content-start gap-1">
          <p className="font-bold">{t("certFirst")}</p>
          <p className="text-[13px]">{org}</p>
        </div>
        <div className="grid content-start gap-1">
          <p className="font-bold">{t("certSecond")}</p>
          <p className="text-[13px]">{t("certSigned", { name: data.final.confirmed_name ?? data.client.name, date: fmt.dateTime(data.final.confirmed_at) })}</p>
          {data.final.signature && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.final.signature} alt={t("certSignature")} className="h-20 w-auto self-start" />
          )}
        </div>
      </section>
    </article>
  );
}
