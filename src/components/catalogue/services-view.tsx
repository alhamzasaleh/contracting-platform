"use client";
import { ArrowUpLeft, Layers, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { FormDialog, NumberInput, bool, str, useActionRunner } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import type { ActionResult } from "@/lib/actions";
import { cn } from "@/lib/utils";

export type ServiceSummary = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  unit: "m2" | "m" | "piece" | "lump";
  waste_percent: number | null;
  is_active: boolean;
  stages: number;
  recipeLines: number;
  costPerUnit: number | null; // null when costs are hidden
  missingPrices: number;
};

export type ServiceInput = {
  id?: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  unit: "m2" | "m" | "piece" | "lump";
  waste_percent: string;
  is_active: boolean;
};

export type ServicesActions = {
  seed: () => Promise<ActionResult>;
  save: (i: ServiceInput) => Promise<ActionResult<{ code: string }>>;
};

export function ServicesView({
  services,
  canManage,
  actions,
  basePath = "",
}: {
  services: ServiceSummary[];
  canManage: boolean;
  actions?: ServicesActions;
  basePath?: string;
}) {
  const t = useTranslations("catalogue");
  const { fmt } = useFormatter();
  const { run, pending } = useActionRunner();
  const [open, setOpen] = React.useState(false);

  if (services.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Layers />}
          title={t("emptyServicesTitle")}
          description={t("emptyServicesBody")}
          action={
            canManage && (
              <>
                <Button onClick={() => run(actions?.seed)} loading={pending}>
                  <Sparkles /> {t("seedServices")}
                </Button>
                <Button variant="secondary" onClick={() => setOpen(true)}>
                  <Plus /> {t("newService")}
                </Button>
              </>
            )
          }
        />
        <ServiceDialog open={open} onOpenChange={setOpen} onSave={actions?.save} basePath={basePath} />
      </>
    );
  }

  return (
    <div className="grid gap-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}>
            <Plus /> {t("newService")}
          </Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {services.map((s) => (
          <Link
            key={s.id}
            href={`${basePath}/catalogue/services/${s.code}`}
            className={cn(
              "group flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
              !s.is_active && "opacity-60",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[17px] font-extrabold">{s.name_ar}</p>
                {s.name_en && <p className="truncate font-latin text-[13px] text-subtle-foreground">{s.name_en}</p>}
              </div>
              <ArrowUpLeft className="size-4 shrink-0 text-subtle-foreground transition-transform group-hover:-translate-y-0.5 ltr:-scale-x-100" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge>{t("stagesCount", { n: fmt.number(s.stages) })}</Badge>
              <Badge>{t("recipeCount", { n: fmt.number(s.recipeLines) })}</Badge>
              {!s.is_active && <Badge tone="warning">{t("inactive")}</Badge>}
            </div>
            {s.costPerUnit !== null && (
              <div className="mt-auto flex items-baseline justify-between border-t border-border pt-3">
                <span className="text-[13px] text-muted-foreground">{t("materialCostPerUnit")}</span>
                <span className="num text-[17px] font-extrabold">
                  {s.recipeLines ? fmt.money(s.costPerUnit) : "—"}
                </span>
              </div>
            )}
          </Link>
        ))}
      </div>
      <ServiceDialog open={open} onOpenChange={setOpen} onSave={actions?.save} basePath={basePath} />
    </div>
  );
}

export function ServiceDialog({
  open,
  onOpenChange,
  service,
  onSave,
  basePath = "",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  service?: ServiceSummary;
  onSave?: (i: ServiceInput) => Promise<ActionResult<{ code: string }>>;
  basePath?: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { run, pending, fieldText } = useActionRunner();
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const submit = (fd: FormData) => {
    const input: ServiceInput = {
      ...(service ? { id: service.id } : {}),
      name_ar: str(fd, "name_ar"),
      name_en: str(fd, "name_en") || null,
      description: str(fd, "description") || null,
      unit: str(fd, "unit") as ServiceInput["unit"],
      waste_percent: str(fd, "waste_percent"),
      is_active: bool(fd, "is_active"),
    };
    run(onSave && (() => onSave(input)), {
      onFieldErrors: setErrors,
      onSuccess: (r) => {
        onOpenChange(false);
        const code = r.ok ? r.data?.code : undefined;
        if (!service && code) router.push(`${basePath}/catalogue/services/${code}`);
      },
    });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={service ? t("catalogue.editService") : t("catalogue.newService")}
      pending={pending}
      onSubmit={submit}
    >
      <Field id="svc-name-ar" label={t("catalogue.nameAr")} error={fieldText(errors.name_ar)}>
        <Input name="name_ar" defaultValue={service?.name_ar} required />
      </Field>
      <Field id="svc-name-en" label={t("catalogue.nameEn")} optional={t("common.optional")}>
        <Input name="name_en" defaultValue={service?.name_en ?? ""} dir="ltr" className="font-latin rtl:text-right" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field id="svc-unit" label={t("catalogue.unit")}>
          <NativeSelect name="unit" defaultValue={service?.unit ?? "m2"}>
            {(["m2", "m", "piece", "lump"] as const).map((u) => (
              <option key={u} value={u}>
                {t(`units.${u}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="svc-waste" label={t("catalogue.wastePercent")} optional={t("common.optional")} error={fieldText(errors.waste_percent)}>
          <NumberInput name="waste_percent" defaultValue={service?.waste_percent ?? ""} suffix="%" />
        </Field>
      </div>
      <p className="-mt-3 text-[13px] text-muted-foreground">{t("catalogue.wasteHint")}</p>
      <Field id="svc-desc" label={t("catalogue.description")} optional={t("common.optional")}>
        <Textarea name="description" defaultValue={service?.description ?? ""} rows={2} />
      </Field>
      <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
        <span className="text-[14px]">{t("catalogue.isActive")}</span>
        <SwitchField name="is_active" defaultChecked={service?.is_active ?? true} />
      </label>
    </FormDialog>
  );
}

/** Switch that submits "on" in a form. */
export function SwitchField({ name, defaultChecked }: { name: string; defaultChecked?: boolean }) {
  const [on, setOn] = React.useState(Boolean(defaultChecked));
  return (
    <>
      <Switch checked={on} onCheckedChange={setOn} />
      {on && <input type="hidden" name={name} value="on" />}
    </>
  );
}
