"use client";
import { AlertTriangle, CheckCircle2, FileText, KeyRound, Link2, RefreshCw, RotateCcw, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { loadQoyodOptions, qoyodApprovedSendNow, qoyodAutoSetupNow, qoyodBackfill, qoyodRetry, qoyodSyncNow, removeQoyodKey, saveQoyodKey, saveQoyodSettings } from "@/app/(app)/settings/qoyod/actions";
import { useFormatter } from "@/components/formatter-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import type { QoyodPageData } from "@/lib/data/qoyod";
import type { QoyodOptions } from "@/lib/qoyod/client";

const SERVICES = ["gypsum", "interior", "exterior"] as const;
const num = (v: string) => (v ? Number(v) : null);

/** Settings → Qoyod: key, the accounts/warehouse/products to use, and the sync log. */
export function QoyodSettingsView({ data, preview, sampleOptions, base = "" }: { data: QoyodPageData; preview?: boolean; sampleOptions?: QoyodOptions; base?: string }) {
  const t = useTranslations("qoyod");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const router = useRouter();
  const { fmt } = useFormatter();
  const [pending, startTransition] = React.useTransition();
  const [key, setKey] = React.useState("");
  const [changingKey, setChangingKey] = React.useState(!data.settings.key_last4);
  const [options, setOptions] = React.useState<QoyodOptions | null>(sampleOptions ?? null);
  const [optionsError, setOptionsError] = React.useState<string | null>(null);
  const [s, setS] = React.useState(data.settings);
  const [from, setFrom] = React.useState("");
  const connected = !!data.settings.key_last4;

  const err = (code: string) => (t.has(`e_${code}`) ? t(`e_${code}`) : te.has(code) ? te(code) : tc("error"));

  React.useEffect(() => {
    if (preview || !connected || options) return;
    let live = true;
    void loadQoyodOptions().then((r) => {
      if (!live) return;
      if (r.ok && r.data) setOptions(r.data);
      else if (!r.ok) setOptionsError(err(r.error));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, preview]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) => {
    if (preview) return void toast(tc("saved"));
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        if (okMsg) toast.success(okMsg);
        router.refresh();
      } else toast.error(err(r.error ?? "error"));
    });
  };

  const connect = () => {
    if (preview) return void toast(tc("saved"));
    startTransition(async () => {
      const r = await saveQoyodKey({ key });
      if (r.ok) {
        toast.success(t("connected"));
        setOptions(r.data ?? null);
        setKey("");
        setChangingKey(false);
        router.refresh();
      } else toast.error(err(r.error));
    });
  };

  const accounts = options?.accounts ?? [];
  const receiveAccounts = accounts.filter((a) => a.receive);
  const expenseAccounts = accounts.filter((a) => /expense/i.test(a.type) || a.code.startsWith("5") || a.code.startsWith("4"));
  const products = (options?.products ?? []).filter((p) => p.sale);

  const select = (id: string, value: number | null, onChange: (v: number | null) => void, list: { id: number; name: string; code?: string }[]) => (
    <NativeSelect id={id} value={value ?? ""} onChange={(e) => onChange(num(e.target.value))} disabled={!options}>
      <option value="">{options ? t("choose") : t("loading")}</option>
      {list.map((x) => (
        <option key={x.id} value={x.id}>
          {x.code ? `${x.code} · ${x.name}` : x.name}
        </option>
      ))}
      {value != null && options && !list.some((x) => x.id === value) && <option value={value}>#{value}</option>}
    </NativeSelect>
  );

  const statusTone = { queued: "warning", running: "warning", done: "success", failed: "danger" } as const;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{t("title")}</CardTitle>
            {connected ? (
              <Badge tone={data.settings.enabled ? "success" : "warning"} dot>
                {data.settings.enabled ? t("statusOn") : t("statusPaused")}
              </Badge>
            ) : (
              <Badge dot>{t("statusOff")}</Badge>
            )}
          </div>
          <CardDescription>{t("intro")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {connected && !changingKey ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
              <p className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4 text-success" /> {t("keySaved")} <span className="font-latin" dir="ltr">••••{data.settings.key_last4}</span>
              </p>
              {data.canManage && (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setChangingKey(true)}>
                    {t("changeKey")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => run(() => removeQoyodKey(), t("keyRemoved"))} disabled={pending}>
                    {t("removeKey")}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            data.canManage && (
              <>
                <ol className="grid list-decimal gap-1 ps-5 text-sm text-muted-foreground">
                  <li>{t("step1")}</li>
                  <li>{t("step2")}</li>
                  <li>{t("step3")}</li>
                </ol>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <Field id="qoyod-key" label={t("apiKey")} hint={t("apiKeyHint")} className="flex-1">
                    <Input value={key} onChange={(e) => setKey(e.target.value)} dir="ltr" autoComplete="off" spellCheck={false} className="font-latin" />
                  </Field>
                  <Button onClick={connect} loading={pending} disabled={key.trim().length < 8} className="sm:mb-7">
                    <KeyRound /> {t("connect")}
                  </Button>
                </div>
              </>
            )
          )}
        </CardContent>
      </Card>

      {connected && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>{t("setupTitle")}</CardTitle>
              {data.canManage && (
                <Button size="sm" variant="secondary" onClick={() => run(() => qoyodAutoSetupNow(), t("autoDone"))} disabled={pending}>
                  <RefreshCw /> {t("autoSetup")}
                </Button>
              )}
            </div>
            <CardDescription>{t("setupHint")}</CardDescription>
            {optionsError && <p className="mt-2 text-sm text-danger">{optionsError}</p>}
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <Field id="q-inventory" label={t("inventory")} hint={t("inventoryHint")}>
              {select("q-inventory", s.inventory_id, (v) => setS({ ...s, inventory_id: v }), options?.inventories ?? [])}
            </Field>
            <Field id="q-receive" label={t("receiveAccount")} hint={t("receiveHint")}>
              {select("q-receive", s.receive_account_id, (v) => setS({ ...s, receive_account_id: v }), receiveAccounts)}
            </Field>
            <Field id="q-expense" label={t("expenseAccount")} hint={t("expenseHint")}>
              {select("q-expense", s.expense_account_id, (v) => setS({ ...s, expense_account_id: v }), expenseAccounts.length ? expenseAccounts : accounts)}
            </Field>
            <Field id="q-salary" label={t("salaryAccount")} hint={t("salaryHint")} optional={tc("optional")}>
              {select("q-salary", s.salary_account_id ?? null, (v) => setS({ ...s, salary_account_id: v }), expenseAccounts.length ? expenseAccounts : accounts)}
            </Field>
            <Field id="q-cash" label={t("cashAccount")} hint={t("cashHint")} optional={tc("optional")}>
              {select("q-cash", s.cash_account_id ?? null, (v) => setS({ ...s, cash_account_id: v }), receiveAccounts)}
            </Field>
            <Field id="q-subcontract" label={t("subcontractAccount")} hint={t("subcontractHint")} optional={tc("optional")}>
              {select("q-subcontract", s.subcontract_account_id ?? null, (v) => setS({ ...s, subcontract_account_id: v }), expenseAccounts.length ? expenseAccounts : accounts)}
            </Field>
            {SERVICES.map((sv) => (
              <Field key={sv} id={`q-p-${sv}`} label={t(`product_${sv}`)} hint={sv === "gypsum" ? t("productHint") : undefined}>
                {select(`q-p-${sv}`, s.service_products[sv] ?? null, (v) => setS({ ...s, service_products: setProduct(s.service_products, sv, v) }), products)}
              </Field>
            ))}
            <Field id="q-p-addendum" label={t("product_addendum")} optional={tc("optional")}>
              {select("q-p-addendum", s.addendum_product_id, (v) => setS({ ...s, addendum_product_id: v }), products)}
            </Field>
            <div className="grid gap-2 sm:col-span-2">
              <span className="text-sm font-medium">{t("invoiceStatus")}</span>
              <Segmented
                name={t("invoiceStatus")}
                value={s.invoice_status}
                onChange={(v) => setS({ ...s, invoice_status: v })}
                options={[
                  { value: "Draft", label: t("statusDraft") },
                  { value: "Approved", label: t("statusApproved") },
                ]}
              />
              <p className="text-[13px] text-muted-foreground">{s.invoice_status === "Draft" ? t("draftHint") : t("approvedHint")}</p>
            </div>
            <label className="flex items-center justify-between gap-4 rounded-2xl border border-border px-4 py-3 sm:col-span-2">
              <span>
                <span className="block font-medium">{t("enable")}</span>
                <span className="block text-[13px] text-muted-foreground">{t("enableHint")}</span>
              </span>
              <Switch checked={s.enabled} onCheckedChange={(v) => setS({ ...s, enabled: v })} aria-label={t("enable")} />
            </label>
          </CardContent>
          {data.canManage && (
            <CardFooter>
              <Button
                loading={pending}
                onClick={() =>
                  run(
                    () =>
                      saveQoyodSettings({
                        enabled: s.enabled, invoice_status: s.invoice_status, inventory_id: s.inventory_id, receive_account_id: s.receive_account_id, expense_account_id: s.expense_account_id,
                        salary_account_id: s.salary_account_id ?? null, cash_account_id: s.cash_account_id ?? null, subcontract_account_id: s.subcontract_account_id ?? null,
                        service_products: { gypsum: s.service_products.gypsum ?? null, interior: s.service_products.interior ?? null, exterior: s.service_products.exterior ?? null },
                        addendum_product_id: s.addendum_product_id,
                      }),
                    tc("saved"),
                  )
                }
              >
                {tc("save")}
              </Button>
            </CardFooter>
          )}
        </Card>
      )}

      {connected && (data.draftInvoices?.length ?? 0) > 0 && (
        <Card className="border-warning/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-warning" /> {t("draftTitle")}
            </CardTitle>
            <CardDescription>{t("draftListHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {data.draftInvoices!.map((n) => (
                <li key={n}>
                  {data.canViewInvoices ? (
                    <Link href={`${base}/invoices/${n}`} className="inline-flex min-h-9 items-center rounded-full border border-border px-3 py-1 text-[13px] hover:border-primary hover:text-primary">
                      <bdi dir="ltr" className="font-latin">{n}</bdi>
                    </Link>
                  ) : (
                    <span className="inline-flex min-h-9 items-center rounded-full border border-border px-3 py-1 text-[13px]">
                      <bdi dir="ltr" className="font-latin">{n}</bdi>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
          {data.canRetry && (
            <CardFooter>
              <Button onClick={() => run(() => qoyodApprovedSendNow({}), t("approvedSent"))} loading={pending}>
                <Send /> {t("approvedSendNow")}
              </Button>
            </CardFooter>
          )}
        </Card>
      )}

      {connected && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>{t("logTitle")}</CardTitle>
              <div className="flex flex-wrap gap-2">
                {data.canRetry && data.counts.failed > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => run(() => qoyodRetry({ id: null }), t("retried"))} disabled={pending}>
                    <RotateCcw /> {t("retryAll")}
                  </Button>
                )}
                {data.canRetry && (
                  <Button size="sm" onClick={() => run(() => qoyodSyncNow(), t("synced"))} loading={pending}>
                    <RefreshCw /> {t("syncNow")}
                  </Button>
                )}
              </div>
            </div>
            <CardDescription>{t("logHint", { queued: data.counts.queued, done: data.counts.done, failed: data.counts.failed })}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {data.canManage && (
              <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4 sm:flex-row sm:items-end">
                <Field id="q-from" label={t("backfill")} hint={data.settings.sync_from ? t("backfillDone", { date: fmt.date(data.settings.sync_from) }) : t("backfillHint")} className="flex-1">
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" />
                </Field>
                <Button variant="secondary" className="sm:mb-7" disabled={!from || !data.settings.enabled || pending} onClick={() => run(() => qoyodBackfill({ from }), t("backfillQueued"))}>
                  <Link2 /> {t("backfillButton")}
                </Button>
              </div>
            )}
            {data.jobs.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("logEmpty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.jobs.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {t(`kind_${j.kind}`)} · <bdi dir="ltr" className="font-latin">{j.label}</bdi>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {j.amount != null && `${fmt.money(j.amount)} · `}
                        {fmt.dateTime(j.done_at ?? j.created_at)}
                        {j.last_error && j.status !== "done" && <span className="text-danger"> · {explain(t, j.last_error)}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {j.kind === "invoice" && j.status === "done" && !preview && (
                        <a href={`/api/qoyod/invoice/${j.id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-primary hover:underline">
                          <FileText className="size-4" /> {t("pdf")}
                        </a>
                      )}
                      {j.status === "failed" && data.canRetry && (
                        <Button size="sm" variant="ghost" onClick={() => run(() => qoyodRetry({ id: j.id }), t("retried"))} disabled={pending}>
                          {t("retry")}
                        </Button>
                      )}
                      <Badge tone={statusTone[j.status]}>{t(`st_${j.status}`)}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function setProduct(map: Record<string, number>, service: string, id: number | null): Record<string, number> {
  const next = { ...map };
  if (id) next[service] = id;
  else delete next[service];
  return next;
}

function explain(t: ReturnType<typeof useTranslations>, e: string): string {
  const [kind, what] = e.split(":");
  if ((kind === "missing" || kind === "waiting") && t.has(`${kind}_${what}`)) return t(`${kind}_${what}`);
  if (e === "network") return t("e_network");
  if (e.startsWith("HTTP 401")) return t("e_qoyodKey");
  return e;
}
