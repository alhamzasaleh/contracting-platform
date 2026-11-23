import { cn } from "@/lib/utils";

/**
 * The company logo (§6.1): one single-colour file with a transparent
 * background, painted with `currentColor` through a CSS mask — so it takes
 * gypsum on dark surfaces and basalt on light ones. Size it with `fit`
 * (classes for the logo box): a width that follows the screen plus a height cap,
 * e.g. "w-[min(120px,32vw)] h-auto max-h-9". The logo is drawn "contained" in
 * that box, so it keeps its proportions for any file (PNG or SVG, wide or tall).
 * Never framed, stretched or recoloured beyond the identity colours.
 */
export function BrandLogo({ src, label, className, fit = "h-auto w-full" }: { src: string; label: string; className?: string; fit?: string }) {
  const url = `url("${src.replace(/["\\\n]/g, "")}")`;
  return (
    <span role="img" aria-label={label} className={cn("relative inline-block shrink-0 align-middle", className)}>
      {/* invisible copy only gives the box the logo's proportions */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" aria-hidden className={cn("invisible block object-contain", fit)} />
      <span
        aria-hidden
        className="absolute inset-0 bg-current"
        style={{
          maskImage: url,
          WebkitMaskImage: url,
          maskSize: "contain",
          WebkitMaskSize: "contain",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskPosition: "center",
          WebkitMaskPosition: "center",
          printColorAdjust: "exact",
          WebkitPrintColorAdjust: "exact",
        }}
      />
    </span>
  );
}
