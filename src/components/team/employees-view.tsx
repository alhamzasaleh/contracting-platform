"use client";
import { AlertTriangle, ChevronDown, Plus, UserRound, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { FormDialog, NumberInput, str, useActionRunner } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import type { ActionResult } from "@/lib/actions";
import { employeeCost, type CostItem } from "@/lib/costing";
import type { EmployeeRow } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export type Employee = Pick<
  EmployeeRow,
  | "id"
  | "full_name"
  | "is_saudi"
  | "nationality"
  | "job_title"
  | "phone"
  | "id_number"
  | "id_expiry"
  | "passport_expiry"
  | "insurance_expiry"
  | "start_date"
  | "basic_salary"
  | "housing_allowance"
  | "transport_allowance"
  | "other_allowances"
  | "iban"
  | "status"
  | "notes"
>;

const SOON_DAYS = 60;

function daysUntil(date: string | null) {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
}

export function EmployeesView({
  employees,
  costItems,
  workingDays,
  canManage,
  onSave,
}: {
  employees: Employee[];
  costItems: (CostItem & { name_ar: string })[];
  workingDays: number;
  canManage: boolean;
  onSave?: (i: Record<string, unknown>) => Promise<ActionResult>;
}) {
  const t = useTranslations("hr");
  const tc = useTranslations("common");
  const { fmt } = useFormatter();
  const { run, pending, fieldText } = useActionRunner();
  const [editing, setEditing] = React.useState<Employee | "new" | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saudi, setSaudi] = React.useState<"saudi" | "non_saudi">("non_saudi");

  const active = employees.filter((e) => e.status !== "final_exit");
  const costs = new Map(employees.map((e) => [e.id, employeeCost(e, costItems, workingDays)]));
  const avg = active.length ? active.reduce((s, e) => s + costs.get(e.id)!.perDay, 0) / active.length : 0;
  const saudiCount = active.filter((e) => e.is_saudi).length;

  const open = (e: Employee | "new") => {
    setErrors({});
    setSaudi(e !== "new" && e.is_saudi ? "saudi" : "non_saudi");
    setEditing(e);
  };

  if (employees.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Users />}
          title={t("emptyTitle")}
          description={t("emptyBody")}
          action={
            canManage && (
              <Button onClick={() => open("new")}>
                <Plus /> {t("newEmployee")}
              </Button>
            )
          }
        />
        {editing && dialog()}
      </>
    );
  }

  function dialog() {
    const e = editing === "new" ? undefined : editing!;
    return (
      <FormDialog
        open
        wide
        onOpenChange={(v) => !v && setEditing(null)}
        title={e ? t("editEmployee") : t("newEmployee")}
        pending={pending}
        onSubmit={(fd) =>
          run(
            onSave &&
              (() =>
                onSave({
                  ...(e ? { id: e.id } : {}),
                  full_name: str(fd, "full_name"),
                  is_saudi: saudi === "saudi",
                  nationality: saudi === "saudi" ? null : str(fd, "nationality") || null,
                  job_title: str(fd, "job_title") || null,
                  phone: str(fd, "phone"),
                  id_number: str(fd, "id_number"),
                  id_expiry: str(fd, "id_expiry"),
                  passport_expiry: saudi === "saudi" ? "" : str(fd, "passport_expiry"),
                  insurance_expiry: str(fd, "insurance_expiry"),
                  start_date: str(fd, "start_date"),
                  basic_salary: str(fd, "basic_salary") || "0",
                  housing_allowance: str(fd, "housing_allowance") || "0",
                  transport_allowance: str(fd, "transport_allowance") || "0",
                  other_allowances: str(fd, "other_allowances") || "0",
                  iban: str(fd, "iban"),
                  status: str(fd, "status") || "active",
                  notes: str(fd, "notes") || null,
                })),
            { onFieldErrors: setErrors, onSuccess: () => setEditing(null) },
          )
        }
      >
        <Field id="em-name" label={t("fullName")} error={fieldText(errors.full_name)}>
          <Input name="full_name" defaultValue={e?.full_name} />
        </Field>
        <div className="grid gap-2">
          <span className="text-[13px] font-medium">{t("nationalityType")}</span>
          <Segmented
            name={t("nationalityType")}
            value={saudi}
            onChange={setSaudi}
            options={[
              { value: "non_saudi", label: t("nonSaudi") },
              { value: "saudi", label: t("saudi") },
            ]}
            className="w-full"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {saudi === "non_saudi" && (
            <Field id="em-nat" label={t("nationality")} optional={tc("optional")}>
              <Input name="nationality" defaultValue={e?.nationality ?? ""} />
            </Field>
          )}
          <Field id="em-job" label={t("jobTitle")} optional={tc("optional")}>
            <Input name="job_title" defaultValue={e?.job_title ?? ""} list="job-titles" />
          </Field>
          <Field id="em-phone" label={t("phone")} optional={tc("optional")} error={fieldText(errors.phone)}>
            <Input name="phone" defaultValue={e?.phone ? `0${e.phone.slice(3)}` : ""} inputMode="tel" dir="ltr" className="font-latin rtl:text-right" />
          </Field>
          <Field id="em-id" label={t("idNumber")} optional={tc("optional")} error={fieldText(errors.id_number)}>
            <Input name="id_number" defaultValue={e?.id_number ?? ""} inputMode="numeric" dir="ltr" className="font-latin rtl:text-right" />
          </Field>
          <Field id="em-idexp" label={t("idExpiry")} optional={tc("optional")}>
            <Input name="id_expiry" type="date" defaultValue={e?.id_expiry ?? ""} dir="ltr" />
          </Field>
          {saudi === "non_saudi" && (
            <Field id="em-passexp" label={t("passportExpiry")} optional={tc("optional")}>
              <Input name="passport_expiry" type="date" defaultValue={e?.passport_expiry ?? ""} dir="ltr" />
            </Field>
          )}
          <Field id="em-insexp" label={t("insuranceExpiry")} optional={tc("optional")}>
            <Input name="insurance_expiry" type="date" defaultValue={e?.insurance_expiry ?? ""} dir="ltr" />
          </Field>
          <Field id="em-start" label={t("startDate")} optional={tc("optional")}>
            <Input name="start_date" type="date" defaultValue={e?.start_date ?? ""} dir="ltr" />
          </Field>
        </div>
        <datalist id="job-titles">
          {["دهّان", "فني جبس", "مليّس", "مبلّط", "مشرف", "سائق", "عامل"].map((j) => (
            <option key={j} value={j} />
          ))}
        </datalist>
        <div className="grid gap-4 rounded-2xl bg-surface-2 p-4 sm:grid-cols-2">
          {(["basic_salary", "housing_allowance", "transport_allowance", "other_allowances"] as const).map((k) => (
            <Field
              key={k}
              id={`em-${k}`}
              label={t(k === "basic_salary" ? "basicSalary" : k === "housing_allowance" ? "housing" : k === "transport_allowance" ? "transport" : "otherAllowances")}
              error={fieldText(errors[k])}
            >
              <NumberInput name={k} defaultValue={e?.[k] ?? ""} suffix="ر.س" />
            </Field>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="em-iban" label={t("iban")} hint={t("ibanHint")} optional={tc("optional")} error={fieldText(errors.iban)}>
            <Input name="iban" defaultValue={e?.iban ?? ""} dir="ltr" className="font-latin uppercase rtl:text-right" />
          </Field>
          <Field id="em-status" label={t("status")}>
            <NativeSelect name="status" defaultValue={e?.status ?? "active"}>
              <option value="active">{t("statusActive")}</option>
              <option value="on_leave">{t("statusLeave")}</option>
              <option value="final_exit">{t("statusExit")}</option>
            </NativeSelect>
          </Field>
        </div>
        <Field id="em-notes" label={t("notes")} optional={tc("optional")}>
          <Textarea name="notes" defaultValue={e?.notes ?? ""} rows={2} />
        </Field>
      </FormDialog>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-[13px] text-muted-foreground">{t("title")}</p>
          <p className="num mt-1 text-[26px] font-extrabold">{fmt.number(active.length)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-[13px] text-muted-foreground">{t("saudization")}</p>
          <p className="num mt-1 text-[26px] font-extrabold">{active.length ? fmt.percent(saudiCount / active.length, 0) : "—"}</p>
          <p className="num text-xs text-muted-foreground">
            {t("saudiCount", { n: fmt.number(saudiCount) })} · {t("nonSaudiCount", { n: fmt.number(active.length - saudiCount) })}
          </p>
        </div>
        <div className="col-span-2 rounded-2xl bg-primary p-4 text-primary-foreground sm:col-span-1">
          <p className="text-[13px] opacity-80">{t("avgPerDay")}</p>
          <p className="num mt-1 text-[26px] font-extrabold">{fmt.money(avg)}</p>
        </div>
      </div>

      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => open("new")}>
            <Plus /> {t("newEmployee")}
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <ul className="divide-y divide-border">
          {employees.map((e) => {
            const c = costs.get(e.id)!;
            const expiring = [e.id_expiry, e.passport_expiry, e.insurance_expiry]
              .map(daysUntil)
              .filter((d): d is number => d !== null && d <= SOON_DAYS);
            const isOpen = expanded === e.id;
            return (
              <li key={e.id} className={cn(e.status === "final_exit" && "opacity-50")}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-muted-foreground">
                    <UserRound className="size-5" />
                  </span>
                  <button type="button" className="min-w-0 flex-1 basis-48 text-start" onClick={() => canManage && open(e)} disabled={!canManage}>
                    <p className="truncate text-[15px] font-bold">{e.full_name}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
                      {e.job_title && <span>{e.job_title}</span>}
                      <Badge tone={e.is_saudi ? "success" : "neutral"}>{e.is_saudi ? t("saudi") : e.nationality || t("nonSaudi")}</Badge>
                      {e.status === "on_leave" && <Badge tone="info">{t("statusLeave")}</Badge>}
                      {expiring.length > 0 && (
                        <Badge tone="warning">
                          <AlertTriangle /> {t("expiringSoon")}
                        </Badge>
                      )}
                    </p>
                  </button>
                  <div className="text-end">
                    <p className="num text-[16px] font-extrabold">{fmt.money(c.perDay)}</p>
                    <p className="text-xs text-muted-foreground">{t("perDay")}</p>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label={t("monthlyBreakdown")} aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : e.id)}>
                    <ChevronDown className={cn("transition-transform", isOpen && "rotate-180")} />
                  </Button>
                </div>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <dl className="mx-5 mb-4 grid gap-1.5 rounded-xl bg-surface-sunken p-4 text-[14px]">
                        <div className="flex justify-between">
                          <dt>{t("salaryAndAllowances")}</dt>
                          <dd className="num">{fmt.money(c.salary)}</dd>
                        </div>
                        {c.statutory.map((s) => (
                          <div key={s.code} className="flex justify-between text-muted-foreground">
                            <dt>{costItems.find((i) => i.code === s.code)?.name_ar ?? s.code}</dt>
                            <dd className="num">{fmt.money(s.monthly)}</dd>
                          </div>
                        ))}
                        <div className="mt-1 flex justify-between border-t border-border-strong pt-2 font-bold">
                          <dt>{t("perMonth")}</dt>
                          <dd className="num">{fmt.money(c.monthlyTotal)}</dd>
                        </div>
                      </dl>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      </div>
      {editing && dialog()}
    </div>
  );
}
