import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { BrandLogo } from "@/components/brand-logo";

/**
 * Sign-in layout in the approved identity (§6.1): a basalt panel with the
 * company logo in gypsum (and a small clay 45° corner), the form on gypsum.
 * iPad/desktop: side by side. Phones: logo on top, form in a sheet below.
 * The logo scales with the screen and keeps its own proportions.
 */
export function AuthLayout({ children, identity }: { children: React.ReactNode; identity?: { name: string; logoUrl: string | null } | null }) {
  const t = useTranslations("auth");
  const tApp = useTranslations("app");
  const name = identity?.name ?? tApp("name");
  const year = new Date().getFullYear();
  return (
    <div className="flex min-h-dvh flex-col bg-ink lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Brand panel */}
      <aside className="relative flex flex-col items-center justify-center gap-5 overflow-hidden px-6 pt-[max(env(safe-area-inset-top),2.5rem)] pb-14 text-center text-ink-foreground sm:px-8 lg:order-last lg:min-h-dvh lg:gap-8 lg:pb-10">
        <span aria-hidden className="absolute end-0 top-0 size-10 bg-clay [clip-path:polygon(0_0,100%_0,100%_100%)] rtl:[clip-path:polygon(0_0,100%_0,0_100%)] lg:size-16" />
        {identity?.logoUrl ? (
          <BrandLogo src={identity.logoUrl} label={name} className="text-gypsum" fit="h-auto w-[min(220px,60vw)] max-h-24 sm:max-h-32 lg:max-h-44 lg:w-[min(300px,32vw)]" />
        ) : (
          <p className="text-[clamp(1.5rem,5vw,2.25rem)] font-extrabold text-gypsum">{name}</p>
        )}
        <p className="max-w-sm text-[14px] leading-relaxed text-ink-muted lg:text-[15px]">{t("featureTitle")}</p>
        <ul className="hidden max-w-sm space-y-3 text-start lg:block">
          {(["feature1", "feature2", "feature3"] as const).map((k) => (
            <li key={k} className="flex items-start gap-3 text-[14px] text-ink-foreground">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-clay" />
              {t(k)}
            </li>
          ))}
        </ul>
      </aside>

      {/* Form panel */}
      <div className="-mt-6 flex flex-1 flex-col rounded-t-[2rem] bg-background px-5 pt-8 pb-[max(env(safe-area-inset-bottom),1.5rem)] sm:px-10 lg:mt-0 lg:rounded-none lg:pt-10">
        <div className="hidden items-center lg:flex">
          {identity?.logoUrl ? (
            <BrandLogo src={identity.logoUrl} label={name} className="text-basalt dark:text-gypsum" fit="h-auto w-[140px] max-h-10" />
          ) : (
            <span className="text-[15px] font-extrabold">{name}</span>
          )}
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-4 lg:py-12">{children}</div>
        <div className="mx-auto mt-6 grid w-full max-w-sm gap-1.5 text-xs text-subtle-foreground">
          <p className="flex items-center gap-2">
            <ShieldCheck className="size-3.5 shrink-0" /> {t("secure")}
          </p>
          <p>{t("rights", { year, name })}</p>
        </div>
      </div>
    </div>
  );
}
