"use client";
import {
  ArrowUpLeft,
  Banknote,
  CalendarClock,
  Check,
  CheckCircle2,
  HardHat,
  Inbox,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFormatter } from "@/components/formatter-provider";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type SetupStep = { key: "setupCompany" | "setupLogo" | "setupTeam" | "setupCatalogue"; done: boolean; href?: string };

export type DashboardData = {
  userName: string | null;
  setup: SetupStep[];
  basePath?: string;
};

const container = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const } } };

export function DashboardView({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard");
  const { fmt } = useFormatter();
  const hour = Number(new Intl.DateTimeFormat("en-u-nu-latn", { hour: "numeric", hour12: false, timeZone: "Asia/Riyadh" }).format(new Date()));
  const greeting = hour < 12 ? t("greetingMorning") : t("greetingEvening");
  const firstName = data.userName?.split(" ")[0];
  const done = data.setup.filter((s) => s.done).length;
  const base = data.basePath ?? "";

  const kpis = [
    { key: "receivables", icon: Wallet, tone: "primary" },
    { key: "incoming", icon: Banknote, tone: "success" },
    { key: "obligations", icon: CalendarClock, tone: "warning" },
    { key: "activeProjects", icon: HardHat, tone: "info", count: true },
  ] as const;

  return (
    <motion.div variants={container} initial="hidden" animate="show">
      <motion.div variants={item}>
        <PageHeader title={firstName ? `${greeting}، ${firstName}` : greeting} description={t("subtitle")} />
      </motion.div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {kpis.map((k) => (
          <motion.div key={k.key} variants={item}>
            <Card className="group relative overflow-hidden p-4 transition-shadow hover:shadow-md sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-medium text-muted-foreground">{t(k.key)}</p>
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg",
                    k.tone === "primary" && "bg-primary-soft text-primary",
                    k.tone === "success" && "bg-success-soft text-success",
                    k.tone === "warning" && "bg-warning-soft text-warning",
                    k.tone === "info" && "bg-info-soft text-info",
                  )}
                >
                  <k.icon className="size-4" strokeWidth={2} />
                </span>
              </div>
              <p className="num mt-3 text-[22px] font-semibold tracking-tight sm:text-[26px]">
                {"count" in k ? fmt.number(0) : fmt.money(0)}
              </p>
              <p className="mt-1 text-xs text-subtle-foreground">{t("emptyKpi")}</p>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 sm:mt-6 lg:grid-cols-3 lg:gap-6">
        {/* Cash flow placeholder */}
        <motion.div variants={item} className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardTitle>{t("cashflow")}</CardTitle>
                <CardDescription>{t("cashflowHint")}</CardDescription>
              </div>
              <Badge tone="neutral">{t("phase", { n: fmt.number(9) })}</Badge>
            </CardHeader>
            <CardContent>
              <GhostChart />
            </CardContent>
          </Card>
        </motion.div>

        {/* Approvals */}
        <motion.div variants={item}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {t("approvals")}
                <Badge tone="primary" className="num">{fmt.number(0)}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-success-soft text-success">
                <CheckCircle2 className="size-6" />
              </span>
              <p className="text-sm text-muted-foreground">{t("noApprovals")}</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Setup checklist */}
      <motion.div variants={item} className="mt-4 sm:mt-6">
        <Card className="overflow-hidden">
          <div className="relative">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-l from-primary-softer via-transparent to-transparent rtl:bg-gradient-to-r" />
            <CardHeader className="relative flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base">{t("setupTitle")}</CardTitle>
                <CardDescription className="num">
                  {t("setupSubtitle", { done: fmt.number(done), total: fmt.number(data.setup.length) })}
                </CardDescription>
              </div>
              <ProgressRing value={done / data.setup.length} />
            </CardHeader>
            <CardContent className="relative grid gap-2 sm:grid-cols-2">
              {data.setup.map((s) => {
                const inner = (
                  <>
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                        s.done ? "border-transparent bg-success text-white" : "border-border-strong bg-surface",
                      )}
                    >
                      {s.done ? <Check className="size-4" strokeWidth={2.5} /> : <span className="size-1.5 rounded-full bg-border-strong" />}
                    </span>
                    <span className={cn("flex-1 text-[14px]", s.done && "text-muted-foreground line-through decoration-border-strong")}>
                      {t(s.key)}
                    </span>
                    {s.href && !s.done && <ArrowUpLeft className="size-4 text-subtle-foreground ltr:-scale-x-100" />}
                    {!s.href && !s.done && <Badge>{t("phase", { n: fmt.number(2) })}</Badge>}
                  </>
                );
                const cls = "flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-colors";
                return s.href && !s.done ? (
                  <Link key={s.key} href={`${base}${s.href}`} className={cn(cls, "hover:border-primary/40 hover:bg-primary-softer")}>
                    {inner}
                  </Link>
                ) : (
                  <div key={s.key} className={cls}>
                    {inner}
                  </div>
                );
              })}
            </CardContent>
          </div>
        </Card>
      </motion.div>

      {/* Coming next */}
      <motion.div variants={item} className="mt-4 grid gap-4 sm:mt-6 sm:grid-cols-3">
        {[
          { icon: TrendingUp, title: t("expectedProfit"), phase: 9 },
          { icon: Inbox, title: t("approvals"), phase: 3 },
          { icon: HardHat, title: t("activeProjects"), phase: 4 },
        ].map((c) => (
          <div key={c.title} className="flex items-center gap-3 rounded-xl border border-dashed border-border-strong/70 p-4 text-sm text-muted-foreground">
            <c.icon className="size-4 text-subtle-foreground" />
            <span className="flex-1">{c.title}</span>
            <Badge>{t("phase", { n: fmt.number(c.phase) })}</Badge>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}

function ProgressRing({ value }: { value: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 48 48" className="size-12 -rotate-90" aria-hidden>
      <circle cx="24" cy="24" r={r} fill="none" stroke="var(--border)" strokeWidth="4" />
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
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
      />
    </svg>
  );
}

/** A soft, decorative chart silhouette for the empty state. */
function GhostChart() {
  const bars = [38, 52, 44, 66, 58, 74, 62, 80, 70, 88, 76, 92];
  return (
    <div className="relative h-56">
      <div className="absolute inset-0 flex flex-col justify-between">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="border-t border-dashed border-border" />
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex h-full items-end gap-2 sm:gap-3">
        {bars.map((h, i) => (
          <motion.div
            key={i}
            className="flex-1 rounded-t-md bg-gradient-to-t from-primary/[0.03] to-primary/[0.12]"
            initial={{ height: 0 }}
            animate={{ height: `${h}%` }}
            transition={{ duration: 0.8, delay: 0.15 + i * 0.03, ease: [0.16, 1, 0.3, 1] }}
          />
        ))}
      </div>
    </div>
  );
}
