"use client";
import { ArrowUpLeft, Check, CheckCircle2, Plus } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFormatter } from "@/components/formatter-provider";
import { ArchMark } from "@/components/shell/org-mark";
import {
  OwnerFinanceSections,
  type FinanceActions,
} from "@/components/finance/owner-dashboard";
import { Button } from "@/components/ui/button";
import type { OwnerFinance } from "@/lib/data/finance";
import { cn } from "@/lib/utils";

export type SetupStep = {
  key: "setupCompany" | "setupLogo" | "setupTeam" | "setupCatalogue";
  done: boolean;
  href?: string;
};

export type DashboardData = {
  userName: string | null;
  setup: SetupStep[];
  basePath?: string;
  /** owner finance (finance.view); without it the home shows the getting-started view */
  finance?: OwnerFinance | null;
  financeActions?: FinanceActions;
};

const ease = [0.16, 1, 0.3, 1] as const;
const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
};

/**
 * Owner home in the "Atelier" style. Phase 1 has no business data yet, so
 * figures show zero and sections explain what will appear; real numbers
 * arrive with later phases.
 */
export function DashboardView({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard");
  const { fmt } = useFormatter();
  const hour = Number(
    new Intl.DateTimeFormat("en-u-nu-latn", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Riyadh",
    }).format(new Date()),
  );
  const greeting = hour < 12 ? t("greetingMorning") : t("greetingEvening");
  const firstName = data.userName?.split(" ")[0];
  const done = data.setup.filter((s) => s.done).length;
  const base = data.basePath ?? "";

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="flex flex-col gap-5 sm:gap-6"
    >
      {/* Greeting */}
      <motion.div
        variants={item}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <p className="text-[13px] text-subtle-foreground">
            {fmt.date(new Date())}
          </p>
          <h1 className="mt-1 text-[32px] leading-tight font-extrabold sm:text-[44px]">
            {firstName ? `${greeting}، ${firstName}` : greeting}
          </h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <Button asChild size="lg" className="self-start sm:self-auto">
          <Link href={`${base}/clients`}>
            <Plus /> {t("newQuote")}
          </Link>
        </Button>
      </motion.div>

      {data.finance ? (
        <OwnerFinanceSections
          f={data.finance}
          actions={data.financeActions}
          base={base}
        />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            {(["receivables", "incoming", "obligations"] as const).map((k) => (
              <motion.div
                key={k}
                variants={item}
                className="rounded-2xl border border-border bg-surface p-4 sm:p-5"
              >
                <p className="text-[13px] text-muted-foreground">{t(k)}</p>
                <p className="mt-2 flex items-baseline gap-1.5">
                  <span className="num text-[26px] font-extrabold sm:text-[32px]">
                    {fmt.number(0)}
                  </span>
                  <span className="text-xs text-subtle-foreground">
                    {t("sar")}
                  </span>
                </p>
                <svg
                  viewBox="0 0 200 30"
                  className="mt-1 h-7 w-full"
                  aria-hidden
                >
                  <path
                    d="M0 22 H200"
                    stroke="var(--border-strong)"
                    strokeWidth="2"
                    strokeDasharray="4 6"
                  />
                </svg>
                <p className="text-xs text-subtle-foreground">
                  {t("emptyKpi")}
                </p>
              </motion.div>
            ))}
            <motion.div
              variants={item}
              className="rounded-2xl bg-primary p-4 text-primary-foreground sm:p-5"
            >
              <p className="text-[13px] opacity-80">{t("actualMargin")}</p>
              <p className="num mt-2 text-[26px] font-extrabold sm:text-[32px]">
                —
              </p>
              <div className="mt-2 flex flex-col gap-1.5" aria-hidden>
                <div className="h-1.5 rounded-full bg-gypsum/20" />
                <div className="h-1.5 rounded-full bg-gypsum/20" />
              </div>
              <p className="mt-2 text-xs opacity-80">{t("marginHint")}</p>
            </motion.div>
          </div>

          <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
              {/* Cash flow */}
              <motion.section
                variants={item}
                className="rounded-2xl border border-border bg-surface p-5 sm:p-6"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-[19px] font-extrabold">
                    {t("cashflow")}
                  </h2>
                  <span className="rounded-full bg-surface-sunken px-3 py-1 text-xs text-muted-foreground">
                    {t("phase", { n: fmt.number(9) })}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("cashflowHint")}
                </p>
                <GhostChart />
              </motion.section>

              {/* Projects */}
              <motion.section variants={item}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[19px] font-extrabold">
                    {t("activeProjects")}
                  </h2>
                  <span className="text-xs text-subtle-foreground">
                    {t("phase", { n: fmt.number(4) })}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="rounded-2xl border border-dashed border-border-strong bg-surface/60 p-2.5"
                    >
                      <div className="flex h-20 items-end justify-center rounded-t-[3rem] rounded-b-xl bg-surface-sunken pb-2 text-[11px] text-subtle-foreground">
                        {i === 0 ? t("projectsEmpty") : ""}
                      </div>
                      <div className="space-y-2 px-1.5 pt-3 pb-1.5" aria-hidden>
                        <div className="h-2.5 w-2/3 rounded-full bg-surface-sunken" />
                        <div className="h-1.5 rounded-full bg-surface-sunken" />
                      </div>
                    </div>
                  ))}
                </div>
              </motion.section>
            </div>

            {/* Approvals — ink panel */}
            <motion.section
              variants={item}
              className="flex flex-col gap-4 rounded-2xl bg-ink p-5 text-ink-foreground sm:p-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-[19px] font-extrabold text-gypsum">
                  {t("approvals")}
                </h2>
                <span className="num flex size-7 items-center justify-center rounded-full bg-[var(--brand-dark)] text-[13px] font-bold text-ink">
                  {fmt.number(0)}
                </span>
              </div>
              <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl bg-ink-2 px-4 py-10 text-center">
                <CheckCircle2
                  className="size-8 text-[var(--brand-dark)]"
                  strokeWidth={1.5}
                />
                <p className="text-sm text-ink-foreground">
                  {t("noApprovals")}
                </p>
                <p className="max-w-60 text-xs leading-relaxed text-ink-muted">
                  {t("approvalsHint")}
                </p>
              </div>
            </motion.section>
          </div>
        </>
      )}

      {/* Setup checklist (hidden once everything is done) */}
      {done < data.setup.length && (
        <motion.section
          variants={item}
          className="overflow-hidden rounded-2xl border border-border bg-surface"
        >
          <div className="flex items-center gap-4 p-5 sm:p-6">
            <ArchMark className="h-12 w-11" />
            <div className="flex-1">
              <h2 className="text-[19px] font-extrabold">{t("setupTitle")}</h2>
              <p className="num text-sm text-muted-foreground">
                {t("setupSubtitle", {
                  done: fmt.number(done),
                  total: fmt.number(data.setup.length),
                })}
              </p>
            </div>
            <ProgressRing value={done / data.setup.length} />
          </div>
          <div className="grid gap-2 px-5 pb-5 sm:grid-cols-2 sm:px-6 sm:pb-6">
            {data.setup.map((s) => {
              const inner = (
                <>
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full border",
                      s.done
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "border-border-strong bg-surface",
                    )}
                  >
                    {s.done ? (
                      <Check className="size-4" strokeWidth={2.5} />
                    ) : (
                      <span className="size-1.5 rounded-full bg-border-strong" />
                    )}
                  </span>
                  <span
                    className={cn(
                      "flex-1 text-[14px]",
                      s.done &&
                        "text-muted-foreground line-through decoration-border-strong",
                    )}
                  >
                    {t(s.key)}
                  </span>
                  {s.href && !s.done && (
                    <ArrowUpLeft className="size-4 text-subtle-foreground ltr:-scale-x-100" />
                  )}
                  {!s.href && !s.done && (
                    <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs text-muted-foreground">
                      {t("phase", { n: fmt.number(2) })}
                    </span>
                  )}
                </>
              );
              const cls =
                "flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface-2/60 px-4 py-3 transition-colors";
              return s.href && !s.done ? (
                <Link
                  key={s.key}
                  href={`${base}${s.href}`}
                  className={cn(
                    cls,
                    "hover:border-primary/40 hover:bg-primary-softer",
                  )}
                >
                  {inner}
                </Link>
              ) : (
                <div key={s.key} className={cls}>
                  {inner}
                </div>
              );
            })}
          </div>
        </motion.section>
      )}
    </motion.div>
  );
}

function ProgressRing({ value }: { value: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 48 48" className="size-12 -rotate-90" aria-hidden>
      <circle
        cx="24"
        cy="24"
        r={r}
        fill="none"
        stroke="var(--border)"
        strokeWidth="4"
      />
      <motion.circle
        cx="24"
        cy="24"
        r={r}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - value) }}
        transition={{ duration: 1, ease, delay: 0.2 }}
      />
    </svg>
  );
}

/** Soft paired-bar silhouette (in/out) for the empty state. */
function GhostChart() {
  const weeks = [
    [60, 42],
    [50, 56],
    [82, 46],
    [34, 72],
    [74, 40],
    [92, 50],
    [60, 44],
    [68, 40],
  ];
  return (
    <div
      className="mt-5 flex h-36 items-end gap-3 border-b border-border-strong sm:gap-4"
      aria-hidden
    >
      {weeks.map(([a, b], i) => (
        <div key={i} className="flex h-full flex-1 items-end gap-1">
          <motion.div
            className="flex-1 rounded-t-md bg-primary/15"
            initial={{ height: 0 }}
            animate={{ height: `${a}%` }}
            transition={{ duration: 0.8, delay: 0.1 + i * 0.03, ease }}
          />
          <motion.div
            className="flex-1 rounded-t-md bg-surface-sunken"
            initial={{ height: 0 }}
            animate={{ height: `${b}%` }}
            transition={{ duration: 0.8, delay: 0.15 + i * 0.03, ease }}
          />
        </div>
      ))}
    </div>
  );
}
