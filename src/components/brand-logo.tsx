import { cn } from "@/lib/utils";

/**
 * The company logo (§6.1): one single-colour file with a transparent
 * background, painted with `currentColor` through a CSS mask — so it takes
 * gypsum on dark surfaces and basalt on light ones. Set the width with
 * `className` (e.g. "w-[120px]"); the height follows the file's own ratio.
 * Never framed, stretched or recoloured beyond the identity colours.
 */
export function BrandLogo({ src, label, className }: { src: string; label: string; className?: string }) {
  const url = `url("${src.replace(/["\\\n]/g, "")}")`;
  return (
    <span role="img" aria-label={label} className={cn("relative inline-block shrink-0 align-middle", className)}>
      {/* invisible copy only gives the box the logo's proportions */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" aria-hidden className="invisible block h-auto w-full" />
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
