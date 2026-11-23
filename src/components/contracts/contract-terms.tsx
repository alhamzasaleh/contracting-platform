"use client";
import { useTranslations } from "next-intl";
import { useFormatter } from "@/components/formatter-provider";
import type { ServiceKind } from "@/lib/pricing";

export type ContractTermsData = {
  number: string;
  service: ServiceKind;
  project_type: "full" | "labour" | "supply";
  start_date: string;
  duration_days: number;
  warranty_months: number;
  total: number;
  notes: string | null;
  method: "unit" | "lump";
  payments: {
    seq: number;
    label: string;
    percent: number;
    amount: number;
    status?: string;
  }[];
  accepted?: { at: string; name: string } | null;
};

/** Contract terms: dates, project type, payment schedule and clauses (app and client page). */
export function ContractTerms({
  data,
  orgName,
  clientName,
}: {
  data: ContractTermsData;
  orgName: string;
  clientName: string;
}) {
  const t = useTranslations("contract");
  const tp = useTranslations("pricing");
  const { fmt } = useFormatter();
  const end = new Date(`${data.start_date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + data.duration_days);

  return (
    <article className="min-w-0 mx-auto grid max-w-[820px] gap-5 rounded-3xl border border-border bg-white p-6 text-[14px] text-neutral-900 sm:p-10 print:border-0 print:p-0">
      <header className="flex items-start justify-between gap-4 border-b-2 border-primary pb-4">
        <div>
          <p className="text-[22px] font-extrabold text-primary">
            {t("title")}
          </p>
          <p className="text-[13px] text-neutral-500">
            {t("between", { org: orgName, client: clientName })}
          </p>
        </div>
        <p className="font-latin text-[13px]">{data.number}</p>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <Item label={t("service")} value={tp(`kind_${data.service}`)} />
        <Item label={t("projectType")} value={tp(`pt_${data.project_type}`)} />
        <Item label={t("start")} value={fmt.date(data.start_date)} />
        <Item
          label={t("duration")}
          value={t("days", { n: data.duration_days })}
        />
        <Item label={t("expectedEnd")} value={fmt.date(end.toISOString())} />
        <Item
          label={t("warranty")}
          value={t("months", { n: data.warranty_months })}
        />
        <Item label={t("total")} value={fmt.money(data.total)} strong />
      </dl>

      <section className="grid gap-2">
        <p className="font-bold">{t("payments")}</p>
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-neutral-100">
                <th className="rounded-s-lg px-3 py-2 text-start">
                  {t("payment")}
                </th>
                <th className="px-3 py-2 text-end">{t("percent")}</th>
                <th className="rounded-e-lg px-3 py-2 text-end">
                  {t("amount")}
                </th>
              </tr>
            </thead>
            <tbody className="font-latin tabular-nums">
              {data.payments.map((p) => (
                <tr key={p.seq} className="border-b border-neutral-200">
                  <td className="px-3 py-2 font-sans">
                    {p.seq}. {p.label}
                  </td>
                  <td className="px-3 py-2 text-end">
                    {fmt.number(p.percent, p.percent % 1 ? 2 : 0)}%
                  </td>
                  <td className="px-3 py-2 text-end">{fmt.money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-1.5 text-[13px] leading-6">
        <p className="font-bold">{t("clauses")}</p>
        <ol className="grid list-decimal gap-1 ps-5">
          <li>{t("c_scope")}</li>
          <li>
            {t("c_start", {
              date: fmt.date(data.start_date),
              days: data.duration_days,
            })}
          </li>
          {data.project_type === "labour" && <li>{t("c_labourOnly")}</li>}
          {data.project_type === "supply" && <li>{t("c_supplyOnly")}</li>}
          <li>{t("c_payments")}</li>
          {data.method === "unit" && <li>{t("c_measure")}</li>}
          <li>{t("c_inspection")}</li>
          <li>{t("c_additional")}</li>
          <li>{t("c_warranty", { n: data.warranty_months })}</li>
          <li>{t("c_notices")}</li>
          <li>{t("c_law")}</li>
          {data.notes && <li className="whitespace-pre-line">{data.notes}</li>}
        </ol>
      </section>

      {data.accepted && (
        <p className="rounded-2xl bg-primary/10 px-4 py-3 text-[13px] text-primary">
          {t("acceptedBy", {
            name: data.accepted.name,
            date: fmt.dateTime(data.accepted.at),
          })}
        </p>
      )}
    </article>
  );
}

function Item({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <dt className="text-[12px] text-neutral-500">{label}</dt>
      <dd
        className={
          strong ? "font-latin text-[16px] font-extrabold" : "text-[14px]"
        }
      >
        {value}
      </dd>
    </div>
  );
}
