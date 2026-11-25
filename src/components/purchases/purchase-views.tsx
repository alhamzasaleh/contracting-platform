"use client";
import { DocNo } from "@/components/doc-no";
import { AlertTriangle, ArrowLeftRight, Camera, Check, ClipboardList, FileText, Package, Paperclip, Pencil, Plus, ShoppingCart, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { FormDialog, NumberInput, useActionRunner, useUnitText, useUnitHint } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import type { ActionResult } from "@/lib/actions";
import { shrinkImage } from "@/lib/client/image";
import type { InventoryData, ItemRef, ProjectCost, PurchaseDetail, PurchaseForm, PurchaseListItem } from "@/lib/data/purchases";
import { costStatus, lineAmount, mergeRows, pickStockItem, purchaseTotals, stillToAdd, type InvoiceDraft, type InvoiceFlag } from "@/lib/purchases";
import type { PurchaseStatus } from "@/lib/supabase/database.types";
import { toNumber } from "@/lib/validation/numbers";
import { cn, ltr } from "@/lib/utils";
import { projectHref } from "@/lib/finance";
import { settle } from "@/lib/client/action";

const TONE: Record<PurchaseStatus, "neutral" | "primary" | "success" | "danger" | "warning"> = {
  draft: "neutral",
  pending_approval: "warning",
  recorded: "success",
  rejected: "danger",
  cancelled: "neutral",
};
const num = (v: string) => {
  const x = toNumber(v);
  return typeof x === "number" ? x : 0;
};

// --- List ---------------------------------------------------------------------------

export function PurchasesList({ purchases, canManage, base = "" }: { purchases: PurchaseListItem[]; canManage: boolean; base?: string }) {
  const t = useTranslations("purchases");
  const { fmt } = useFormatter();
  return (
    <div className="grid gap-4">
      {canManage && (
        <Button asChild className="justify-self-start">
          <Link href={`${base}/purchases/new`}>
            <Camera /> {t("new")}
          </Link>
        </Button>
      )}
      {purchases.length === 0 ? (
        <EmptyState icon={<ShoppingCart />} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <ul className="grid gap-2">
          {purchases.map((p) => (
            <li key={p.id}>
              <Link
                href={`${base}/purchases/${p.number}`}
                className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:border-primary/40"
              >
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  <DocNo>{p.number}</DocNo>
                  <Badge tone={TONE[p.status]}>{t(`status_${p.status}`)}</Badge>
                </p>
                <p className="font-latin text-end text-[15px] font-bold tabular-nums">{fmt.money(p.total)}</p>
                <p className="col-span-full text-[13px] text-muted-foreground">
                  {[p.supplier, p.charge.kind === "project" ? `${p.charge.client} · ${ltr(p.charge.number)}` : p.charge.kind === "hidden" ? t("toProject") : t("toStock"), p.invoice_date && fmt.date(p.invoice_date)].filter(Boolean).join(" · ")}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Editor (camera → AI draft → review → save) -------------------------------------

type Row = {
  key: number;
  kind: "material" | "expense";
  item: string; // item id, "new", or "" for expense
  newName: string;
  newUnit: string;
  general: boolean;
  description: string;
  colour: string;
  quantity: string;
  unit: string;
  unit_price: string;
  unclear?: boolean;
  /** catalogue product for a new stock item (calibration) */
  product?: string;
  /** the stock item and product suggested from the quote's purchase list (the product only belongs to that item) */
  suggested?: { item: string; product: string };
};

export type PurchaseActions = {
  upload: (fd: FormData) => Promise<ActionResult<{ path: string; draft: InvoiceDraft | null; flags: InvoiceFlag[]; aiError?: string }>>;
  save: (i: Record<string, unknown>) => Promise<ActionResult<{ number: string; status: string }>>;
};

let rowKey = 0;
const emptyRow = (): Row => ({ key: ++rowKey, kind: "material", item: "new", newName: "", newUnit: "pcs", general: true, description: "", colour: "", quantity: "1", unit: "pcs", unit_price: "" });

export function PurchaseEditor({ form, actions, base = "", initialProject }: { form: PurchaseForm; actions?: PurchaseActions; base?: string; initialProject?: string }) {
  const t = useTranslations("purchases");
  const unitText = useUnitText();
  /** the unit in the reader's language under the field, only when the stored value is a key (pack → عبوة) */
  const unitHint = useUnitHint();
  const { fmt } = useFormatter();
  const router = useRouter();
  const { run, pending, errorText } = useActionRunner();
  const p = form.purchase;
  const [attachment, setAttachment] = React.useState<{ path: string; preview: string | null; pdf: boolean } | null>(
    p?.attachmentUrl ? { path: "", preview: p.attachmentUrl, pdf: p.attachmentIsPdf } : null,
  );
  const [attachmentPath, setAttachmentPath] = React.useState<string | null>(p?.attachment_path ?? null);
  const [reading, setReading] = React.useState(false);
  const [aiNote, setAiNote] = React.useState<string | null>(null);
  const [flags, setFlags] = React.useState<InvoiceFlag[]>([]);
  const [aiUsed, setAiUsed] = React.useState(p?.ai_extracted ?? false);
  const [unclear, setUnclear] = React.useState<string[]>([]);
  const [supplierId, setSupplierId] = React.useState(p?.supplier_id ?? "");
  const [supplierName, setSupplierName] = React.useState(p?.supplier ?? "");
  const [supplierVat, setSupplierVat] = React.useState(p?.supplier_vat ?? "");
  const [invoiceNo, setInvoiceNo] = React.useState(p?.invoice_number ?? "");
  const [invoiceDate, setInvoiceDate] = React.useState(p?.invoice_date ?? "");
  const [project, setProject] = React.useState(p?.project?.id ?? initialProject ?? "");
  // G2: the picked project's quote purchase list (any accepted project, also when picked here)
  const quoteList = project ? (form.quoteLists?.[project] ?? null) : null;
  const projectNumber = form.projects.find((x) => x.id === project)?.number ?? null;
  const [vat, setVat] = React.useState(p ? String(p.vat) : "");
  const [notes, setNotes] = React.useState(p?.notes ?? "");
  const [rows, setRows] = React.useState<Row[]>(
    p?.lines.length
      ? p.lines.map((l) => ({
          key: ++rowKey, kind: l.kind, item: l.kind === "expense" ? "" : (l.item_id ?? "new"), newName: "", newUnit: l.unit, general: true,
          description: l.description, colour: l.colour ?? "", quantity: String(l.quantity), unit: l.unit, unit_price: String(l.unit_price),
        }))
      : [emptyRow()],
  );
  const camera = React.useRef<HTMLInputElement>(null);
  const picker = React.useRef<HTMLInputElement>(null);
  // what the quote list still has to add after the rows already in the form
  const toAdd = quoteList ? stillToAdd(quoteList, rows) : [];
  const setRow = (k: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === k ? { ...x, ...patch } : x)));
  const totals = purchaseTotals(rows.map((r) => ({ kind: r.kind, quantity: num(r.quantity), unit_price: num(r.unit_price) })), num(vat));
  const isUnclear = (f: string) => unclear.some((u) => u === f || u.startsWith(`${f}.`) || u.startsWith(`${f}[`));

  const onFile = async (file: File | undefined) => {
    if (!file || !actions) return;
    setReading(true);
    setAiNote(null);
    const small = await shrinkImage(file);
    const fd = new FormData();
    fd.set("file", small);
    fd.set("ai", form.aiEnabled ? "1" : "0");
    const local = small.type.startsWith("image/") ? URL.createObjectURL(small) : null;
    const r = await settle(() => actions.upload(fd));
    setReading(false);
    if (!r.ok) return setAiNote(errorText(r.error));
    setAttachment({ path: r.data!.path, preview: local, pdf: small.type === "application/pdf" });
    setAttachmentPath(r.data!.path);
    const d = r.data!.draft;
    if (r.data!.aiError) setAiNote(t(`ai_${r.data!.aiError}` as "ai_aiFailed"));
    if (!d) return;
    // fill the form from the AI draft — everything stays editable
    setAiUsed(true);
    setFlags(r.data!.flags);
    setUnclear(d.unclear_fields);
    if (d.supplier_name) {
      setSupplierName(d.supplier_name);
      const match = form.suppliers.find((s) => s.name === d.supplier_name || (d.supplier_vat && s.vat_number === d.supplier_vat.replace(/\D/g, "")));
      if (match) setSupplierId(match.id);
    }
    if (d.supplier_vat) setSupplierVat(d.supplier_vat.replace(/\D/g, ""));
    if (d.invoice_number) setInvoiceNo(d.invoice_number);
    if (d.invoice_date && /^\d{4}-\d{2}-\d{2}$/.test(d.invoice_date)) setInvoiceDate(d.invoice_date);
    if (d.vat != null) setVat(String(d.vat));
    if (d.lines.length)
      setRows(
        d.lines.map((l, i) => {
          const match = form.items.find((it) => it.name === l.description);
          return {
            key: ++rowKey, kind: "material", item: match?.id ?? "new", newName: l.description, newUnit: l.unit || "pcs", general: true,
            description: l.description, colour: "", quantity: String(l.quantity), unit: l.unit || "pcs", unit_price: String(l.unit_price),
            unclear: d.unclear_fields.some((u) => u.startsWith(`lines[${i}]`)),
          };
        }),
      );
  };

  const save = (submit: boolean) =>
    run(
      actions &&
        (() =>
          actions.save({
            ...(p ? { id: p.id } : {}),
            supplier_id: supplierId || null,
            supplier_name: supplierName,
            supplier_vat: supplierVat,
            invoice_number: invoiceNo,
            invoice_date: invoiceDate || null,
            contract_id: project || null,
            vat: num(vat),
            notes,
            attachment_path: attachmentPath,
            ai_extracted: aiUsed,
            ai_flags: [...flags, ...unclear.map((u) => `unclear:${u}`)].slice(0, 40),
            submit,
            lines: rows.map((r) => ({
              kind: r.kind,
              item_id: r.kind === "material" && r.item && r.item !== "new" ? r.item : null,
              new_item: r.kind === "material" && r.item === "new" ? { name: (r.newName || r.description).trim(), unit: r.unit.trim() || "pcs", is_general: r.general, product_id: r.product || null } : null,
              description: r.description,
              colour: r.colour,
              quantity: num(r.quantity),
              unit: r.unit,
              unit_price: num(r.unit_price),
              product_id: r.kind === "material" && r.product ? r.product : null,
            })),
          })),
      { onSuccess: (r) => r.ok && r.data && router.push(`${base}/purchases/${r.data.number}`) },
    );

  return (
    <div className="grid gap-6 min-[1150px]:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0">
      <div className="@container grid content-start gap-5 [&>*]:min-w-0">
        {/* 1. the invoice */}
        <section className="grid gap-4 rounded-3xl border border-border bg-surface p-5">
          <p className="text-[15px] font-bold">{t("step1")}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="lg" loading={reading} onClick={() => camera.current?.click()}>
              <Camera /> {t("takePhoto")}
            </Button>
            <Button type="button" size="lg" variant="secondary" disabled={reading} onClick={() => picker.current?.click()}>
              <Paperclip /> {t("pickFile")}
            </Button>
            <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
          <p className="text-[13px] text-muted-foreground">{form.aiEnabled ? t("aiHint") : t("aiOff")}</p>
          {reading && (
            <p className="flex items-center gap-2 text-[13px] text-primary">
              <Sparkles className="size-4 animate-pulse" /> {t("reading")}
            </p>
          )}
          {aiNote && <p className="rounded-2xl bg-warning-soft px-4 py-3 text-[13px]">{aiNote}</p>}
          {attachment && (
            <div className="flex items-start gap-3">
              {attachment.preview && !attachment.pdf ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={attachment.preview} alt={t("invoicePhoto")} className="max-h-56 rounded-2xl border border-border object-contain" />
              ) : (
                <span className="flex items-center gap-2 rounded-2xl bg-surface-sunken px-3 py-2 text-[13px]">
                  <FileText className="size-4" /> {t("attached")}
                </span>
              )}
            </div>
          )}
          {aiUsed && (
            <div className="grid gap-1 rounded-2xl bg-primary/5 px-4 py-3 text-[13px]">
              <p className="flex items-center gap-2 font-bold text-primary">
                <Sparkles className="size-4" /> {t("aiDraft")}
              </p>
              {flags.map((f) => (
                <p key={f} className="flex gap-2 text-warning-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {t(`flag_${f}`)}
                </p>
              ))}
              {unclear.length > 0 && <p className="text-muted-foreground">{t("unclearHint")}</p>}
            </div>
          )}
        </section>

        {/* 2. supplier and invoice details */}
        <section className="field-row gap-x-4 gap-y-4 rounded-3xl border border-border bg-surface p-5 @xl:grid-cols-2">
          <p className="text-[15px] font-bold @xl:col-span-2">{t("step2")}</p>
          <Field id="pu-supplier" label={t("supplier")}>
            <NativeSelect
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                const s = form.suppliers.find((x) => x.id === e.target.value);
                if (s) {
                  setSupplierName(s.name);
                  if (s.vat_number) setSupplierVat(s.vat_number);
                }
              }}
            >
              <option value="">{t("supplierOther")}</option>
              {form.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="pu-sname" label={t("supplierName")}>
            <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className={cn(isUnclear("supplier_name") && "ring-2 ring-warning")} />
          </Field>
          <Field id="pu-svat" label={t("supplierVat")} optional={t("optional")}>
            <Input value={supplierVat} onChange={(e) => setSupplierVat(e.target.value)} inputMode="numeric" dir="ltr" className={cn("font-latin rtl:text-right", isUnclear("supplier_vat") && "ring-2 ring-warning")} />
          </Field>
          <Field id="pu-ino" label={t("invoiceNumber")} optional={t("optional")}>
            <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} dir="ltr" className={cn("font-latin rtl:text-right", isUnclear("invoice_number") && "ring-2 ring-warning")} />
          </Field>
          <Field id="pu-idate" label={t("invoiceDate")}>
            <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={cn(isUnclear("invoice_date") && "ring-2 ring-warning")} />
          </Field>
          <Field id="pu-project" label={t("chargeTo")} hint={t("chargeHint")}>
            <NativeSelect value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">{t("toStock")}</option>
              {form.projects.map((x) => (
                <option key={x.id} value={x.id}>
                  {ltr(x.number)} · {x.client}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </section>

        {/* 3. lines (laid out by the card's width: it is narrow beside the totals panel on an iPad) */}
        <section className="@container grid gap-3 rounded-3xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[15px] font-bold">{t("step3")}</p>
            {quoteList && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={toAdd.length === 0}
                onClick={() =>
                  // added to the lines already there (e.g. read from the invoice); what was bought before
                  // and what the form already holds are left out — pressing twice never doubles
                  setRows((current) =>
                    mergeRows(
                      current,
                      stillToAdd(quoteList, current).map((l) => ({
                        key: ++rowKey, kind: "material" as const, item: l.item, newName: l.description, newUnit: l.unit, general: l.general,
                        description: l.description, colour: l.colour, quantity: String(l.remaining), unit: l.unit, unit_price: String(l.unit_price), product: l.product_id ?? "",
                        suggested: { item: l.item, product: l.product_id ?? "" },
                      })),
                      (r) => !r.description.trim() && !num(r.unit_price) && (r.item === "new" || !r.item),
                    ),
                  )
                }
              >
                <ShoppingCart /> {t("fromQuoteList")}
              </Button>
            )}
            {quoteList && projectNumber && (
              <Button asChild variant="ghost" size="sm">
                <Link href={`${base}/print/contracts/${projectNumber}/materials`} target="_blank">
                  <ClipboardList /> {t("materialsTable")}
                </Link>
              </Button>
            )}
          </div>
          {quoteList && (
            <div className="grid gap-1 text-[12px] text-muted-foreground">
              <p>{t("fromQuoteListHint")}</p>
              {quoteList.some((l) => l.bought > 0) && (
                <ul className="grid gap-0.5" data-testid="quote-list-bought">
                  {quoteList
                    .filter((l) => l.bought > 0)
                    .map((l, i) => (
                      <li key={i}>{t("alreadyBought", { item: l.description, bought: fmt.number(l.bought), total: fmt.number(l.quantity) })}</li>
                    ))}
                </ul>
              )}
            </div>
          )}
          <ul className="grid gap-2">
            {rows.map((r, ri) => (
              <li key={r.key} className={cn("grid gap-3 rounded-2xl bg-surface-sunken/50 p-3", r.unclear && "ring-2 ring-warning")}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 @xl:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto]">
                  <Field id={`pl-d-${ri}`} label={t("description")}>
                    <Input value={r.description} onChange={(e) => setRow(r.key, { description: e.target.value })} />
                  </Field>
                  <Field id={`pl-i-${ri}`} label={t("stockItem")} className="order-1 col-span-full @xl:order-none @xl:col-span-1">
                    <NativeSelect
                      value={r.kind === "expense" ? "__expense" : r.item}
                      // another item than the suggested one drops the suggested catalogue product
                      onChange={(e) => setRow(r.key, pickStockItem(r, e.target.value, form.items))}
                    >
                      <option value="new">{t("newItem")}</option>
                      {form.items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name} ({unitText(it.unit)})
                        </option>
                      ))}
                      <option value="__expense">{t("expense")}</option>
                    </NativeSelect>
                  </Field>
                  <Button type="button" variant="ghost" size="icon-sm" className="mb-1.5 self-end" aria-label={t("removeLine")} disabled={rows.length === 1} onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}>
                    <Trash2 />
                  </Button>
                </div>
                {r.kind === "material" && r.item === "new" && (form.products?.length ?? 0) > 0 && (
                  <Field id={`pl-pr-${ri}`} label={t("catalogueProduct")} hint={t("catalogueProductHint")} optional={t("optional")}>
                    <NativeSelect value={r.product ?? ""} onChange={(e) => setRow(r.key, { product: e.target.value })}>
                      <option value="">—</option>
                      {form.products!.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
                {r.kind === "material" && r.item === "new" && (
                  <label className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2 text-[13px]">
                    <span>
                      {r.general ? t("generalItem") : t("specificItem")}
                      <span className="block text-[12px] text-muted-foreground">{t("generalHint")}</span>
                    </span>
                    <Switch checked={r.general} onCheckedChange={(v) => setRow(r.key, { general: v })} aria-label={t("generalItem")} />
                  </label>
                )}
                <div className="field-row grid grid-cols-2 items-end gap-3 @xl:grid-cols-4">
                  <Field id={`pl-q-${ri}`} label={t("quantity")}>
                    <NumberInput value={r.quantity} onChange={(e) => setRow(r.key, { quantity: e.target.value })} />
                  </Field>
                  <Field id={`pl-u-${ri}`} label={t("unit")} hint={unitHint(r.unit)}>
                    <Input value={r.unit} onChange={(e) => setRow(r.key, { unit: e.target.value })} dir="ltr" className="font-latin rtl:text-right" />
                  </Field>
                  <Field id={`pl-p-${ri}`} label={t("unitPrice")}>
                    <NumberInput value={r.unit_price} onChange={(e) => setRow(r.key, { unit_price: e.target.value })} />
                  </Field>
                  <Field id={`pl-c-${ri}`} label={t("colour")} optional={t("optional")}>
                    <Input value={r.colour} onChange={(e) => setRow(r.key, { colour: e.target.value })} />
                  </Field>
                </div>
                <p className="text-end font-latin text-[13px] text-muted-foreground tabular-nums">{fmt.money(lineAmount(num(r.quantity), num(r.unit_price)))}</p>
              </li>
            ))}
          </ul>
          <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setRows((x) => [...x, emptyRow()])}>
            <Plus /> {t("addLine")}
          </Button>
        </section>

        <Field id="pu-notes" label={t("notes")} optional={t("optional")}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </div>

      <aside className="grid content-start gap-3 self-start rounded-3xl border-2 border-primary/30 bg-surface p-5 min-[1150px]:sticky min-[1150px]:top-24">
        <div className="flex justify-between text-[14px]">
          <span>{t("subtotal")}</span>
          <span className="font-latin tabular-nums">{fmt.money(totals.subtotal)}</span>
        </div>
        <Field id="pu-vat" label={t("vat")} hint={t("vatHint")}>
          <div className="flex gap-2">
            <NumberInput value={vat} onChange={(e) => setVat(e.target.value)} className={cn(isUnclear("vat") && "ring-2 ring-warning")} />
            <Button type="button" variant="secondary" size="sm" className="h-11 shrink-0" onClick={() => setVat(String(Math.round(totals.subtotal * 15) / 100))}>
              15%
            </Button>
          </div>
        </Field>
        <div className="flex justify-between border-t border-border pt-3 text-[18px] font-extrabold">
          <span>{t("total")}</span>
          <span className="font-latin tabular-nums">{fmt.money(totals.total)}</span>
        </div>
        <Button loading={pending} onClick={() => save(true)}>
          <Check /> {t("record")}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => save(false)}>
          {t("saveDraft")}
        </Button>
        <p className="text-[12px] text-muted-foreground">{t("recordHint")}</p>
      </aside>
    </div>
  );
}

// --- Detail -------------------------------------------------------------------------

export function PurchaseView({
  detail: d,
  items,
  base = "",
  actions,
}: {
  detail: PurchaseDetail;
  items: ItemRef[];
  base?: string;
  actions?: { cancel: (i: { id: string }) => Promise<ActionResult>; decide: (i: Record<string, unknown>) => Promise<ActionResult>; pay?: (i: Record<string, unknown>) => Promise<ActionResult> };
}) {
  const t = useTranslations("purchases");
  const unitText = useUnitText();
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const itemName = new Map(items.map((i) => [i.id, i]));
  const editable = d.canManage && (d.status === "draft" || d.status === "rejected");
  const flags = ((d.ai_flags as { flags?: string[] }).flags ?? []).filter((f) => !f.startsWith("unclear:"));

  return (
    <div className="grid gap-5 [&>*]:min-w-0">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border bg-surface p-5">
        <div className="grid gap-1">
          <p className="flex flex-wrap items-center gap-2 text-[18px] font-extrabold">
            <DocNo>{d.number}</DocNo>
            <Badge tone={TONE[d.status]}>{t(`status_${d.status}`)}</Badge>
            {d.ai_extracted && (
              <Badge tone="info">
                <Sparkles className="size-3" /> {t("aiRead")}
              </Badge>
            )}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {[d.supplier, d.invoice_number && t("invoiceNo", { n: ltr(d.invoice_number) }), d.invoice_date && fmt.date(d.invoice_date)].filter(Boolean).join(" · ")}
          </p>
          <p className="text-[13px]">
            {/* the project as this viewer may open it: contract, else project page, else plain text */}
            {d.charge.kind === "project" ? (
              <>
                {t("chargeTo")}: {d.charge.client} ·{" "}
                {d.charge.href ? (
                  <Link href={`${base}${d.charge.href}`} className="text-primary hover:underline">
                    <DocNo>{d.charge.number}</DocNo>
                  </Link>
                ) : (
                  <DocNo>{d.charge.number}</DocNo>
                )}
              </>
            ) : d.charge.kind === "hidden" ? (
              <>
                {t("chargeTo")}: {t("toProject")}
              </>
            ) : (
              t("toStock")
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`${base}/purchases/${d.number}/edit`}>{t("edit")}</Link>
            </Button>
          )}
          {d.canManage && ["draft", "rejected"].includes(d.status) && actions && (
            <Button variant="ghost" size="sm" className="text-danger" loading={pending} onClick={() => run(() => actions.cancel({ id: d.id }))}>
              <X /> {t("cancel")}
            </Button>
          )}
        </div>
      </section>

      {d.status === "recorded" && (d.paid || d.canPay) && <SupplierPayment d={d} pay={actions?.pay} />}

      {d.status === "pending_approval" && (
        <section className="grid gap-3 rounded-3xl border border-warning/40 bg-warning-soft/60 p-5">
          <p className="flex items-center gap-2 font-bold">
            <AlertTriangle className="size-4" /> {t("pendingTitle", { limit: d.approval?.limit != null ? fmt.money(d.approval.limit) : "—" })}
          </p>
          {d.canDecide && d.approval && actions ? (
            <div className="flex gap-2">
              <Button loading={pending} onClick={() => run(() => actions.decide({ approval_id: d.approval!.id, decision: "approved" }))}>
                <Check /> {t("approve")}
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => run(() => actions.decide({ approval_id: d.approval!.id, decision: "rejected" }))}>
                {t("reject")}
              </Button>
            </div>
          ) : (
            <p className="text-[13px]">{t("pendingBody")}</p>
          )}
        </section>
      )}
      {flags.length > 0 && (
        <section className="grid gap-1 rounded-2xl bg-warning-soft/60 px-4 py-3 text-[13px]">
          {flags.map((f) => (
            <p key={f} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {t.has(`flag_${f}`) ? t(`flag_${f}` as "flag_noLines") : f}
            </p>
          ))}
        </section>
      )}

      <div className="grid gap-5 min-[1150px]:grid-cols-[minmax(0,1fr)_320px] [&>*]:min-w-0">
        <section className="rounded-3xl border border-border bg-surface p-5">
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="text-[12px] text-muted-foreground">
                  <th className="px-2 py-2 text-start font-normal">{t("description")}</th>
                  <th className="px-2 py-2 text-end font-normal">{t("quantity")}</th>
                  <th className="px-2 py-2 text-end font-normal">{t("unitPrice")}</th>
                  <th className="px-2 py-2 text-end font-normal">{t("amount")}</th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l) => {
                  const it = l.item_id ? itemName.get(l.item_id) : undefined;
                  return (
                    <tr key={l.seq} className="border-t border-border">
                      <td className="px-2 py-2.5">
                        <p className="font-bold">{l.description}</p>
                        <p className="text-[12px] text-muted-foreground">
                          {l.kind === "expense" ? t("expense") : it ? `${it.name} · ${it.is_general ? t("generalItem") : t("specificItem")}` : ""}
                          {l.colour && ` · ${l.colour}`}
                        </p>
                      </td>
                      <td className="px-2 py-2.5 text-end font-latin tabular-nums">
                        {fmt.number(l.quantity, l.quantity % 1 ? 2 : 0)} {unitText(l.unit)}
                      </td>
                      <td className="px-2 py-2.5 text-end font-latin tabular-nums">{fmt.money(l.unit_price)}</td>
                      <td className="px-2 py-2.5 text-end font-latin tabular-nums">{fmt.money(l.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <dl className="ms-auto mt-4 grid max-w-xs gap-1.5 text-[14px]">
            <div className="flex justify-between">
              <dt>{t("subtotal")}</dt>
              <dd className="font-latin tabular-nums">{fmt.money(d.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t("vat")}</dt>
              <dd className="font-latin tabular-nums">{fmt.money(d.vat)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-[16px] font-extrabold">
              <dt>{t("total")}</dt>
              <dd className="font-latin tabular-nums">{fmt.money(d.total)}</dd>
            </div>
          </dl>
          {d.notes && <p className="mt-4 whitespace-pre-line text-[13px] text-muted-foreground">{d.notes}</p>}
        </section>
        {/* the photo panel keeps its own height beside a long table (no stretched empty card) and stays in view */}
        <aside className="grid content-start gap-2 self-start rounded-3xl border border-border bg-surface p-5 min-[1150px]:sticky min-[1150px]:top-24">
          <p className="text-[13px] font-bold">{t("invoicePhoto")}</p>
          {d.attachmentUrl ? (
            d.attachmentIsPdf ? (
              <a href={d.attachmentUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[14px] text-primary underline">
                <FileText className="size-4" /> {t("openPdf")}
              </a>
            ) : (
              <a href={d.attachmentUrl} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.attachmentUrl} alt={t("invoicePhoto")} className="w-full rounded-2xl border border-border object-contain" />
              </a>
            )
          ) : (
            <p className="text-[13px] text-muted-foreground">{t("noPhoto")}</p>
          )}
        </aside>
      </div>
    </div>
  );
}

// --- Inventory ----------------------------------------------------------------------

export function InventoryView({
  data,
  actions,
}: {
  data: InventoryData;
  actions?: { move: (i: Record<string, unknown>) => Promise<ActionResult>; saveItem: (i: Record<string, unknown>) => Promise<ActionResult<{ id: string }>> };
}) {
  const t = useTranslations("purchases");
  const unitText = useUnitText();
  const { fmt } = useFormatter();
  const [moving, setMoving] = React.useState<{ item: ItemRef; from: string | null } | null>(null);
  const [newItem, setNewItem] = React.useState(false);
  const [editItem, setEditItem] = React.useState<ItemRef | null>(null);
  const project = new Map(data.projects.map((p) => [p.id, p]));
  const productLabel = new Map((data.products ?? []).map((p) => [p.id, p.label]));
  const rows = data.items
    .map((it) => {
      const b = data.balances.filter((x) => x.item_id === it.id);
      return { it, stock: b.find((x) => x.contract_id === null), onProjects: b.filter((x) => x.contract_id !== null) };
    })
    .filter((r) => r.stock || r.onProjects.length);
  const stockValue = data.balances.filter((b) => b.contract_id === null).reduce((s, b) => s + b.value, 0);

  return (
    <div className="grid gap-4 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px]">
          {t("stockValue")}: <span className="font-latin font-bold tabular-nums">{fmt.money(stockValue)}</span>
        </p>
        {data.canManage && (
          <Button variant="secondary" size="sm" onClick={() => setNewItem(true)}>
            <Plus /> {t("newItemButton")}
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Package />} title={t("noStockTitle")} description={t("noStockBody")} />
      ) : (
        <ul className="grid gap-2">
          {rows.map(({ it, stock, onProjects }) => (
            <li key={it.id} className="grid gap-2 rounded-2xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  {it.name}
                  <Badge tone={it.is_general ? "neutral" : "info"}>{it.is_general ? t("generalItem") : t("specificItem")}</Badge>
                  {it.product_id && productLabel.has(it.product_id) && <Badge tone="success">{t("linkedProduct")}</Badge>}
                  {data.canManage && (
                    <Button size="sm" variant="ghost" onClick={() => setEditItem(it)}>
                      <Pencil /> {it.product_id ? t("editItem") : t("linkItem")}
                    </Button>
                  )}
                </p>
                {stock && (
                  <p className="text-[13px]">
                    {t("inStock")}:{" "}
                    <span className="font-latin font-bold tabular-nums">
                      {fmt.number(stock.quantity, stock.quantity % 1 ? 2 : 0)} {unitText(it.unit)}
                    </span>{" "}
                    <span className="font-latin text-muted-foreground tabular-nums">({fmt.money(stock.value)})</span>
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {stock && data.canManage && (
                  <Button size="sm" variant="soft" onClick={() => setMoving({ item: it, from: null })}>
                    <ArrowLeftRight /> {t("issue")}
                  </Button>
                )}
                {onProjects.map((b) => (
                  <button
                    key={b.contract_id}
                    type="button"
                    disabled={!data.canManage}
                    onClick={() => setMoving({ item: it, from: b.contract_id })}
                    className="rounded-full bg-surface-sunken px-3 py-1.5 text-[12px] ring-1 ring-border hover:ring-primary disabled:cursor-default"
                  >
                    {project.get(b.contract_id!)?.client ?? "—"} · <DocNo>{project.get(b.contract_id!)?.number}</DocNo> ·{" "}
                    <span className="font-latin font-bold tabular-nums">
                      {fmt.number(b.quantity, b.quantity % 1 ? 2 : 0)} {unitText(it.unit)}
                    </span>
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {moving && <MoveDialog data={data} item={moving.item} from={moving.from} onClose={() => setMoving(null)} move={actions?.move} />}
      {newItem && <ItemDialog onClose={() => setNewItem(false)} save={actions?.saveItem} products={data.products ?? []} />}
      {editItem && <ItemDialog item={editItem} onClose={() => setEditItem(null)} save={actions?.saveItem} products={data.products ?? []} />}
    </div>
  );
}

function MoveDialog({ data, item, from, onClose, move }: { data: InventoryData; item: ItemRef; from: string | null; onClose: () => void; move?: (i: Record<string, unknown>) => Promise<ActionResult> }) {
  const t = useTranslations("purchases");
  const unitText = useUnitText();
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const available = data.balances.find((b) => b.item_id === item.id && b.contract_id === from)?.quantity ?? 0;
  const targets = [...(item.is_general && from !== null ? [{ id: "", label: t("toStock") }] : []), ...data.projects.filter((p) => p.id !== from && p.status !== "cancelled").map((p) => ({ id: p.id, label: `${ltr(p.number)} · ${p.client}` }))];
  const [to, setTo] = React.useState(targets[0]?.id ?? "");
  const [qty, setQty] = React.useState(String(available));
  const [note, setNote] = React.useState("");
  const q = num(qty);
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t("moveTitle", { item: item.name })}
      description={t("available", { n: fmt.number(available, available % 1 ? 2 : 0), unit: unitText(item.unit) })}
      pending={pending}
      submitLabel={t("move")}
      onSubmit={() => run(move && (() => move({ item_id: item.id, quantity: q, from, to: to || null, note: note || null })), { onSuccess: onClose })}
    >
      <Field id="mv-to" label={t("moveTo")}>
        <NativeSelect value={to} onChange={(e) => setTo(e.target.value)}>
          {targets.map((x) => (
            <option key={x.id || "stock"} value={x.id}>
              {x.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {!item.is_general && from !== null && <p className="text-[13px] text-muted-foreground">{t("specificStays")}</p>}
      <Field id="mv-q" label={t("quantity")} error={q > available ? t("tooMuch") : undefined}>
        <NumberInput value={qty} onChange={(e) => setQty(e.target.value)} suffix={unitText(item.unit)} />
      </Field>
      <Field id="mv-n" label={t("notes")} optional={t("optional")}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

/** New stock item, or an existing one (rename / link to a catalogue product; unit and kind stay as they are). */
function ItemDialog({ item, onClose, save, products }: { item?: ItemRef; onClose: () => void; save?: (i: Record<string, unknown>) => Promise<ActionResult<{ id: string }>>; products: { id: string; label: string }[] }) {
  const t = useTranslations("purchases");
  const unitHint = useUnitHint();
  const { run, pending, fieldText } = useActionRunner();
  const [product, setProduct] = React.useState(item?.product_id ?? "");
  const [name, setName] = React.useState(item?.name ?? "");
  const [unit, setUnit] = React.useState(item?.unit ?? "pcs");
  const [general, setGeneral] = React.useState(item?.is_general ?? true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={item ? t("editItemTitle", { item: item.name }) : t("newItemButton")}
      pending={pending}
      onSubmit={() => run(save && (() => save({ ...(item ? { id: item.id } : {}), name, unit, is_general: general, product_id: product || null })), { onFieldErrors: setErrors, onSuccess: onClose })}
    >
      {products.length > 0 && (
        <Field id="it-p" label={t("catalogueProduct")} hint={t("catalogueProductHint")} optional={t("optional")}>
          <NativeSelect
            value={product}
            onChange={(e) => {
              setProduct(e.target.value);
              const label = products.find((x) => x.id === e.target.value)?.label;
              if (label && !name) setName(label.slice(0, 160));
            }}
          >
            <option value="">—</option>
            {products.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <Field id="it-n" label={t("itemName")} error={fieldText(errors.name)}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field id="it-u" label={t("unit")} hint={unitHint(unit)}>
        <Input value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!!item} dir="ltr" className="font-latin rtl:text-right" />
      </Field>
      {!item && (
        <label className="flex items-center justify-between gap-3 text-[14px]">
          <span>
            {general ? t("generalItem") : t("specificItem")}
            <span className="block text-[12px] text-muted-foreground">{t("generalHint")}</span>
          </span>
          <Switch checked={general} onCheckedChange={setGeneral} aria-label={t("generalItem")} />
        </label>
      )}
    </FormDialog>
  );
}

// --- Estimated vs actual ------------------------------------------------------------

/** labourHidden: costs are shown but in-house labour isn't because the user lacks hr.view (salaries). */
export function ProjectCostsView({ rows, links, base = "", labourHidden = false }: { rows: ProjectCost[]; links: { contracts: boolean; projects: boolean }; base?: string; labourHidden?: boolean }) {
  const t = useTranslations("purchases");
  const { fmt } = useFormatter();
  if (!rows.length) return <EmptyState icon={<ShoppingCart />} title={t("noProjectsTitle")} description={t("noProjectsBody")} />;
  const noLabour = rows.some((r) => r.labour == null);
  return (
    <div className="grid gap-3">
      <ul className="grid gap-3 [&>*]:min-w-0">
        {rows.map((r) => {
          // the material estimate is compared with the material side of the actual cost
          const s = costStatus(r.estimated, r.materialsActual);
          const pct = s.ratio == null ? 0 : Math.min(100, s.ratio * 100);
          return (
            <li key={r.id} className="grid gap-3 rounded-3xl border border-border bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {projectHref(r.number, links) ? (
                  <Link href={`${base}${projectHref(r.number, links)}`} className="font-bold hover:text-primary">
                    {r.client} · <DocNo>{r.number}</DocNo>
                  </Link>
                ) : (
                  <p className="font-bold">
                    {r.client} · <DocNo>{r.number}</DocNo>
                  </p>
                )}
                {s.level === "over" && (
                  <Badge tone="danger">
                    <AlertTriangle className="size-3" /> {t("over", { n: fmt.number(((s.ratio ?? 1) - 1) * 100, 0) })}
                  </Badge>
                )}
                {s.level === "watch" && <Badge tone="warning">{t("watch")}</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4 lg:grid-cols-8">
                <Stat label={t("estimated")} value={r.estimated == null ? "—" : fmt.money(r.estimated)} />
                <Stat label={t("actualMaterials")} value={fmt.money(r.materialsActual)} />
                <Stat label={t("actual")} value={fmt.money(r.actual)} strong />
                <Stat label={t("materials")} value={fmt.money(r.materials)} />
                <Stat label={t("expenses")} value={fmt.money(r.expenses)} />
                <Stat label={t("pettyCost")} value={fmt.money(r.petty)} />
                <Stat label={t("subsCost")} value={fmt.money(r.subcontractors)} />
                {r.labour != null && <Stat label={t("labourCost")} value={fmt.money(r.labour)} />}
                {(r.maintenance ?? 0) > 0 && <Stat label={t("maintenanceCost")} value={fmt.money(r.maintenance ?? 0)} />}
                {(r.commission ?? 0) > 0 && <Stat label={t("partnerRewardCost")} value={fmt.money(r.commission ?? 0)} />}
              </div>
              {s.ratio != null && (
                <div className="h-2.5 overflow-hidden rounded-full bg-surface-sunken" role="meter" aria-valuenow={Math.round(s.ratio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={t("actualMaterials")}>
                  <div className={cn("h-full rounded-full", s.level === "over" ? "bg-danger" : s.level === "watch" ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
                </div>
              )}
              {r.pending > 0 && <p className="text-[12px] text-muted-foreground">{t("pendingAmount", { amount: fmt.money(r.pending) })}</p>}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-subtle-foreground">{labourHidden ? t("actualNoteHidden") : noLabour ? t("actualNoteNoLabour") : t("actualNote")}</p>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={cn("font-latin tabular-nums", strong ? "text-[16px] font-extrabold" : "font-bold")}>{value}</p>
    </div>
  );
}

/** The supplier was paid (finance): date, from bank or cash, optional transfer reference. */
function SupplierPayment({ d, pay }: { d: PurchaseDetail; pay?: (i: Record<string, unknown>) => Promise<ActionResult> }) {
  const t = useTranslations("purchases");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const [date, setDate] = React.useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }));
  const [from, setFrom] = React.useState<"bank" | "cash">("bank");
  const [ref, setRef] = React.useState("");
  if (d.paid)
    return (
      <section className="flex flex-wrap items-center gap-2 rounded-3xl border border-success/40 bg-success-soft/40 p-4 text-[14px]">
        <Check className="size-4 text-success" />
        {t("paidOn", { date: fmt.date(d.paid.on), from: t(`paidFrom_${d.paid.from}`) })}
        {d.paid.reference && <span className="text-muted-foreground">· {d.paid.reference}</span>}
      </section>
    );
  return (
    <section className="grid gap-3 rounded-3xl border border-border bg-surface p-5">
      <p className="font-bold">{t("payTitle", { total: fmt.money(d.total) })}</p>
      <div className="field-row grid gap-3 sm:grid-cols-3">
        <Field id="pay-date" label={t("payDate")}>
          <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
        </Field>
        <Field id="pay-from" label={t("payFrom")}>
          <Segmented name={t("payFrom")} value={from} onChange={(v) => setFrom(v as "bank" | "cash")} options={[{ value: "bank", label: t("paidFrom_bank") }, { value: "cash", label: t("paidFrom_cash") }]} />
        </Field>
        <Field id="pay-ref" label={t("payRef")}>
          <Input id="pay-ref" value={ref} maxLength={80} onChange={(e) => setRef(e.target.value)} />
        </Field>
      </div>
      <Button className="justify-self-start" loading={pending} onClick={() => run(pay && (() => pay({ id: d.id, date, from, reference: ref })))}>
        <Check /> {t("payButton")}
      </Button>
      <p className="text-[12px] text-muted-foreground">{t("payHint")}</p>
    </section>
  );
}
