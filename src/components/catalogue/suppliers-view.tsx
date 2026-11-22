"use client";
import { Pencil, Plus, Store } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { FormDialog, bool, str, useActionRunner } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import { SwitchField } from "./services-view";

export type Supplier = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  vat_number: string | null;
  city: string | null;
  notes: string | null;
  is_active: boolean;
};

export function SuppliersView({
  suppliers,
  canManage,
  onSave,
}: {
  suppliers: Supplier[];
  canManage: boolean;
  onSave?: (i: Record<string, unknown>) => Promise<ActionResult>;
}) {
  const t = useTranslations();
  const { run, pending, fieldText } = useActionRunner();
  const [editing, setEditing] = React.useState<Supplier | "new" | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function dialog() {
    const s = editing === "new" ? undefined : editing!;
    return (
      <FormDialog
        open
        onOpenChange={(v) => !v && setEditing(null)}
        title={s ? t("catalogue.editSupplier") : t("catalogue.newSupplier")}
        pending={pending}
        onSubmit={(fd) =>
          run(
            onSave &&
              (() =>
                onSave({
                  ...(s ? { id: s.id } : {}),
                  name: str(fd, "name"),
                  contact_name: str(fd, "contact_name") || null,
                  phone: str(fd, "phone"),
                  vat_number: str(fd, "vat_number"),
                  city: str(fd, "city") || null,
                  notes: str(fd, "notes") || null,
                  is_active: s ? bool(fd, "is_active") : true,
                })),
            { onFieldErrors: setErrors, onSuccess: () => setEditing(null) },
          )
        }
      >
        <Field id="sp-name" label={t("catalogue.supplierName")} error={fieldText(errors.name)}>
          <Input name="name" defaultValue={s?.name} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field id="sp-contact" label={t("catalogue.contactName")} optional={t("common.optional")}>
            <Input name="contact_name" defaultValue={s?.contact_name ?? ""} />
          </Field>
          <Field id="sp-phone" label={t("hr.phone")} optional={t("common.optional")} error={fieldText(errors.phone)}>
            <Input name="phone" defaultValue={s?.phone ?? ""} inputMode="tel" dir="ltr" className="font-latin rtl:text-right" />
          </Field>
          <Field id="sp-vat" label={t("settings.vatNumber")} optional={t("common.optional")} error={errors.vat_number ? t("settings.vatInvalid") : undefined}>
            <Input name="vat_number" defaultValue={s?.vat_number ?? ""} inputMode="numeric" dir="ltr" className="font-latin rtl:text-right" />
          </Field>
          <Field id="sp-city" label={t("settings.city")} optional={t("common.optional")}>
            <Input name="city" defaultValue={s?.city ?? ""} />
          </Field>
        </div>
        <Field id="sp-notes" label={t("catalogue.notes")} optional={t("common.optional")}>
          <Textarea name="notes" defaultValue={s?.notes ?? ""} rows={2} />
        </Field>
        {s && (
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
            <span className="text-[14px]">{t("catalogue.active")}</span>
            <SwitchField name="is_active" defaultChecked={s.is_active} />
          </label>
        )}
      </FormDialog>
    );
  }

  if (suppliers.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Store />}
          title={t("catalogue.emptySuppliersTitle")}
          description={t("catalogue.emptySuppliersBody")}
          action={
            canManage && (
              <Button onClick={() => setEditing("new")}>
                <Plus /> {t("catalogue.newSupplier")}
              </Button>
            )
          }
        />
        {editing && dialog()}
      </>
    );
  }

  return (
    <div className="grid gap-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")}>
            <Plus /> {t("catalogue.newSupplier")}
          </Button>
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <ul className="divide-y divide-border">
          {suppliers.map((s) => (
            <li key={s.id} className={`flex items-center gap-3 px-5 py-3.5 ${s.is_active ? "" : "opacity-55"}`}>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-muted-foreground">
                <Store className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold">{s.name}</p>
                <p className="flex flex-wrap gap-1.5 text-[13px] text-muted-foreground">
                  {s.contact_name && <span>{s.contact_name}</span>}
                  {s.phone && <span className="ltr-inline">{s.phone}</span>}
                  {s.city && <span>· {s.city}</span>}
                  {s.vat_number && <Badge>{t("catalogue.vatRegistered")}</Badge>}
                </p>
              </div>
              {canManage && (
                <Button variant="ghost" size="icon-sm" aria-label={t("catalogue.editSupplier")} onClick={() => setEditing(s)}>
                  <Pencil />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {editing && dialog()}
    </div>
  );
}
