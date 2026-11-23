"use client";
import { useTranslations } from "next-intl";
import { useFormatter } from "@/components/formatter-provider";
import { STEPS } from "@/lib/pricing";
import type { ClientView } from "@/lib/quotes";

export type DocOrg = {
  name: string;
  legal_name: string | null;
  cr_number: string | null;
  vat_number: string | null;
  phone: string | null;
  city: string | null;
  logoUrl: string | null;
};

/**
 * The quote as the client sees it (screen and print). Never titled "tax
 * invoice"; VAT appears only when the company is VAT-registered.
 */
export function QuoteDocument({
  org,
  number,
  version,
  date,
  validUntil,
  client,
  view,
  notes,
  warrantyMonths,
}: {
  org: DocOrg;
  number: string;
  version: number;
  date: string;
  validUntil: string | null;
  client: { name: string; phone: string | null; city: string | null };
  view: ClientView;
  notes: string | null;
  warrantyMonths: number;
}) {
  const t = useTranslations("doc");
  const tp = useTranslations("pricing");
  const { fmt } = useFormatter();
  const phone = client.phone
    ? client.phone.startsWith("966")
      ? `0${client.phone.slice(3)}`
      : client.phone
    : null;

  return (
    <article className="min-w-0 quote-doc mx-auto grid max-w-[820px] gap-6 rounded-3xl border border-border bg-white p-6 text-[14px] text-neutral-900 sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0">
      <header className="flex items-start justify-between gap-6 border-b-2 border-primary pb-5">
        <div className="flex items-center gap-4">
          {org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={org.logoUrl}
              alt=""
              className="h-16 w-auto object-contain"
            />
          ) : (
            <span className="flex size-14 items-center justify-center rounded-t-full bg-primary text-[22px] font-bold text-primary-foreground">
              {org.name.slice(0, 1)}
            </span>
          )}
          <div>
            <p className="text-[18px] font-extrabold">
              {org.legal_name ?? org.name}
            </p>
            <p className="text-[12px] text-neutral-500">
              {[
                org.cr_number && t("cr", { n: org.cr_number }),
                org.vat_number && t("vat", { n: org.vat_number }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {(org.phone || org.city) && (
              <p className="font-latin text-[12px] text-neutral-500">
                {[org.city, org.phone].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>
        <div className="text-end">
          <p className="text-[22px] font-extrabold text-primary">
            {t("title")}
          </p>
          <p className="font-latin text-[13px]">{number}</p>
          <p className="text-[12px] text-neutral-500">
            {t("version", { n: version })}
          </p>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[12px] text-neutral-500">{t("to")}</p>
          <p className="text-[16px] font-bold">{client.name}</p>
          <p className="text-[13px] text-neutral-600">
            {[client.city, phone].filter(Boolean).join(" · ")}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:justify-self-end">
          <dt className="text-neutral-500">{t("date")}</dt>
          <dd className="font-latin">{fmt.date(date)}</dd>
          {validUntil && (
            <>
              <dt className="text-neutral-500">{t("validUntil")}</dt>
              <dd className="font-latin">{fmt.date(validUntil)}</dd>
            </>
          )}
          <dt className="text-neutral-500">{t("service")}</dt>
          <dd>{tp(`kind_${view.service}`)}</dd>
          <dt className="text-neutral-500">{t("projectType")}</dt>
          <dd>{tp(`pt_${view.options.projectType ?? "full"}`)}</dd>
        </dl>
      </section>

      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-primary text-primary-foreground">
              <th className="rounded-s-lg px-3 py-2 text-start font-bold">
                {t("item")}
              </th>
              <th className="px-3 py-2 text-end font-bold">{t("area")}</th>
              <th className="px-3 py-2 text-end font-bold">{t("unitPrice")}</th>
              <th className="rounded-e-lg px-3 py-2 text-end font-bold">
                {t("amount")}
              </th>
            </tr>
          </thead>
          <tbody className="font-latin tabular-nums">
            {view.workTypes.map((w) => (
              <tr key={w.workType} className="border-b border-neutral-200">
                <td className="px-3 py-2.5 font-sans font-bold">
                  {workItemLabel(t, view.service, w.workType)}
                </td>
                <td className="px-3 py-2.5 text-end">
                  {fmt.number(w.area, 2)} m²
                </td>
                <td className="px-3 py-2.5 text-end">
                  {fmt.money(w.pricePerM2)}
                </td>
                <td className="px-3 py-2.5 text-end">{fmt.money(w.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ms-auto grid w-full max-w-xs gap-1.5 text-[14px]">
        <div className="flex justify-between">
          <dt>{t("subtotal")}</dt>
          <dd className="font-latin tabular-nums">
            {fmt.money(view.subtotal)}
          </dd>
        </div>
        {view.discount > 0 && (
          <div className="flex justify-between text-primary">
            <dt>
              {view.discountPercent
                ? t("discountPct", { n: view.discountPercent })
                : t("discount")}
            </dt>
            <dd className="font-latin tabular-nums">
              − {fmt.money(view.discount)}
            </dd>
          </div>
        )}
        {view.vatPercent > 0 && (
          <div className="flex justify-between">
            <dt>{t("vatLine", { n: view.vatPercent })}</dt>
            <dd className="font-latin tabular-nums">{fmt.money(view.vat)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t-2 border-neutral-900 pt-2 text-[17px] font-extrabold">
          <dt>{t("total")}</dt>
          <dd className="font-latin tabular-nums">{fmt.money(view.total)}</dd>
        </div>
        {view.vatPercent === 0 && (
          <p className="text-[11px] text-neutral-500">{t("noVat")}</p>
        )}
      </dl>

      {/* Only what the price includes — what isn't included is not mentioned to the client (owner). */}
      <section>
        <div>
          <p className="mb-1.5 font-bold text-primary">{t("includes")}</p>
          <IncludedList view={view} />
        </div>
      </section>

      <section className="grid gap-1.5 rounded-2xl bg-neutral-100 p-4 text-[12px] leading-6 text-neutral-700 print:bg-neutral-100">
        <p className="font-bold">{t("terms")}</p>
        {view.options.projectType === "labour" && (
          <p>• {t("termLabourOnly")}</p>
        )}
        {view.options.projectType === "supply" && (
          <p>• {t("termSupplyOnly")}</p>
        )}
        {view.method === "unit" && <p>• {t("termUnit")}</p>}
        {view.estimated && <p>• {t("termEstimated")}</p>}
        <p>• {t("termWarranty", { n: warrantyMonths })}</p>
        {validUntil && (
          <p>• {t("termValidity", { date: fmt.date(validUntil) })}</p>
        )}
        {notes && <p className="whitespace-pre-line">• {notes}</p>}
      </section>
    </article>
  );
}

/** Professional item name per service, e.g. "دهانات الواجهات الخارجية". */
export function workItemLabel(t: ReturnType<typeof useTranslations<"doc">>, service: string, workType: string): string {
  const key = `item_${service}_${workType}`;
  return t.has(key as "title") ? t(key as "title") : workType;
}

/** What the price includes: each chosen step with brand and coats, features, labour. */
export function IncludedList({ view }: { view: ClientView }) {
  const t = useTranslations("doc");
  const tp = useTranslations("pricing");
  const { fmt } = useFormatter();
  const steps = STEPS[view.service];
  const stepDef = (k: string) => steps.find((s) => s.key === k);
  const hatches = Object.entries(view.features.hatches ?? {}).filter(([, c]) => c > 0);
  return (
    <ul className="grid gap-x-6 gap-y-1 text-[13px] leading-6 sm:grid-cols-2">
      {view.included.map((i) => {
        const def = stepDef(i.step);
        const coats = (def?.coats ?? [])
          .filter((k) => (i.coats[k.key] ?? 0) > 0)
          .map((k) => `${tp(`slot_${k.key}`)} ${tp("coats", { n: i.coats[k.key] })}`);
        return (
          <li key={i.step}>
            • {tp(`step_${i.step}`)}
            {i.brand && ` — ${i.brand}`}
            {coats.length > 0 && <span className="text-neutral-500"> ({coats.join("، ")})</span>}
          </li>
        );
      })}
      {view.features.troughM > 0 && <li>• {t("featureTrough", { m: fmt.number(view.features.troughM, 1) })}</li>}
      {view.features.shadowM > 0 && <li>• {t("featureShadow", { m: fmt.number(view.features.shadowM, 1) })}</li>}
      {hatches.map(([size, c]) => (
        <li key={size}>• {t("featureHatch", { size: size.replace("x", "×"), n: c })}</li>
      ))}
      {view.options.projectType !== "supply" && <li>• {t("labour")}</li>}
    </ul>
  );
}
