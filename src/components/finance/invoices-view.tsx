"use client";
import { AlertTriangle, FileText } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import type { InvoicesPageData } from "@/lib/data/invoices";
import { invoiceRemaining, invoiceStatus, type InvoiceStatus } from "@/lib/invoices";

const TONE: Record<InvoiceStatus, "success" | "warning" | "danger" | "neutral"> = { paid: "success", partial: "warning", overdue: "danger", due: "neutral" };
type Filter = "all" | "open" | "overdue" | "paid";

/** All invoices: what's billed, received and outstanding; each opens the printable invoice. */
export function InvoicesView({ data, base = "", today }: { data: InvoicesPageData; base?: string; today: string }) {
  const t = useTranslations("invoice");
  const { fmt } = useFormatter();
  const [filter, setFilter] = React.useState<Filter>("open");
  const rows = data.invoices.map((i) => ({ ...i, status: invoiceStatus(i, today) }));
  const shown = rows.filter((i) => filter === "all" || (filter === "paid" ? i.status === "paid" : filter === "overdue" ? i.status === "overdue" : i.status !== "paid"));
  const sum = (f: (i: (typeof rows)[number]) => number) => rows.reduce((s, i) => s + f(i), 0);
  const kpis = [
    { label: t("kBilled"), value: sum((i) => i.total) },
    { label: t("kReceived"), value: sum((i) => Math.min(i.paid, i.total)) },
    { label: t("kOutstanding"), value: sum((i) => invoiceRemaining(i)), tone: "text-primary" },
    { label: t("kOverdue"), value: sum((i) => (i.status === "overdue" ? invoiceRemaining(i) : 0)), tone: "text-danger" },
  ];
  return (
    <div className="grid gap-6">
      {data.vatRegistered && !data.qoyodEnabled && (
        <p className="flex gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t("vatNeedsQoyod")}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-3xl border border-border bg-surface p-4">
            <p className="text-[13px] text-muted-foreground">{k.label}</p>
            <p className={`mt-1 text-[clamp(1rem,5vw,1.375rem)] font-extrabold break-words ${k.tone ?? ""}`}>{fmt.money(k.value)}</p>
          </div>
        ))}
      </div>
      <Segmented<Filter>
        name={t("filter")}
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: t("fAll") },
          { value: "open", label: t("fOpen") },
          { value: "overdue", label: t("fOverdue") },
          { value: "paid", label: t("fPaid") },
        ]}
      />
      {shown.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{data.invoices.length ? t("emptyFilter") : t("empty")}</p>
      ) : (
        <ul className="grid gap-2">
          {shown.map((i) => (
            <li key={i.id}>
              <Link href={`${base}/invoices/${i.number}`} className="grid gap-2 rounded-2xl border border-border bg-surface px-4 py-3 hover:border-primary/40 sm:grid-cols-[1fr_auto] sm:items-center">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 font-bold">
                    <FileText className="size-4 text-primary" />
                    <bdi dir="ltr" className="font-latin">{i.number}</bdi>
                    <span className="font-normal text-muted-foreground">· {i.client}</span>
                  </span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    <bdi dir="ltr" className="font-latin">{i.contract}</bdi> · {i.description} · {t("dueOn", { date: fmt.date(i.due_date) })}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {i.qoyod === "done" && <Badge tone="info">{t("inQoyod")}</Badge>}
                  <Badge tone={TONE[i.status]}>{t(`st_${i.status}`)}</Badge>
                  <span className="font-bold tabular-nums">{fmt.money(i.total)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Links under an invoice: its contract (only for quotes.view — else plain text) and the receipt vouchers it was paid with. */
export function InvoiceLinks({ contract, canViewContract, receipts, base = "" }: { contract: string; canViewContract: boolean; receipts: { number: string; amount: number }[]; base?: string }) {
  const t = useTranslations("invoice");
  const { fmt } = useFormatter();
  const no = <bdi dir="ltr" className="font-latin">{contract}</bdi>;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
      {canViewContract ? (
        <Link href={`${base}/contracts/${contract}`} className="text-primary hover:underline">
          {t("contractLink")} {no}
        </Link>
      ) : (
        <span className="text-muted-foreground" data-testid="invoice-contract-text">
          {t("contractLink")} {no}
        </span>
      )}
      {receipts.map((r) => (
        <Link key={r.number} href={`${base}/print/receipts/${r.number}`} target="_blank" className="text-primary hover:underline">
          {t("receiptLink")} <bdi dir="ltr" className="font-latin">{r.number}</bdi> · {fmt.money(r.amount)}
        </Link>
      ))}
    </p>
  );
}
