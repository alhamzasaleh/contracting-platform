"use client";
import { FileText, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { useFormatter } from "@/components/formatter-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/actions";
import { shrinkImage } from "@/lib/client/image";
import type { cleanDatasheet } from "@/lib/catalogue/datasheet";
import type { ProductCategory } from "@/lib/supabase/database.types";
import { settle } from "@/lib/client/action";
import { useFailureText } from "@/lib/client/failure-text";

type Draft = ReturnType<typeof cleanDatasheet>;
export type DatasheetPrefill = { name: string; category: ProductCategory; packSize: number | null; coveragePerUnit: number | null };

/** Upload a datasheet → AI draft → review → open the "new product" form pre-filled. */
export function DatasheetImport({ read, onUse, sample }: { read?: (fd: FormData) => Promise<ActionResult<Draft>>; onUse: (p: DatasheetPrefill) => void; sample?: Draft }) {
  const t = useTranslations("engine");
  const failure = useFailureText();
  const { fmt } = useFormatter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft | null>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (!read) return setDraft(sample ?? null);
    setBusy(true);
    const file = f.type.startsWith("image/") ? await shrinkImage(f) : f;
    const fd = new FormData();
    fd.set("file", file);
    const r = await settle(() => read(fd));
    setBusy(false);
    if (!r.ok && failure(r.error)) return toast.error(failure(r.error)!);
    if (!r.ok || !r.data) return toast.error(t.has(`ds_${r.ok ? "aiFailed" : r.error}`) ? t(`ds_${r.ok ? "aiFailed" : r.error}`) : t("ds_aiFailed"));
    setDraft(r.data);
  };

  const use = () => {
    if (!draft) return;
    onUse({
      name: [draft.brand, draft.product_name].filter(Boolean).join(" ").slice(0, 120) || "",
      category: draft.category ?? "finish_paint",
      packSize: draft.pack_sizes[0] ?? null,
      coveragePerUnit: draft.coverage_m2_per_unit,
    });
    setOpen(false);
    setDraft(null);
  };

  const row = (label: string, value: React.ReactNode) =>
    value == null || value === "" ? null : (
      <>
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="font-semibold">{value}</dd>
      </>
    );

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FileText /> {t("dsButton")}
      </Button>
      <Dialog open={open} onOpenChange={(v) => (setOpen(v), v || setDraft(null))}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("dsTitle")}</DialogTitle>
            <DialogDescription>{t("dsHint")}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            {!draft ? (
              <Button variant="secondary" asChild disabled={busy}>
                <label className="cursor-pointer justify-self-start">
                  <Sparkles /> {busy ? t("dsReading") : t("dsPick")}
                  <input type="file" accept="application/pdf,image/*" className="sr-only" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
                </label>
              </Button>
            ) : (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
                  {row(t("dsName"), [draft.brand, draft.product_name].filter(Boolean).join(" — "))}
                  {row(t("dsCategory"), draft.category ? t(`cat_${draft.category}`) : null)}
                  {row(t("dsCoverage"), draft.coverage_m2_per_unit != null && draft.unit ? t("perUnitLine", { area: fmt.number(draft.coverage_m2_per_unit, 2), unit: t(`unit_${draft.unit}`) }) : null)}
                  {row(t("dsPrinted"), draft.coverage_text)}
                  {row(t("dsPacks"), draft.pack_sizes.length ? draft.pack_sizes.map((s) => fmt.number(s)).join(" / ") + (draft.unit ? ` ${t(`unit_${draft.unit}`)}` : "") : null)}
                  {row(t("dsCoats"), draft.recommended_coats != null ? fmt.number(draft.recommended_coats) : null)}
                  {row(t("dsDrying"), draft.drying_time)}
                  {row(t("dsUse"), draft.use ? t(`ds_use_${draft.use}`) : null)}
                </dl>
                {draft.notes.length > 0 && (
                  <ul className="grid list-disc gap-1 rounded-2xl bg-surface-2 px-6 py-3 text-[13px]">
                    {draft.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                )}
                {(draft.unclear.length > 0 || draft.flags.length > 0) && (
                  <ul className="grid list-disc gap-1 rounded-2xl bg-warning-soft px-6 py-3 text-[13px]">
                    {draft.flags.includes("coverage") && <li>{t("dsCoverageOdd")}</li>}
                    {draft.unclear.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                )}
                <p className="text-[12px] text-muted-foreground">{t("dsReview")}</p>
              </>
            )}
          </DialogBody>
          {draft && (
            <DialogFooter>
              <Button onClick={use}>{t("dsUseBtn")}</Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                {t("dsAnother")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
