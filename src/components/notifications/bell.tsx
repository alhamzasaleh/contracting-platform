"use client";
import { Bell, Check, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { markNotificationsRead } from "@/app/(app)/notifications/actions";
import { decideFromDashboard } from "@/app/(app)/reports/actions";
import { useFormatter } from "@/components/formatter-provider";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { NotificationItem } from "@/lib/notifications";
import { cn, ltr } from "@/lib/utils";
import { settle } from "@/lib/client/action";
import { useFailureText } from "@/lib/client/failure-text";

type Data = { items: NotificationItem[]; unread: number; canDecide: boolean };

/** Topbar bell: latest notifications, approve/reject inline, mark as read. */
export function NotificationBell({ data, base, preview }: { data: Data; base: string; preview: boolean }) {
  const t = useTranslations("notify");
  const tc = useTranslations("common");
  const failure = useFailureText();
  const router = useRouter();
  const { fmt } = useFormatter();
  const [items, setItems] = React.useState(data.items);
  const [unread, setUnread] = React.useState(data.unread);
  const [pending, startTransition] = React.useTransition();
  const [prev, setPrev] = React.useState(data);
  if (prev !== data) {
    setPrev(data);
    setItems(data.items);
    setUnread(data.unread);
  }

  const markRead = (id?: string) => {
    setItems((xs) => xs.map((x) => (!id || x.id === id ? { ...x, read: true } : x)));
    setUnread((n) => (id ? Math.max(0, n - (items.find((x) => x.id === id && !x.read) ? 1 : 0)) : 0));
    // best effort: the bell is already updated here; a failed call is retried with the next read
    if (!preview) void settle(() => markNotificationsRead(id ? { id } : {}));
  };

  const decide = (n: NotificationItem, decision: "approved" | "rejected") => {
    const approval_id = String(n.params.approval_id ?? "");
    if (preview) return toast(tc("saved"));
    startTransition(async () => {
      const r = await settle(() => decideFromDashboard({ approval_id, decision }));
      if (r.ok) {
        toast.success(decision === "approved" ? t("approved") : t("rejected"));
        markRead(n.id);
        router.refresh();
      } else toast.error(failure(r.error) ?? tc("error"));
    });
  };

  const text = (n: NotificationItem) => {
    const p = n.params;
    const s = (k: string) => (p[k] == null ? "" : String(p[k]));
    const number = ltr(s("number"));
    switch (n.kind) {
      case "approval":
      case "approval_reminder":
        return t(n.kind, { what: t.has(`ap_${s("kind")}`) ? t(`ap_${s("kind")}`) : "", number });
      case "client_note":
        return t("client_note", { number, body: s("body") });
      case "stage_confirmed":
        return p.final ? t("stage_final", { number }) : t("stage_confirmed", { number, stage: s("stage") });
      case "contract_accepted":
        return t("contract_accepted", { number, name: s("name") });
      case "addendum_accepted":
        return t("addendum_accepted", { number, title: s("title") });
      case "payment_received":
        return t("payment_received", { amount: fmt.money(Number(p.amount ?? 0)), label: s("label"), number });
      case "payment_late":
        return t("payment_late", { days: fmt.number(Number(p.days ?? 0)), amount: fmt.money(Number(p.amount ?? 0)), label: s("label"), number });
      case "maintenance_request":
        return t("maintenance_request", { number: ltr(s("number")), contract: ltr(s("contract")), body: s("body") });
      case "project_delay":
        return t("project_delay", { number, client: s("client"), days: fmt.number(Number(p.days ?? 0)) });
      case "project_over_budget":
        return t("project_over_budget", { number, client: s("client"), percent: fmt.number(Number(p.percent ?? 0)) });
      case "project_losing":
        return t(Number(p.profit) < 0 ? "project_losing" : "project_low", { number, client: s("client"), profit: fmt.money(Number(p.profit ?? 0)) });
      case "missed_visit":
        return t("missed_visit", { number, client: s("client"), days: fmt.number(Number(p.days ?? 0)) });
      case "agreement_review":
        return t("agreement_review", { number, addendum: ltr(s("addendum")), count: fmt.number(Number(p.count ?? 0)) });
      case "quote_accepted":
        return t("quote_accepted", { number, name: s("name") });
      case "quote_changes_requested":
        return t("quote_changes_requested", { number, note: s("note") });
      case "quote_rejected":
        return s("note") ? t("quote_rejected_reason", { number, note: s("note") }) : t("quote_rejected", { number });
      case "doc_expiry":
        return Number(p.days) <= 0
          ? t("doc_expired", { doc: t(`doc_${s("doc")}`), name: s("name") })
          : t("doc_expiry", { doc: t(`doc_${s("doc")}`), name: s("name"), days: fmt.number(Number(p.days)) });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? t("titleUnread", { n: unread }) : t("title")} className="relative">
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 end-0.5 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 font-latin text-[11px] font-bold leading-5 text-primary-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <p className="font-semibold">{t("title")}</p>
          <div className="flex items-center gap-3 text-sm">
            {unread > 0 && (
              <button type="button" className="text-primary hover:underline" onClick={() => markRead()}>
                {t("markAll")}
              </button>
            )}
            <Link href={`${base}/settings/notifications`} className="text-muted-foreground hover:text-foreground">
              {t("prefs")}
            </Link>
          </div>
        </div>
        <ul className="max-h-[70vh] overflow-y-auto">
          {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</li>}
          {items.map((n) => {
            const isApproval = (n.kind === "approval" || n.kind === "approval_reminder") && data.canDecide && !n.read && !!n.params.approval_id;
            return (
              <li key={n.id} className={cn("border-b border-border/60 px-4 py-3 last:border-0", !n.read && "bg-primary-soft/40")}>
                <div className="flex items-start gap-2">
                  {!n.read && <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-primary" />}
                  <div className="min-w-0 flex-1">
                    {n.link ? (
                      <Link href={`${base}${n.link}`} onClick={() => !n.read && markRead(n.id)} className="text-sm leading-6 hover:underline">
                        {text(n)}
                      </Link>
                    ) : (
                      <p className="text-sm leading-6">{text(n)}</p>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">{fmt.dateTime(n.created_at)}</p>
                    {isApproval && (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" onClick={() => decide(n, "approved")} disabled={pending}>
                          <Check /> {t("approve")}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => decide(n, "rejected")} disabled={pending}>
                          <X /> {t("reject")}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
