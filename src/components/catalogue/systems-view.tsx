"use client";
import { Layers, Pencil, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { FormDialog, str, useActionRunner } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionResult } from "@/lib/actions";
import type { SystemKind } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

type Inclusion = "always" | "on" | "off";

export type SystemItem = {
  id: string;
  code: string;
  kind: SystemKind;
  name: string;
  spec_text: string | null;
  is_active: boolean;
  variants: { id: string; code: string; name: string; spec_text: string | null; is_default: boolean }[];
  components: { id: string; role: string; group: string; inclusion: Inclusion; variants: string[] | null }[];
};

/** Systems (assemblies) with their variants, components and spec text (Appendix A.2). */
export function SystemsView({
  systems,
  canManage,
  canSeed,
  onSaveSpec,
  onSaveInclusion,
  onSeed,
}: {
  systems: SystemItem[];
  canManage: boolean;
  canSeed: boolean;
  onSaveSpec?: (i: Record<string, unknown>) => Promise<ActionResult>;
  onSaveInclusion?: (i: Record<string, unknown>) => Promise<ActionResult>;
  onSeed?: () => Promise<ActionResult>;
}) {
  const t = useTranslations("engine");
  const { run, pending } = useActionRunner();
  const [editing, setEditing] = React.useState<{ id: string; kind: "system" | "variant"; title: string; text: string | null } | null>(null);

  if (systems.length === 0) {
    return (
      <EmptyState
        icon={<Layers />}
        title={t("emptyTitle")}
        description={t("emptyBody")}
        action={
          canSeed && (
            <Button loading={pending} onClick={() => run(onSeed)}>
              <Sparkles /> {t("seed")}
            </Button>
          )
        }
      />
    );
  }

  return (
    <div className="grid gap-5">
      <p className="rounded-2xl bg-primary-soft/60 px-5 py-3.5 text-[14px]">{t("systemsIntro")}</p>
      <div className="grid gap-5 lg:grid-cols-2">
        {systems.map((s) => (
          <section key={s.id} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
            <header className="flex items-start justify-between gap-3 px-5 pt-4">
              <div>
                <h3 className="text-[17px] font-bold">{s.name}</h3>
                <p className="text-[13px] text-muted-foreground">{t(`kind_${s.kind}`)}</p>
              </div>
              {canManage && (
                <Button variant="ghost" size="icon-sm" aria-label={t("editSpec")} onClick={() => setEditing({ id: s.id, kind: "system", title: s.name, text: s.spec_text })}>
                  <Pencil />
                </Button>
              )}
            </header>
            {s.spec_text && <p className="mx-5 mt-3 rounded-xl bg-surface-sunken px-4 py-3 text-[13px] leading-6">{s.spec_text}</p>}

            <div className="px-5 pt-4">
              <p className="mb-2 text-[12px] font-bold text-muted-foreground">{t("variants")}</p>
              <div className="flex flex-wrap gap-2">
                {s.variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    disabled={!canManage}
                    onClick={() => setEditing({ id: v.id, kind: "variant", title: `${s.name} — ${v.name}`, text: v.spec_text })}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] enabled:hover:border-primary/40"
                  >
                    {v.name}
                    {v.is_default && <Badge tone="primary">{t("default")}</Badge>}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-5 pt-4 pb-5">
              <p className="mb-2 text-[12px] font-bold text-muted-foreground">{t("components")}</p>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {s.components.map((c) => {
                  const variantNames = c.variants?.map((code) => s.variants.find((v) => v.code === code)?.name ?? code);
                  // The owner decides for every component: always, or optional per client.
                  const value: Inclusion = c.inclusion;
                  return (
                    <li key={c.id} className="flex min-h-11 items-center justify-between gap-3 px-3 py-1.5">
                      <span className="min-w-0 text-[13px]">
                        {c.group}
                        {variantNames && <span className="block text-[11px] text-muted-foreground">{t("onlyFor", { list: variantNames.join("، ") })}</span>}
                      </span>
                      {!canManage ? (
                        <span className={cn("inline-flex shrink-0 items-center gap-1 text-[12px]", value === "off" ? "text-muted-foreground" : "text-primary")}>
                          {t(value === "always" ? "incAlways" : value === "on" ? "incOnShort" : "incOffShort")}
                        </span>
                      ) : (
                        <NativeSelect
                          aria-label={c.group}
                          value={value}
                          disabled={pending}
                          className="h-9 w-auto shrink-0 text-[12px]"
                          onChange={(e) => run(onSaveInclusion && (() => onSaveInclusion({ id: c.id, inclusion: e.target.value })), { silent: true })}
                        >
                          <option value="always">{t("incAlways")}</option>
                          <option value="on">{t("incOnShort")}</option>
                          <option value="off">{t("incOffShort")}</option>
                        </NativeSelect>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        ))}
      </div>

      {editing && (
        <FormDialog
          open
          wide
          onOpenChange={(v) => !v && setEditing(null)}
          title={t("editSpec")}
          description={editing.title}
          pending={pending}
          onSubmit={(fd) =>
            run(onSaveSpec && (() => onSaveSpec({ id: editing.id, kind: editing.kind, spec_text: str(fd, "spec_text") })), {
              onSuccess: () => setEditing(null),
            })
          }
        >
          <Field id="sys-spec" label={t("specText")} hint={t("specHint")}>
            <Textarea name="spec_text" defaultValue={editing.text ?? ""} rows={7} />
          </Field>
        </FormDialog>
      )}
    </div>
  );
}
