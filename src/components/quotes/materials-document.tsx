"use client";
import { ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BrandLogo } from "@/components/brand-logo";
import { DocNo } from "@/components/doc-no";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFormatter } from "@/components/formatter-provider";
import { useListSep, useUnitText } from "@/components/forms/form-kit";
import type { MaterialsDoc } from "@/lib/data/materials";
import type { MaterialRow } from "@/lib/quotes/materials";
import { useBuyText, useQtyNumber } from "./buy-text";
import { PrintButton } from "./print-button";
import type { DocOrg } from "./quote-document";

/**
 * جدول الكميات — print-grade bill of quantities for the purchaser: per material, pack size and
 * colour the packs to buy, the quantity needed and the expected leftover; for a project also what
 * was bought and what is still to buy; estimated prices only when the server sent them.
 * A table on paper and wide screens, one card per material on a phone.
 */
export function MaterialsDocument({ org, doc }: { org: DocOrg; doc: MaterialsDoc }) {
  const t = useTranslations("materials");
  const tp = useTranslations("pricing");
  const td = useTranslations("doc");
  const { fmt } = useFormatter();
  const unitText = useUnitText();
  const buyText = useBuyText();
  const qn = useQtyNumber();
  const sep = useListSep();
  const total = doc.prices ? doc.rows.reduce((s, r) => s + (r.cost ?? 0), 0) : 0;
  const unpriced = doc.prices ? doc.rows.filter((r) => r.unpriced).length : 0;
  const phone = doc.client.phone ? (doc.client.phone.startsWith("966") ? `0${doc.client.phone.slice(3)}` : doc.client.phone) : null;

  const size = (r: MaterialRow) => (r.size != null ? t("sizeValue", { size: qn(r.size), unit: unitText(r.sizeUnit) }) : "—");
  const need = (r: MaterialRow) => (r.need != null ? `${qn(r.need)} ${unitText(r.needUnit)}` : "—");
  const buy = (r: MaterialRow) => buyText([{ count: r.count, size: null, sizeUnit: null, unit: r.unit }]);
  const leftover = (r: MaterialRow) => (r.leftover != null ? `${qn(r.leftover)} ${unitText(r.sizeUnit)}` : "—");
  const count = (r: MaterialRow, x: number | undefined) => buyText([{ count: x ?? 0, size: null, sizeUnit: null, unit: r.unit }]);

  return (
    <article className="relative mx-auto grid min-w-0 max-w-[1000px] gap-6 overflow-hidden rounded-3xl border border-border bg-white p-5 text-[14px] text-basalt sm:p-10 print:max-w-none print:rounded-none print:border-0 print:px-0 print:pb-0 print:pt-8">
      {/* the priced table has up to 11 columns: printed / PDF on a landscape page, or its last columns (cost, total) were cut off */}
      <style>{"@page { size: A4 landscape; }"}</style>
      <span aria-hidden className="absolute end-0 top-0 size-10 bg-clay [clip-path:polygon(0_0,100%_0,100%_100%)] rtl:[clip-path:polygon(0_0,100%_0,0_100%)] print:size-8" />
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-primary pb-4">
        <div className="flex flex-wrap items-center gap-3">
          {org.logoUrl && <BrandLogo src={org.logoUrl} label={org.name} className="text-basalt" fit="h-auto w-[min(140px,40vw)] max-h-16" />}
          <div className="text-[12px] leading-6 text-doc-muted">
            <p className="text-[16px] font-extrabold text-basalt">{org.legal_name ?? org.name}</p>
            <p>{[org.cr_number && td("cr", { n: org.cr_number }), org.vat_number && td("vat", { n: org.vat_number })].filter(Boolean).join(" · ")}</p>
            {(org.phone || org.city) && <p>{[org.city, org.phone].filter(Boolean).join(sep)}</p>}
          </div>
        </div>
        <div className="text-end">
          <p className="text-[22px] font-extrabold text-primary">{t("title")}</p>
          <p className="text-[12px] text-doc-muted">{doc.kind === "project" ? t("subtitleProject") : t("subtitleQuote")}</p>
          <p className="text-[13px]"><DocNo>{doc.number}</DocNo></p>
          <p className="text-[12px] text-doc-muted">{doc.prices ? t("modePriced") : t("modeQuantities")}</p>
          {doc.option && <p className="text-[12px] font-bold">{t("option", { label: doc.option })}</p>}
        </div>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr_auto_1fr]">
        <dt className="text-doc-muted">{t("client")}</dt>
        <dd className="font-semibold">
          {doc.client.name}
          {(doc.client.city || phone) && <span className="block text-[12px] font-normal text-doc-muted">{[doc.client.city, phone].filter(Boolean).join(sep)}</span>}
        </dd>
        <dt className="text-doc-muted">{t("service")}</dt>
        <dd>{tp(`kind_${doc.service}`)}</dd>
        {doc.kind === "project" && (
          <>
            <dt className="text-doc-muted">{t("contract")}</dt>
            <dd><DocNo>{doc.number}</DocNo></dd>
          </>
        )}
        <dt className="text-doc-muted">{t("quote")}</dt>
        <dd>
          <DocNo>{doc.quoteNumber}</DocNo> · {t("version", { n: doc.version })}
          {doc.option && <span className="block font-semibold">{t("option", { label: doc.option })}</span>}
        </dd>
        <dt className="text-doc-muted">{t("date")}</dt>
        <dd>{fmt.date(doc.date)}</dd>
      </dl>

      {doc.rows.length === 0 ? (
        <p className="rounded-2xl bg-gypsum px-5 py-4 text-doc-muted">{t("empty")}</p>
      ) : (
        <>
          {/* paper and wide screens */}
          <table className="hidden w-full border-collapse text-[13px] lg:table print:table">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                <th className="rounded-s-lg px-2.5 py-2 text-start font-bold">{t("colMaterial")}</th>
                <th className="px-2.5 py-2 text-start font-bold">{t("colBrand")}</th>
                <th className="px-2.5 py-2 text-start font-bold">{t("colSize")}</th>
                <th className="px-2.5 py-2 text-start font-bold">{t("colColour")}</th>
                <th className="px-2.5 py-2 text-end font-bold">{t("colNeed")}</th>
                <th className="px-2.5 py-2 text-end font-bold">{t("colBuy")}</th>
                <th className={`px-2.5 py-2 text-end font-bold ${!doc.bought && !doc.prices ? "rounded-e-lg" : ""}`}>{t("colLeftover")}</th>
                {doc.bought && (
                  <>
                    <th className="px-2.5 py-2 text-end font-bold">{t("colBought")}</th>
                    <th className={`px-2.5 py-2 text-end font-bold ${!doc.prices ? "rounded-e-lg" : ""}`}>{t("colRemaining")}</th>
                  </>
                )}
                {doc.prices && (
                  <>
                    <th className="px-2.5 py-2 text-end font-bold">{t("colUnitPrice")}</th>
                    <th className="rounded-e-lg px-2.5 py-2 text-end font-bold">{t("colCost")}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {doc.rows.map((r) => (
                <tr key={r.key} className="break-inside-avoid border-b border-sand/70 align-top">
                  <td className="px-2.5 py-2 font-semibold">{r.material}</td>
                  <td className="px-2.5 py-2">{r.brand ?? "—"}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{size(r)}</td>
                  <td className="px-2.5 py-2">{r.colour ?? "—"}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-end tabular-nums">{need(r)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-end font-bold tabular-nums">{buy(r)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-end tabular-nums text-doc-muted">{leftover(r)}</td>
                  {doc.bought && (
                    <>
                      <td className="whitespace-nowrap px-2.5 py-2 text-end tabular-nums">{count(r, r.bought)}</td>
                      <td className="whitespace-nowrap px-2.5 py-2 text-end font-bold tabular-nums text-primary">{count(r, r.remaining)}</td>
                    </>
                  )}
                  {doc.prices && (
                    <>
                      <td className="whitespace-nowrap px-2.5 py-2 text-end tabular-nums">{r.unpriced ? <NoPrice /> : fmt.money(r.unitPrice ?? 0)}</td>
                      <td className="whitespace-nowrap px-2.5 py-2 text-end tabular-nums">{r.unpriced ? "—" : fmt.money(r.cost ?? 0)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            {/* a second tbody, not tfoot: a printed tfoot repeats at the foot of every page and reads as that page's total */}
            {doc.prices && (
              <tbody>
                <tr className="font-bold">
                  <td colSpan={doc.bought ? 10 : 8} className="px-2.5 pt-3 text-end">{t("total")}</td>
                  <td className="whitespace-nowrap px-2.5 pt-3 text-end tabular-nums">{fmt.money(total)}</td>
                </tr>
              </tbody>
            )}
          </table>

          {/* phone: one card per material */}
          <ul className="grid gap-2 lg:hidden print:hidden">
            {doc.rows.map((r) => (
              <li key={r.key} className="grid gap-2 rounded-2xl border border-sand p-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="min-w-0 font-bold">{r.material}</p>
                  <p className="text-[12px] text-doc-muted">{[r.brand, r.colour].filter(Boolean).join(sep) || "—"}</p>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
                  <dt className="text-doc-muted">{t("colSize")}</dt>
                  <dd className="text-end">{size(r)}</dd>
                  <dt className="text-doc-muted">{t("colNeed")}</dt>
                  <dd className="text-end tabular-nums">{need(r)}</dd>
                  <dt className="font-bold">{t("colBuy")}</dt>
                  <dd className="text-end font-bold tabular-nums">{buy(r)}</dd>
                  <dt className="text-doc-muted">{t("colLeftover")}</dt>
                  <dd className="text-end tabular-nums">{leftover(r)}</dd>
                  {doc.bought && (
                    <>
                      <dt className="text-doc-muted">{t("colBought")}</dt>
                      <dd className="text-end tabular-nums">{count(r, r.bought)}</dd>
                      <dt className="font-bold text-primary">{t("colRemaining")}</dt>
                      <dd className="text-end font-bold tabular-nums text-primary">{count(r, r.remaining)}</dd>
                    </>
                  )}
                  {doc.prices && (
                    <>
                      <dt className="text-doc-muted">{t("colUnitPrice")}</dt>
                      <dd className="text-end tabular-nums">{r.unpriced ? <NoPrice /> : fmt.money(r.unitPrice ?? 0)}</dd>
                      <dt className="text-doc-muted">{t("colCost")}</dt>
                      <dd className="text-end tabular-nums">{r.unpriced ? "—" : fmt.money(r.cost ?? 0)}</dd>
                    </>
                  )}
                </dl>
              </li>
            ))}
            {doc.prices && (
              <li className="flex flex-wrap items-baseline justify-between gap-2 rounded-2xl bg-gypsum px-4 py-3 font-bold">
                <span>{t("total")}</span>
                <span className="tabular-nums">{fmt.money(total)}</span>
              </li>
            )}
          </ul>
        </>
      )}

      <footer className="grid gap-1 border-t border-sand pt-4 text-[12px] leading-6 text-doc-muted">
        <p>{t("note")}</p>
        {doc.bought && <p>{t("noteBought")}</p>}
        {doc.prices && <p>{t("notePriced")}</p>}
        {unpriced > 0 && <p className="font-bold text-danger">{t("totalIncomplete", { n: unpriced })}</p>}
      </footer>
    </article>
  );
}

function NoPrice() {
  const t = useTranslations("materials");
  return <Badge tone="warning">{t("noPrice")}</Badge>;
}

/**
 * The bill-of-quantities page around the document: «كميات فقط» / «بالأسعار التقديرية» switch
 * (the priced one only for costs.view), «تسجيل مشتريات للمشروع» (accepted project,
 * purchases.manage), PDF download and print. `path` = /print/<quotations|contracts>/<number>/materials;
 * `base` prefixes the in-app links (the design preview).
 */
export function MaterialsScreen({ org, doc, path, base = "" }: { org: DocOrg; doc: MaterialsDoc; path: string; base?: string }) {
  const t = useTranslations("materials");
  const tab = (active: boolean) => cn("rounded-full px-4 py-1.5 text-[13px] font-medium", active ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:text-foreground");
  const current = doc.prices ? `${path}/priced` : path;
  return (
    <>
      <div className="mx-auto mb-4 flex max-w-[1000px] flex-wrap items-center justify-between gap-3 px-4 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          {doc.canPrices && (
            <nav className="flex flex-wrap gap-1 rounded-full border border-border bg-surface p-1">
              <Link href={`${base}${path}`} className={tab(!doc.prices)} aria-current={!doc.prices ? "page" : undefined}>{t("modeQuantities")}</Link>
              <Link href={`${base}${path}/priced`} className={tab(doc.prices)} aria-current={doc.prices ? "page" : undefined}>{t("modePriced")}</Link>
            </nav>
          )}
          {doc.kind === "project" && doc.canPurchase && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`${base}/purchases/new?project=${doc.number}`}>
                <ShoppingCart /> {t("recordPurchase")}
              </Link>
            </Button>
          )}
        </div>
        <PrintButton pdfHref={`/api/pdf/${current.split("/").slice(2).join("/")}`} />
      </div>
      <div className="px-4 print:px-0">
        <MaterialsDocument org={org} doc={doc} />
      </div>
    </>
  );
}
