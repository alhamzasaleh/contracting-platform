"use client";
import { ChevronDown, FilePen, FilePlus2, FileX2, History } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormatter } from "@/components/formatter-provider";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type AuditItem = {
  id: number;
  at: string;
  actor: string | null;
  action: string;
  table: string;
  changes: { field: string; before: unknown; after: unknown }[];
};

const ICON: Record<string, typeof FilePen> = { insert: FilePlus2, update: FilePen, delete: FileX2 };
const TONE: Record<string, string> = {
  insert: "bg-success-soft text-success",
  update: "bg-info-soft text-info",
  delete: "bg-danger-soft text-danger",
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function AuditView({ items }: { items: AuditItem[] }) {
  const t = useTranslations();
  const { fmt } = useFormatter();
  const [open, setOpen] = React.useState<number | null>(null);

  const tableLabel = (table: string) => (t.has(`audit.tables.${table}`) ? t(`audit.tables.${table}`) : table);
  const actionLabel = (a: string) => (t.has(`audit.${a}`) ? t(`audit.${a}`) : a);
  // column names that have a label (e.g. the success partner's reward); others stay as stored
  // the client's own answers on his page have no staff actor
  const actorless = (a: string) => (a.startsWith("client_") ? t("audit.clientPage") : t("settings.system"));
  const fieldLabel = (f: string) => (t.has(`audit.fields.${f}`) ? t(`audit.fields.${f}`) : f);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.auditTitle")}</CardTitle>
        <CardDescription>{t("settings.auditHint")}</CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-subtle-foreground">
              <History className="size-6" />
            </span>
            <p className="text-sm text-muted-foreground">{t("settings.auditEmpty")}</p>
          </div>
        ) : (
          <ol className="divide-y divide-border">
            {items.map((e) => {
              const Icon = ICON[e.action] ?? FilePen;
              const expanded = open === e.id;
              const hasChanges = e.changes.length > 0;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    className={cn("flex w-full items-center gap-3 px-5 py-3.5 text-start transition-colors sm:px-6", hasChanges && "hover:bg-surface-2/60")}
                    onClick={() => hasChanges && setOpen(expanded ? null : e.id)}
                    aria-expanded={hasChanges ? expanded : undefined}
                  >
                    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", TONE[e.action] ?? "bg-surface-2 text-muted-foreground")}>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px]">
                        <span className="font-medium">{actionLabel(e.action)}</span>{" "}
                        <span className="text-muted-foreground">{tableLabel(e.table)}</span>
                      </p>
                      <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                        <Avatar name={e.actor ?? actorless(e.action)} className="size-4 text-[8px] ring-0" />
                        {e.actor ?? actorless(e.action)} · <time dateTime={e.at} title={fmt.dateTime(e.at)}>{fmt.relative(e.at)}</time>
                      </p>
                    </div>
                    {hasChanges && (
                      <ChevronDown className={cn("size-4 text-subtle-foreground transition-transform", expanded && "rotate-180")} />
                    )}
                  </button>
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <dl className="mx-5 mb-4 grid gap-1.5 rounded-xl bg-surface-sunken p-3 text-[13px] sm:mx-6">
                          {e.changes.map((c) => (
                            <div key={c.field} className="grid grid-cols-[minmax(0,8rem)_1fr] gap-3">
                              <dt className="truncate font-latin text-muted-foreground">{fieldLabel(c.field)}</dt>
                              <dd className="min-w-0 break-words">
                                {e.action === "update" && (
                                  <>
                                    <span className="text-danger line-through decoration-danger/40">{show(c.before)}</span>
                                    <span className="mx-1.5 text-subtle-foreground">←</span>
                                  </>
                                )}
                                <span className={e.action === "delete" ? "text-danger" : "text-success"}>{show(e.action === "delete" ? c.before : c.after)}</span>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
