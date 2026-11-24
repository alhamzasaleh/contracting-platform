"use client";
import { ChevronDown, Eye, EyeOff, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { CLAUSE_KEYS, PLACEHOLDERS, type ClauseKey, type ContractTermsConfig } from "@/lib/contracts/terms";
import { cn } from "@/lib/utils";

/** Message keys that make up each standard clause's text (raw, with {placeholders}). */
const SOURCES: Partial<Record<ClauseKey, string[]>> = {
  annex: ["s_annexBody"], scope: ["s_scope_full"], specs: ["s_specsBody"], value: ["s_valueNoVat", "s_valueUnit"], payments: ["s_paymentsBody", "s_paymentsLate"],
  duration: ["s_durationBody"], first: ["o1_execute", "o1_supply", "o1_safety", "o1_clean", "o1_warranty"], second: ["o2_site", "o2_utilities", "o2_approve", "o2_pay"],
  handover: ["s_handoverBody"], additional: ["s_additionalBody"], warranty: ["s_warrantyBody"], termination: ["s_terminationBody"], force: ["s_forceBody"],
  notices: ["s_noticesBody"], law: ["s_lawBody"], signing: ["s_signingBody"],
};
const LISTS: ClauseKey[] = ["first", "second"];
const EDITABLE = CLAUSE_KEYS.filter((k) => k !== "extra");

/**
 * Owner's control over the contract text: hide a clause, rename it, replace its
 * text, and add his own clauses after any clause. Tables stay automatic.
 */
export function ClausesEditor({ value, onChange }: { value: ContractTermsConfig; onChange: (v: ContractTermsConfig) => void }) {
  const t = useTranslations("contract");
  const tc = useTranslations("clauses");
  const [open, setOpen] = React.useState<ClauseKey | null>(null);
  const [draft, setDraft] = React.useState({ title: "", body: "", after: "second" as ClauseKey });
  const overrides = value.overrides ?? {};
  const custom = value.custom ?? [];

  const defaultText = (key: ClauseKey) =>
    (SOURCES[key] ?? [])
      .map((m) => (t.raw(m) as string).replace(/\{n\}/g, "{warranty}"))
      .map((s) => (LISTS.includes(key) ? `- ${s}` : s))
      .join("\n");
  const setOverride = (key: ClauseKey, patch: { title?: string | null; body?: string | null; hidden?: boolean }) => {
    const next = { ...overrides, [key]: { ...overrides[key], ...patch } };
    const o = next[key]!;
    if (!o.hidden && !o.title && !o.body) delete next[key];
    onChange({ ...value, overrides: next });
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5 text-[13px] text-muted-foreground">
        <p>
          {tc("hint")} {tc("placeholders")}
        </p>
        {/* a wrapping list, not inline chips: "}{" between chips is no line-break opportunity in every Chromium build */}
        <ul className="flex flex-wrap gap-1">
          {PLACEHOLDERS.map((p) => (
            <li key={p}>
              <code className="rounded bg-surface-2 px-1 font-latin text-[12px]" dir="ltr">{`{${p}}`}</code>
            </li>
          ))}
        </ul>
      </div>
      <ol className="grid gap-2">
        {EDITABLE.map((key, i) => {
          const o = overrides[key];
          const changed = !!(o?.title || o?.body);
          return (
            <li key={key} className={cn("rounded-2xl border bg-surface", o?.hidden ? "border-dashed border-border opacity-60" : "border-border")}>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <button type="button" onClick={() => setOpen(open === key ? null : key)} className="flex min-w-0 items-center gap-2 text-start font-semibold" aria-expanded={open === key}>
                  <span className="text-muted-foreground tabular-nums">{i + 1}.</span>
                  <span className="truncate">{o?.title || t(`s_${key}`)}</span>
                  {changed && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] text-primary">{tc("edited")}</span>}
                  <ChevronDown className={cn("size-4 shrink-0 transition-transform", open === key && "rotate-180")} />
                </button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOverride(key, { hidden: !o?.hidden })}>
                  {o?.hidden ? <Eye /> : <EyeOff />} {o?.hidden ? tc("show") : tc("hide")}
                </Button>
              </div>
              {open === key && (
                <div className="grid gap-3 border-t border-border p-4">
                  <Field id={`t-${key}`} label={tc("title")}>
                    <Input value={o?.title ?? ""} placeholder={t(`s_${key}`)} maxLength={120} onChange={(e) => setOverride(key, { title: e.target.value || null })} />
                  </Field>
                  <Field id={`b-${key}`} label={tc("text")} hint={key === "scope" || key === "specs" || key === "payments" ? tc("tableStays") : undefined}>
                    <Textarea rows={5} maxLength={4000} value={o?.body ?? defaultText(key)} onChange={(e) => setOverride(key, { body: e.target.value === defaultText(key) ? null : e.target.value })} />
                  </Field>
                  {changed && (
                    <Button type="button" size="sm" variant="secondary" className="justify-self-start" onClick={() => setOverride(key, { title: null, body: null })}>
                      <RotateCcw /> {tc("reset")}
                    </Button>
                  )}
                </div>
              )}
              {custom.filter((c) => c.after === key).map((c) => (
                <div key={c.id} className="grid gap-2 border-t border-border bg-primary-soft/30 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">{tc("added")}</span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...value, custom: custom.filter((x) => x.id !== c.id) })} aria-label={tc("remove")}>
                      <Trash2 /> {tc("remove")}
                    </Button>
                  </div>
                  <Input value={c.title} maxLength={120} aria-label={tc("title")} onChange={(e) => onChange({ ...value, custom: custom.map((x) => (x.id === c.id ? { ...x, title: e.target.value } : x)) })} />
                  <Textarea rows={3} maxLength={4000} value={c.body} aria-label={tc("text")} onChange={(e) => onChange({ ...value, custom: custom.map((x) => (x.id === c.id ? { ...x, body: e.target.value } : x)) })} />
                </div>
              ))}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-3 rounded-2xl border border-dashed border-border p-4">
        <p className="font-semibold">{tc("addTitle")}</p>
        <Field id="new-title" label={tc("title")}>
          <Input value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>
        <Field id="new-body" label={tc("text")}>
          <Textarea rows={3} maxLength={4000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
        </Field>
        <Field id="new-after" label={tc("after")}>
          <NativeSelect value={draft.after} onChange={(e) => setDraft({ ...draft, after: e.target.value as ClauseKey })}>
            {EDITABLE.map((k) => (
              <option key={k} value={k}>{overrides[k]?.title || t(`s_${k}`)}</option>
            ))}
          </NativeSelect>
        </Field>
        <Button
          type="button"
          className="justify-self-start"
          disabled={!draft.title.trim() || !draft.body.trim() || custom.length >= 30}
          onClick={() => {
            onChange({ ...value, custom: [...custom, { id: `c-${Date.now().toString(36)}`, title: draft.title.trim(), body: draft.body.trim(), after: draft.after }] });
            setDraft({ title: "", body: "", after: draft.after });
          }}
        >
          <Plus /> {tc("add")}
        </Button>
      </div>
    </div>
  );
}
