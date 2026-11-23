"use client";
import { ltr } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useFormatter } from "@/components/formatter-provider";
import { IncludedList, workItemLabel } from "@/components/quotes/quote-document";
import type { ServiceKind } from "@/lib/pricing";
import type { ClientView } from "@/lib/quotes";

export type ContractTermsData = {
  number: string;
  /** contract date (created) */
  date: string;
  service: ServiceKind;
  project_type: "full" | "labour" | "supply";
  start_date: string;
  duration_days: number;
  warranty_months: number;
  total: number;
  notes: string | null;
  method: "unit" | "lump";
  quoteNumber: string;
  view: ClientView | null;
  payments: { seq: number; label: string; percent: number; amount: number; status?: string }[];
  accepted?: { at: string; name: string } | null;
};

export type ContractOrg = {
  name: string;
  legal_name: string | null;
  cr_number: string | null;
  vat_number: string | null;
  phone: string | null;
  city: string | null;
  address?: string | null;
  signatory_name?: string | null;
  signatory_title?: string | null;
};

export type ContractClient = {
  name: string;
  phone: string | null;
  city: string | null;
  district?: string | null;
  id_number?: string | null;
};

const localPhone = (p: string | null) => (p ? (p.startsWith("966") ? `0${p.slice(3)}` : p) : null);

/** One contract title for one or several services (owner: «عقد أعمال دهانات خارجية» / «عقد أعمال تشطيبات»). */
export function useContractWork() {
  const t = useTranslations("contract");
  return (services: ServiceKind[]) => (services.length === 1 ? t(`work_${services[0]}`) : t("work_finishing"));
}

/**
 * The contract (app, client page, print): parties, preamble, numbered clauses
 * with the scope of works, specifications, value, payments and legal terms.
 */
export function ContractTerms({ data, org, client }: { data: ContractTermsData; org: ContractOrg; client: ContractClient }) {
  const t = useTranslations("contract");
  const td = useTranslations("doc");
  const { fmt } = useFormatter();
  const work = useContractWork()([data.service]);
  const end = new Date(`${data.start_date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + data.duration_days);
  const pt = data.project_type;
  const v = data.view;
  const location = [client.city, client.district].filter(Boolean).join(" — ");

  // numbered clauses, built in order so the numbering always matches
  const clauses: { title: string; body: React.ReactNode }[] = [];
  const add = (title: string, body: React.ReactNode) => clauses.push({ title, body });

  add(t("s_annex"), <p>{t("s_annexBody", { quote: ltr(data.quoteNumber) })}</p>);
  if (v) {
    add(
      t("s_scope"),
      <>
        <p>{t(`s_scope_${pt}`)}</p>
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-sand/35">
                <th className="rounded-s-lg px-3 py-2 text-start">{t("item")}</th>
                <th className="px-3 py-2 text-end">{t("qty")}</th>
                <th className="px-3 py-2 text-end">{t("unitPrice")}</th>
                <th className="rounded-e-lg px-3 py-2 text-end">{t("amount")}</th>
              </tr>
            </thead>
            <tbody className="font-latin tabular-nums">
              {v.workTypes
                .filter((w) => w.area > 0)
                .map((w) => (
                  <tr key={w.workType} className="border-b border-sand">
                    <td className="px-3 py-2 font-sans font-bold">{workItemLabel(td, v.service, w.workType)}</td>
                    <td className="px-3 py-2 text-end">{fmt.number(w.area, 2)} m²</td>
                    <td className="px-3 py-2 text-end">{fmt.money(w.pricePerM2)}</td>
                    <td className="px-3 py-2 text-end">{fmt.money(w.total)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </>,
    );
    add(
      t("s_specs"),
      <>
        <p>{t("s_specsBody")}</p>
        <IncludedList view={v} />
      </>,
    );
  }
  add(
    t("s_value"),
    <>
      <p>{(v?.vatPercent ?? 0) > 0 ? t("s_valueVat", { total: fmt.money(data.total) }) : t("s_valueNoVat", { total: fmt.money(data.total) })}</p>
      <p>{data.method === "unit" ? t("s_valueUnit") : t("s_valueLump")}</p>
    </>,
  );
  add(
    t("s_payments"),
    <>
      <p>{t("s_paymentsBody")}</p>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-sand/35">
              <th className="rounded-s-lg px-3 py-2 text-start">{t("payment")}</th>
              <th className="px-3 py-2 text-end">{t("percent")}</th>
              <th className="rounded-e-lg px-3 py-2 text-end">{t("amount")}</th>
            </tr>
          </thead>
          <tbody className="font-latin tabular-nums">
            {data.payments.map((p) => (
              <tr key={p.seq} className="border-b border-sand">
                <td className="px-3 py-2 font-sans">
                  {p.seq}. {p.label}
                </td>
                <td className="px-3 py-2 text-end">{fmt.number(p.percent, p.percent % 1 ? 2 : 0)}%</td>
                <td className="px-3 py-2 text-end">{fmt.money(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>{t("s_paymentsLate")}</p>
    </>,
  );
  add(
    t("s_duration"),
    <>
      <p>{t("s_durationBody", { days: data.duration_days, start: fmt.date(data.start_date), end: fmt.date(end.toISOString()) })}</p>
      {pt === "labour" && <p>{t("s_durationLabour")}</p>}
    </>,
  );
  add(
    t("s_first"),
    <ul className="grid list-disc gap-0.5 ps-5">
      {pt !== "supply" && <li>{t("o1_execute")}</li>}
      {pt !== "labour" && <li>{t("o1_supply")}</li>}
      {pt !== "supply" && <li>{t("o1_safety")}</li>}
      {pt !== "supply" && <li>{t("o1_clean")}</li>}
      {pt !== "supply" && <li>{t("o1_warranty")}</li>}
    </ul>,
  );
  add(
    t("s_second"),
    <ul className="grid list-disc gap-0.5 ps-5">
      {pt !== "supply" && <li>{t("o2_site")}</li>}
      {pt !== "supply" && <li>{t("o2_utilities")}</li>}
      <li>{t("o2_approve")}</li>
      {pt === "labour" && <li>{t("o2_materials")}</li>}
      <li>{t("o2_pay")}</li>
    </ul>,
  );
  add(t("s_handover"), <p>{t("s_handoverBody")}</p>);
  add(t("s_additional"), <p>{t("s_additionalBody")}</p>);
  if (pt !== "supply") add(t("s_warranty"), <p>{t("s_warrantyBody", { n: data.warranty_months })}</p>);
  add(t("s_termination"), <p>{t("s_terminationBody")}</p>);
  add(t("s_force"), <p>{t("s_forceBody")}</p>);
  add(t("s_notices"), <p>{t("s_noticesBody")}</p>);
  add(t("s_law"), <p>{org.city ? t("s_lawBody", { city: org.city }) : t("s_lawBodyNoCity")}</p>);
  if (data.notes) add(t("s_extra"), <p className="whitespace-pre-line">{data.notes}</p>);
  add(t("s_signing"), <p>{t("s_signingBody")}</p>);

  const orgName = org.legal_name ?? org.name;
  return (
    <article className="mx-auto grid min-w-0 max-w-[820px] gap-5 rounded-3xl border border-border bg-white p-6 text-[14px] leading-7 text-basalt sm:p-10 print:border-0 print:p-0">
      <header className="flex items-start justify-between gap-4 border-b-2 border-primary pb-4">
        <p className="text-[22px] font-extrabold text-primary">{t("docTitle", { work })}</p>
        <div className="text-end">
          <p className="font-latin text-[13px]"><bdi dir="ltr" className="whitespace-nowrap">{data.number}</bdi></p>
          <p className="font-latin text-[12px] text-doc-muted">{fmt.date(data.date)}</p>
        </div>
      </header>

      <p>{t("intro", { date: fmt.date(data.date) })}</p>

      <section className="grid gap-3 sm:grid-cols-2">
        <Party title={t("firstParty")} name={orgName}>
          {org.cr_number && <li>{t("p_cr", { n: org.cr_number })}</li>}
          {org.vat_number && <li>{t("p_vat", { n: org.vat_number })}</li>}
          {(org.address || org.city) && <li>{t("p_address", { a: [org.address, org.city].filter(Boolean).join("، ") })}</li>}
          {org.phone && <li>{t("p_phone", { p: localPhone(org.phone)! })}</li>}
          {org.signatory_name && (
            <li>{org.signatory_title ? t("p_rep", { name: org.signatory_name, title: org.signatory_title }) : t("p_repNoTitle", { name: org.signatory_name })}</li>
          )}
        </Party>
        <Party title={t("secondParty")} name={client.name}>
          <li>{client.id_number ? t("p_id", { n: client.id_number }) : t("p_idMissing")}</li>
          {client.phone && <li>{t("p_phone", { p: localPhone(client.phone)! })}</li>}
          {location && <li>{t("p_location", { loc: location })}</li>}
        </Party>
      </section>

      <section className="grid gap-1">
        <p className="font-bold">{t("preambleTitle")}</p>
        <p>{t("preamble", { work })}</p>
      </section>

      <ol className="grid gap-4">
        {clauses.map((c, i) => (
          <li key={i} className="grid gap-1.5">
            <p className="font-bold text-primary">
              {t("clauseN", { n: i + 1 })}: {c.title}
            </p>
            <div className="grid gap-1.5 text-[13.5px]">{c.body}</div>
          </li>
        ))}
      </ol>

      <section className="grid gap-4 border-t border-sand pt-5 sm:grid-cols-2">
        <div className="grid gap-1">
          <p className="font-bold">{t("firstParty")}</p>
          <p className="text-[13px]">{orgName}</p>
          {org.signatory_name && <p className="text-[13px]">{t("sigName", { name: org.signatory_name })}</p>}
        </div>
        <div className="grid gap-1">
          <p className="font-bold">{t("secondParty")}</p>
          {data.accepted ? (
            <p className="rounded-2xl bg-primary/10 px-3 py-2 text-[13px] text-primary">{t("acceptedBy", { name: data.accepted.name, date: fmt.dateTime(data.accepted.at) })}</p>
          ) : (
            <p className="text-[13px] text-doc-muted">{t("sigAwaiting")}</p>
          )}
        </div>
      </section>
    </article>
  );
}

function Party({ title, name, children }: { title: string; name: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-1 rounded-2xl bg-sand/35 p-4">
      <p className="text-[12px] font-bold text-primary">{title}</p>
      <p className="text-[15px] font-extrabold">{name}</p>
      <ul className="grid gap-0.5 text-[13px] text-doc-muted">{children}</ul>
    </div>
  );
}
