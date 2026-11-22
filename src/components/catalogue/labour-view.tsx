"use client";
import { Pencil, Plus, Truck, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { DeleteButton, FormDialog, NumberInput, bool, str, useActionRunner } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionResult } from "@/lib/actions";
import { SwitchField } from "./services-view";

export type LabourItem = {
  id: string;
  service_id: string | null;
  name: string;
  basis: "external_per_unit" | "external_lump";
  rate: number;
  notes: string | null;
  is_active: boolean;
};
export type ExtraItem = { id: string; name: string; unit: "lump" | "day" | "trip" | "month"; default_amount: number; is_active: boolean };

export type LabourActions = {
  saveLabour: (i: Record<string, unknown>) => Promise<ActionResult>;
  deleteLabour: (i: { id: string }) => Promise<ActionResult>;
  saveExtra: (i: Record<string, unknown>) => Promise<ActionResult>;
  deleteExtra: (i: { id: string }) => Promise<ActionResult>;
};

export function LabourView({
  labour,
  extras,
  services,
  canManage,
  actions,
}: {
  labour: LabourItem[];
  extras: ExtraItem[];
  services: { id: string; name_ar: string }[];
  canManage: boolean;
  actions?: LabourActions;
}) {
  const t = useTranslations();
  const { fmt } = useFormatter();
  const { run, pending, fieldText } = useActionRunner();
  const [labourDialog, setLabourDialog] = React.useState<LabourItem | "new" | null>(null);
  const [extraDialog, setExtraDialog] = React.useState<ExtraItem | "new" | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const serviceName = (id: string | null) => services.find((s) => s.id === id)?.name_ar ?? t("catalogue.anyService");
  const unitLabel = { lump: t("catalogue.unitLump"), day: t("catalogue.unitDay"), trip: t("catalogue.unitTrip"), month: t("catalogue.unitMonth") };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Users className="size-4 text-primary" /> {t("catalogue.labourRates")}</CardTitle>
            <CardDescription>{t("catalogue.labourHint")}</CardDescription>
          </div>
          {canManage && (
            <Button size="sm" variant="soft" onClick={() => setLabourDialog("new")}>
              <Plus /> {t("catalogue.addLabour")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          {labour.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground">—</p>
          ) : (
            <ul className="divide-y divide-border">
              {labour.map((l) => (
                <li key={l.id} className={`flex items-center gap-3 px-5 py-3 sm:px-6 ${l.is_active ? "" : "opacity-55"}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold">{l.name}</p>
                    <p className="text-[13px] text-muted-foreground">{serviceName(l.service_id)}</p>
                  </div>
                  <div className="text-end">
                    <p className="num text-[15px] font-extrabold">{fmt.money(l.rate)}</p>
                    <Badge>{l.basis === "external_per_unit" ? t("catalogue.basisPerUnit") : t("catalogue.basisLump")}</Badge>
                  </div>
                  {canManage && (
                    <Button variant="ghost" size="icon-sm" aria-label={t("catalogue.editLabour")} onClick={() => setLabourDialog(l)}>
                      <Pencil />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Truck className="size-4 text-primary" /> {t("catalogue.extraCosts")}</CardTitle>
            <CardDescription>{t("catalogue.extraHint")}</CardDescription>
          </div>
          {canManage && (
            <Button size="sm" variant="soft" onClick={() => setExtraDialog("new")}>
              <Plus /> {t("catalogue.addExtra")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          {extras.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground">—</p>
          ) : (
            <ul className="divide-y divide-border">
              {extras.map((x) => (
                <li key={x.id} className={`flex items-center gap-3 px-5 py-3 sm:px-6 ${x.is_active ? "" : "opacity-55"}`}>
                  <p className="min-w-0 flex-1 truncate text-[15px] font-bold">{x.name}</p>
                  <p className="num text-[15px] font-extrabold">
                    {fmt.money(x.default_amount)} <span className="text-xs font-normal text-muted-foreground">/ {unitLabel[x.unit]}</span>
                  </p>
                  {canManage && (
                    <Button variant="ghost" size="icon-sm" aria-label={t("catalogue.editExtra")} onClick={() => setExtraDialog(x)}>
                      <Pencil />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {labourDialog && (() => {
        const l = labourDialog === "new" ? undefined : labourDialog;
        return (
          <FormDialog
            open
            onOpenChange={(v) => !v && setLabourDialog(null)}
            title={l ? t("catalogue.editLabour") : t("catalogue.addLabour")}
            pending={pending}
            footerExtra={l && <DeleteButton pending={pending} onConfirm={() => run(actions && (() => actions.deleteLabour({ id: l.id })), { onSuccess: () => setLabourDialog(null) })} />}
            onSubmit={(fd) =>
              run(
                actions &&
                  (() =>
                    actions.saveLabour({
                      ...(l ? { id: l.id } : {}),
                      service_id: str(fd, "service_id") || null,
                      name: str(fd, "name"),
                      basis: str(fd, "basis"),
                      rate: str(fd, "rate"),
                      notes: null,
                      is_active: l ? bool(fd, "is_active") : true,
                    })),
                { onFieldErrors: setErrors, onSuccess: () => setLabourDialog(null) },
              )
            }
          >
            <Field id="lb-name" label={t("catalogue.name")} error={fieldText(errors.name)}>
              <Input name="name" defaultValue={l?.name} placeholder="مقاول دهانات — أبو محمد" />
            </Field>
            <Field id="lb-svc" label={t("catalogue.service")}>
              <NativeSelect name="service_id" defaultValue={l?.service_id ?? ""}>
                <option value="">{t("catalogue.anyService")}</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name_ar}</option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field id="lb-basis" label={t("catalogue.basis")}>
                <NativeSelect name="basis" defaultValue={l?.basis ?? "external_per_unit"}>
                  <option value="external_per_unit">{t("catalogue.basisPerUnit")}</option>
                  <option value="external_lump">{t("catalogue.basisLump")}</option>
                </NativeSelect>
              </Field>
              <Field id="lb-rate" label={t("catalogue.rate")} error={fieldText(errors.rate)}>
                <NumberInput name="rate" defaultValue={l?.rate ?? ""} suffix={t("dashboard.sar")} />
              </Field>
            </div>
            {l && (
              <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
                <span className="text-[14px]">{t("catalogue.active")}</span>
                <SwitchField name="is_active" defaultChecked={l.is_active} />
              </label>
            )}
          </FormDialog>
        );
      })()}

      {extraDialog && (() => {
        const x = extraDialog === "new" ? undefined : extraDialog;
        return (
          <FormDialog
            open
            onOpenChange={(v) => !v && setExtraDialog(null)}
            title={x ? t("catalogue.editExtra") : t("catalogue.addExtra")}
            pending={pending}
            footerExtra={x && <DeleteButton pending={pending} onConfirm={() => run(actions && (() => actions.deleteExtra({ id: x.id })), { onSuccess: () => setExtraDialog(null) })} />}
            onSubmit={(fd) =>
              run(
                actions &&
                  (() =>
                    actions.saveExtra({
                      ...(x ? { id: x.id } : {}),
                      name: str(fd, "name"),
                      unit: str(fd, "unit"),
                      default_amount: str(fd, "default_amount"),
                      is_active: x ? bool(fd, "is_active") : true,
                    })),
                { onFieldErrors: setErrors, onSuccess: () => setExtraDialog(null) },
              )
            }
          >
            <Field id="ex-name" label={t("catalogue.name")} error={fieldText(errors.name)}>
              <Input name="name" defaultValue={x?.name} placeholder="تأجير سقالات" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field id="ex-amount" label={t("catalogue.defaultAmount")} error={fieldText(errors.default_amount)}>
                <NumberInput name="default_amount" defaultValue={x?.default_amount ?? ""} suffix={t("dashboard.sar")} />
              </Field>
              <Field id="ex-unit" label={t("catalogue.unit")}>
                <NativeSelect name="unit" defaultValue={x?.unit ?? "lump"}>
                  {(["lump", "day", "trip", "month"] as const).map((u) => (
                    <option key={u} value={u}>{unitLabel[u]}</option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            {x && (
              <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
                <span className="text-[14px]">{t("catalogue.active")}</span>
                <SwitchField name="is_active" defaultChecked={x.is_active} />
              </label>
            )}
          </FormDialog>
        );
      })()}
    </div>
  );
}
