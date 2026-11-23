"use client";
import { ReceiptText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFormatter } from "@/components/formatter-provider";

/** List of receipt vouchers, each opening the printable voucher. */
export function ReceiptsList({ items, hrefFor, newTab }: { items: { number: string; label: string; amount: number; paid_on: string }[]; hrefFor: (number: string) => string; newTab?: boolean }) {
  const t = useTranslations("receipt");
  const { fmt } = useFormatter();
  if (!items.length) return null;
  return (
    <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="receipts-title">
      <h2 id="receipts-title" className="text-[18px] font-bold">{t("listTitle")}</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">{t("listHint")}</p>
      <ul className="mt-4 grid gap-2">
        {items.map((r) => (
          <li key={r.number}>
            <a href={hrefFor(r.number)} {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl border border-border px-4 py-3 text-[14px] hover:border-border-strong">
              <span className="flex min-w-0 items-center gap-2">
                <ReceiptText className="size-4 shrink-0 text-primary" />
                <bdi dir="ltr" className="font-latin whitespace-nowrap">{r.number}</bdi>
                <span className="truncate text-muted-foreground">· {r.label}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="text-[12px] text-muted-foreground">{fmt.date(r.paid_on)}</span>
                <span className="font-bold">{fmt.money(r.amount)}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
