import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { ArchMark } from "@/components/shell/org-mark";

/**
 * "Atelier" auth layout. On iPad/desktop: ink brand panel with the arch
 * on one side, sand form panel on the other. On phones: ink top with the
 * arch, form in a sand sheet below.
 */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("auth");
  const tApp = useTranslations("app");
  return (
    <div className="flex min-h-dvh flex-col bg-ink lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Brand panel */}
      <aside className="relative flex flex-col items-center justify-center gap-6 overflow-hidden px-8 pt-[max(env(safe-area-inset-top),2.5rem)] pb-14 text-center text-ink-foreground lg:order-last lg:min-h-dvh lg:pb-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_45%_at_50%_45%,color-mix(in_oklch,var(--brand-dark)_14%,transparent),transparent)]" />
        <Arch />
        <div className="relative">
          <p className="text-[26px] font-extrabold text-gypsum lg:text-[34px]">{tApp("name")}</p>
          <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-ink-muted lg:text-[15px]">{t("featureTitle")}</p>
        </div>
        <ul className="relative hidden max-w-sm space-y-3 text-start lg:block">
          {(["feature1", "feature2", "feature3"] as const).map((k) => (
            <li key={k} className="flex items-start gap-3 text-[14px] text-ink-foreground">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--brand-dark)]" />
              {t(k)}
            </li>
          ))}
        </ul>
      </aside>

      {/* Form panel */}
      <div className="-mt-6 flex flex-1 flex-col rounded-t-[2rem] bg-background px-6 pt-8 pb-[max(env(safe-area-inset-bottom),1.5rem)] sm:px-10 lg:mt-0 lg:rounded-none lg:pt-10">
        <div className="hidden items-center gap-2.5 lg:flex">
          <ArchMark className="h-9 w-8" />
          <span className="text-[15px] font-extrabold">{tApp("name")}</span>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-4 lg:py-12">{children}</div>
        <p className="mx-auto mt-6 flex max-w-sm items-center gap-2 text-xs text-subtle-foreground">
          <ShieldCheck className="size-3.5 shrink-0" /> {t("secure")}
        </p>
      </div>
    </div>
  );
}

/** The large arch with its doorway — the brand motif. */
function Arch() {
  return (
    <svg viewBox="0 0 150 190" className="relative h-32 w-auto lg:h-56" fill="none" aria-hidden>
      <path d="M2 188V75C2 34.7 34.7 2 75 2s73 32.7 73 73v113z" stroke="var(--brand-dark)" strokeWidth="2.5" />
      <path d="M48 188v-58a27 27 0 0 1 54 0v58z" fill="var(--brand-dark)" />
      <path d="M2 188h146" stroke="var(--brand-dark)" strokeWidth="2.5" />
    </svg>
  );
}
