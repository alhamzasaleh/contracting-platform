"use client";
import { useTranslations } from "next-intl";
import { BrandLogo } from "@/components/brand-logo";
import { useFormatter } from "@/components/formatter-provider";
import { MeasurementTable } from "@/components/projects/measurements";
import type { Measurement } from "@/lib/measurements";

export type MeasurementDoc = {
  org: { name: string; legal_name: string | null; cr_number: string | null; logoUrl?: string | null };
  client: { name: string };
  contract: { number: string };
  sheet: Omit<Measurement, "photos"> & { photos: string[]; signature: string | null };
};

/** «كشف قياس الأعمال المنفذة» — print-ready (Share → Print / PDF). */
export function MeasurementDocument({ data }: { data: MeasurementDoc }) {
  const t = useTranslations("measure");
  const { fmt } = useFormatter();
  const m = data.sheet;
  const org = data.org.legal_name ?? data.org.name;
  return (
    <article className="relative mx-auto grid min-w-0 max-w-[820px] gap-5 overflow-hidden rounded-3xl border border-border bg-white p-6 text-[14px] leading-7 text-basalt sm:p-10 print:border-0 print:p-0">
      {/* the brand's 45° clay corner */}
      <span aria-hidden className="absolute end-0 top-0 size-10 bg-clay [clip-path:polygon(100%_0,0_0,100%_100%)] rtl:[clip-path:polygon(0_0,100%_0,0_100%)]" />
      <header className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-primary pb-4">
        <div className="flex flex-wrap items-center gap-3">
          {data.org.logoUrl && <BrandLogo src={data.org.logoUrl} label={data.org.name} className="text-basalt" fit="h-auto w-[min(140px,40vw)] max-h-16" />}
          <p className="font-extrabold">{org}</p>
        </div>
        <p className="font-latin text-[13px]">
          <bdi dir="ltr" className="whitespace-nowrap">{m.number}</bdi>
        </p>
      </header>
      <p className="text-center text-[22px] font-extrabold text-primary">{t("docTitle")}</p>
      <dl className="grid gap-2 text-[13px] sm:grid-cols-3">
        <div>
          <dt className="text-doc-muted">{t("client")}</dt>
          <dd className="font-bold">{data.client.name}</dd>
        </div>
        <div>
          <dt className="text-doc-muted">{t("contract")}</dt>
          <dd className="font-bold">
            <bdi dir="ltr">{data.contract.number}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-doc-muted">{t("date")}</dt>
          <dd className="font-bold">{fmt.date(m.sent_at ?? new Date().toISOString())}</dd>
        </div>
      </dl>
      <p className="text-[13px] text-doc-muted">{t("docIntro")}</p>
      <MeasurementTable m={m} />
      {m.notes && <p className="whitespace-pre-line">{m.notes}</p>}
      {m.photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 print:break-inside-avoid">
          {m.photos.map((u) => (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
            <img key={u} src={u} alt="" className="aspect-square w-full rounded-xl object-cover" />
          ))}
        </div>
      )}
      <section className="grid gap-1 border-t border-sand pt-5 print:break-inside-avoid">
        <p className="font-bold">{t("clientSign")}</p>
        {m.status === "approved" && m.client_decided_at ? (
          <>
            <p className="text-[13px]">{t("approvedBy", { name: m.client_name ?? data.client.name, date: fmt.dateTime(m.client_decided_at) })}</p>
            {m.signature && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.signature} alt={t("clientSign")} className="h-20 w-auto self-start" />
            )}
          </>
        ) : (
          <p className="text-[13px] text-doc-muted">{t("notSigned")}</p>
        )}
      </section>
    </article>
  );
}
