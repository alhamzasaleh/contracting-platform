import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

/** Split-screen auth layout: form on one side, brand story on the other. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("auth");
  const tApp = useTranslations("app");
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 pt-[max(env(safe-area-inset-top),1.5rem)] pb-8 sm:px-10">
        <div className="flex items-center gap-2.5">
          <span className="relative flex size-9 items-center justify-center overflow-hidden rounded-xl bg-primary text-primary-foreground shadow-sm">
            <span className="absolute inset-0 bg-gradient-to-br from-white/25 to-transparent" />
            <Logo />
          </span>
          <span className="text-[15px] font-semibold">{tApp("name")}</span>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">{children}</div>
        <p className="mx-auto flex max-w-sm items-center gap-2 text-xs text-subtle-foreground">
          <ShieldCheck className="size-3.5 shrink-0" /> {t("secure")}
        </p>
      </div>

      <aside className="relative hidden overflow-hidden bg-[#0B1113] lg:block">
        {/* Brand-tinted mesh */}
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_20%,color-mix(in_oklch,var(--brand-light)_55%,transparent),transparent),radial-gradient(50%_45%_at_20%_85%,color-mix(in_oklch,var(--accent-light)_35%,transparent),transparent)]" />
        <div className="bg-grid absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(70%_60%_at_50%_40%,black,transparent)] [--foreground:white]" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white xl:p-16">
          <div />
          <div className="max-w-md">
            <h2 className="text-[34px] leading-tight font-semibold tracking-tight text-balance">{t("featureTitle")}</h2>
            <ul className="mt-8 space-y-4">
              {(["feature1", "feature2", "feature3"] as const).map((k) => (
                <li key={k} className="flex items-start gap-3 text-[15px] text-white/80">
                  <CheckCircle2 className="mt-1 size-[18px] shrink-0 text-[color-mix(in_oklch,var(--brand-light)_40%,white)]" />
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>
          <TimelineCard />
        </div>
      </aside>
    </div>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="relative size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 21h18M5 21V9l7-5 7 5v12" strokeLinejoin="round" />
      <path d="M9 21v-6h6v6" strokeLinejoin="round" />
    </svg>
  );
}

/** Decorative glimpse of the client page timeline. */
function TimelineCard() {
  const steps = [
    { w: "w-24", done: true },
    { w: "w-32", done: true },
    { w: "w-20", done: true },
    { w: "w-28", done: false },
  ];
  return (
    <div className="ms-auto w-80 rounded-2xl border border-white/10 bg-white/[0.06] p-5 shadow-2xl backdrop-blur-xl" aria-hidden>
      <div className="flex items-center justify-between">
        <div className="h-2.5 w-28 rounded-full bg-white/30" />
        <div className="rounded-full bg-[color-mix(in_oklch,var(--brand-light)_60%,white)]/90 px-2 py-0.5 font-latin text-[10px] font-semibold text-[#0B1113]">
          P-2026-014
        </div>
      </div>
      <div className="mt-5 space-y-3.5">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-3">
            <span
              className={`flex size-5 items-center justify-center rounded-full ${s.done ? "bg-white text-[#0B1113]" : "border border-white/30"}`}
            >
              {s.done && (
                <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m2.5 6 2.5 2.5 4.5-5" />
                </svg>
              )}
            </span>
            <span className={`h-2 rounded-full ${s.done ? "bg-white/50" : "bg-white/20"} ${s.w}`} />
          </div>
        ))}
      </div>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-3/4 rounded-full bg-gradient-to-l from-white to-white/60" />
      </div>
    </div>
  );
}
