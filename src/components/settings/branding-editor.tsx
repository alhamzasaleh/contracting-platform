"use client";
import { Check, ImageUp, RotateCcw, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { useFormatter } from "@/components/formatter-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import type { ActionResult } from "@/lib/actions";
import { contrastRatio, deriveTheme, isHex } from "@/lib/brand/color";
import { extractPalette } from "@/lib/brand/extract";
import { LOGO_MAX_BYTES, LOGO_TYPES } from "@/lib/validation/company";
import { cn } from "@/lib/utils";

type Brand = { primary: string; accent: string | null; source: "logo" | "manual" | "default" };

async function readPixels(file: File): Promise<Uint8ClampedArray> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const size = 120;
    const ratio = Math.min(size / (img.naturalWidth || size), size / (img.naturalHeight || size));
    const w = Math.max(1, Math.round((img.naturalWidth || size) * ratio));
    const h = Math.max(1, Math.round((img.naturalHeight || size) * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BrandingEditor({
  orgName,
  initialBrand,
  initialLogoUrl,
  canEdit,
  onSave,
  onRemoveLogo,
}: {
  orgName: string;
  initialBrand: Brand;
  initialLogoUrl: string | null;
  canEdit: boolean;
  onSave?: (fd: FormData) => Promise<ActionResult>;
  onRemoveLogo?: () => Promise<ActionResult>;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [brand, setBrand] = React.useState<Brand>(initialBrand);
  const [file, setFile] = React.useState<File | null>(null);
  const [logoUrl, setLogoUrl] = React.useState<string | null>(initialLogoUrl);
  const [swatches, setSwatches] = React.useState<string[]>([]);
  const [extracted, setExtracted] = React.useState<{ primary: string; accent: string | null } | null>(null);
  const [target, setTarget] = React.useState<"primary" | "accent">("primary");
  const [dragging, setDragging] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const dirty =
    file !== null || brand.primary !== initialBrand.primary || (brand.accent ?? null) !== (initialBrand.accent ?? null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!(LOGO_TYPES as readonly string[]).includes(f.type)) return toast.error(t("settings.logoTypes"));
    if (f.size > LOGO_MAX_BYTES) return toast.error(t("settings.logoTypes"));
    setFile(f);
    setLogoUrl((old) => {
      if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
    try {
      const palette = extractPalette(await readPixels(f));
      if (palette) {
        setSwatches(palette.swatches);
        setExtracted({ primary: palette.primary, accent: palette.accent });
        setBrand({ primary: palette.primary, accent: palette.accent, source: "logo" });
      }
    } catch {
      /* colour extraction is a convenience; ignore failures */
    }
  };

  const pick = (hex: string) => {
    setBrand((b) => ({ ...b, [target]: hex.toUpperCase(), source: "manual" }));
  };

  const save = () => {
    if (!onSave) return toast(t("preview.banner"));
    const fd = new FormData();
    fd.set("primary", brand.primary);
    if (brand.accent) fd.set("accent", brand.accent);
    fd.set("source", brand.source);
    if (file) fd.set("logo", file);
    startTransition(async () => {
      const r = await onSave(fd);
      if (r.ok) {
        toast.success(t("common.saved"));
        setFile(null);
        router.refresh();
      } else {
        toast.error(r.error === "noAccess" ? t("common.noAccess") : r.error === "badType" || r.error === "tooLarge" ? t("settings.logoTypes") : t("common.error"));
      }
    });
  };

  const remove = () => {
    if (!onRemoveLogo) return toast(t("preview.banner"));
    startTransition(async () => {
      const r = await onRemoveLogo();
      if (r.ok) {
        setLogoUrl(null);
        setFile(null);
        router.refresh();
      } else toast.error(t("common.error"));
    });
  };

  const theme = deriveTheme(brand.primary, brand.accent);
  const adjusted = theme.light.primary !== brand.primary.toUpperCase();

  return (
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.brandTitle")}</CardTitle>
          <CardDescription>{t("settings.brandHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (canEdit) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (canEdit) void onFile(e.dataTransfer.files[0]);
            }}
            className={cn(
              "group relative flex min-h-44 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center transition-colors",
              dragging ? "border-primary bg-primary-softer" : "border-border-strong/70 bg-surface-2/50",
              canEdit && "cursor-pointer hover:border-primary/50",
            )}
            onClick={() => canEdit && inputRef.current?.click()}
            role={canEdit ? "button" : undefined}
            tabIndex={canEdit ? 0 : undefined}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && canEdit && inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept={LOGO_TYPES.join(",")}
              className="sr-only"
              onChange={(e) => void onFile(e.target.files?.[0])}
              aria-label={t("settings.uploadLogo")}
            />
            {logoUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview / signed URL */}
                <img src={logoUrl} alt="" className="max-h-24 max-w-[70%] object-contain drop-shadow-sm" />
                {canEdit && (
                  <span className="text-[13px] font-medium text-primary">{t("settings.replaceLogo")}</span>
                )}
              </>
            ) : (
              <>
                <span className="flex size-12 items-center justify-center rounded-2xl bg-surface text-primary shadow-sm ring-1 ring-border transition-transform group-hover:-translate-y-0.5">
                  <ImageUp className="size-5" />
                </span>
                <div>
                  <p className="text-[14px] font-medium">{t("settings.dropLogo")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t("settings.logoTypes")}</p>
                </div>
              </>
            )}
          </div>

          {/* Extracted swatches */}
          <AnimatePresence>
            {swatches.length > 0 && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="overflow-hidden">
                <div className="mb-2.5 flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-[13px] font-medium">
                    <Sparkles className="size-3.5 text-primary" />
                    {t("settings.extracted")}
                  </p>
                  <p className="text-xs text-subtle-foreground">{t("settings.pickHint")}</p>
                </div>
                <div className="flex flex-wrap gap-2.5">
                  {swatches.map((s, i) => (
                    <motion.button
                      key={s}
                      type="button"
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: i * 0.04, type: "spring", bounce: 0.4 }}
                      onClick={() => pick(s)}
                      className="relative size-11 rounded-xl shadow-sm ring-1 ring-black/10 transition-transform hover:scale-105"
                      style={{ background: s }}
                      aria-label={s}
                    >
                      {(brand.primary === s || brand.accent === s) && (
                        <Check className="absolute inset-0 m-auto size-4" style={{ color: contrastRatio(s, "#FFFFFF") > 2.5 ? "#fff" : "#000" }} />
                      )}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Colour slots */}
          <div className="grid gap-3">
            <Segmented
              name={t("settings.brandTitle")}
              value={target}
              onChange={setTarget}
              options={[
                { value: "primary", label: t("settings.primary") },
                { value: "accent", label: t("settings.accent") },
              ]}
              className="w-full"
            />
            <div className="grid grid-cols-2 gap-3">
              <ColorSlot label={t("settings.primary")} value={brand.primary} active={target === "primary"} disabled={!canEdit} onFocus={() => setTarget("primary")} onChange={(v) => setBrand((b) => ({ ...b, primary: v, source: "manual" }))} />
              <ColorSlot label={t("settings.accent")} value={brand.accent ?? theme.light.accent} active={target === "accent"} disabled={!canEdit} onFocus={() => setTarget("accent")} onChange={(v) => setBrand((b) => ({ ...b, accent: v, source: "manual" }))} />
            </div>
            <p className={cn("flex items-start gap-2 text-[13px]", adjusted ? "text-muted-foreground" : "text-success")}>
              {adjusted ? <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" /> : <Check className="mt-0.5 size-3.5 shrink-0" />}
              {adjusted ? t("settings.contrastAdjusted") : t("settings.contrastOk")}
            </p>
          </div>
        </CardContent>
        {canEdit && (
          <CardFooter className="justify-between">
            <div className="flex gap-1">
              {extracted && (brand.primary !== extracted.primary || brand.accent !== extracted.accent) && (
                <Button variant="ghost" size="sm" onClick={() => setBrand({ ...extracted, source: "logo" })}>
                  <RotateCcw /> {t("settings.resetColors")}
                </Button>
              )}
              {logoUrl && !file && (
                <Button variant="ghost" size="sm" onClick={remove} disabled={pending} className="text-danger hover:text-danger">
                  <Trash2 /> {t("common.delete")}
                </Button>
              )}
            </div>
            <Button onClick={save} loading={pending} disabled={!dirty}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </CardFooter>
        )}
      </Card>

      <BrandPreview orgName={orgName} logoUrl={logoUrl} primary={theme.light.primary} accent={theme.light.accent} rawPrimary={brand.primary} />
    </div>
  );
}

function ColorSlot({
  label,
  value,
  active,
  disabled,
  onChange,
  onFocus,
}: {
  label: string;
  value: string;
  active: boolean;
  disabled?: boolean;
  onChange: (v: string) => void;
  onFocus: () => void;
}) {
  const [text, setText] = React.useState(value);
  const [prev, setPrev] = React.useState(value);
  if (prev !== value) {
    // Sync the text box when the colour changes from outside (swatch / picker).
    setPrev(value);
    setText(value);
  }
  return (
    <label
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-surface p-2.5 transition-shadow",
        active ? "border-primary ring-4 ring-primary/10" : "border-border",
      )}
      onFocus={onFocus}
    >
      <span className="relative size-10 shrink-0 overflow-hidden rounded-lg shadow-sm ring-1 ring-black/10" style={{ background: value }}>
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          aria-label={label}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <input
          value={text}
          disabled={disabled}
          dir="ltr"
          onChange={(e) => {
            const v = e.target.value.trim();
            setText(v);
            const hex = v.startsWith("#") ? v : `#${v}`;
            if (isHex(hex)) onChange(hex.toUpperCase());
          }}
          className="w-full bg-transparent font-latin text-sm font-medium uppercase outline-none rtl:text-right"
          aria-label={`${label} HEX`}
        />
      </span>
    </label>
  );
}

/** Live preview of how the brand appears on a quotation and the client page. */
function BrandPreview({
  orgName,
  logoUrl,
  primary,
  accent,
  rawPrimary,
}: {
  orgName: string;
  logoUrl: string | null;
  primary: string;
  accent: string;
  rawPrimary: string;
}) {
  const t = useTranslations("settings");
  const { fmt } = useFormatter();
  const [tab, setTab] = React.useState<"quote" | "client">("quote");
  const vars = { "--p": primary, "--a": accent, "--raw": rawPrimary } as React.CSSProperties;

  return (
    <Card className="overflow-hidden" style={vars}>
      <CardHeader className="flex-row flex-wrap items-center justify-between">
        <CardTitle>{t("preview")}</CardTitle>
        <Segmented
          name={t("preview")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "quote", label: t("previewQuote") },
            { value: "client", label: t("previewClient") },
          ]}
        />
      </CardHeader>
      <CardContent>
        <div className="rounded-2xl bg-surface-sunken p-4 sm:p-6">
          <AnimatePresence mode="wait">
            {tab === "quote" ? (
              <motion.div
                key="quote"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="mx-auto aspect-[1/1.2] max-w-sm overflow-hidden rounded-lg bg-white text-[#111] shadow-lg ring-1 ring-black/5"
              >
                <div className="h-1.5 bg-gradient-to-l from-[var(--raw)] to-[var(--a)]" />
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <PreviewLogo logoUrl={logoUrl} orgName={orgName} />
                    <div className="text-end">
                      <p className="text-[13px] font-bold text-[var(--p)]">عرض سعر</p>
                      <p className="font-latin text-[10px] text-gray-500 ltr-inline">{fmt.digits("Q-2026-001")}</p>
                    </div>
                  </div>
                  <p className="mt-4 text-[11px] font-semibold">{orgName}</p>
                  <div className="mt-4 space-y-1.5">
                    {[70, 85, 60].map((w, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 border-b border-gray-100 pb-1.5">
                        <span className="h-1.5 rounded-full bg-gray-200" style={{ width: `${w}%` }} />
                        <span className="h-1.5 w-10 rounded-full bg-gray-300" />
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center justify-between rounded-md bg-[color-mix(in_oklch,var(--p)_8%,white)] px-3 py-2">
                    <span className="text-[10px] font-semibold">الإجمالي شامل الضريبة</span>
                    <span className="num text-[12px] font-bold text-[var(--p)]">{fmt.money(48300)}</span>
                  </div>
                  <div className="mt-4 h-7 w-28 rounded-md bg-[var(--p)]" />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="client"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="mx-auto max-w-[280px] overflow-hidden rounded-[28px] border-[6px] border-[#111] bg-white text-[#111] shadow-xl"
              >
                <div className="relative bg-[var(--raw)] px-4 pt-5 pb-10 text-white">
                  <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_100%_0%,rgba(255,255,255,.25),transparent)]" />
                  <div className="relative flex items-center gap-2">
                    <PreviewLogo logoUrl={logoUrl} orgName={orgName} className="h-7 rounded-md bg-white p-0.5" />
                    <span className="text-[11px] font-semibold">{orgName}</span>
                  </div>
                  <p className="relative mt-4 text-[15px] font-bold">فيلا العليا — دهانات داخلية</p>
                  <p className="relative font-latin text-[10px] opacity-80 ltr-inline">{fmt.digits("P-2026-014")}</p>
                </div>
                <div className="-mt-6 px-3 pb-4">
                  <div className="rounded-xl bg-white p-3 shadow-md ring-1 ring-black/5">
                    {["تجهيز الموقع", "المعجون", "الدهان النهائي"].map((s, i) => (
                      <div key={s} className="flex items-center gap-2 py-1.5">
                        <span
                          className={cn(
                            "flex size-4 items-center justify-center rounded-full text-white",
                            i < 2 ? "bg-[var(--p)]" : "border border-gray-300 bg-white",
                          )}
                        >
                          {i < 2 && <Check className="size-2.5" strokeWidth={3} />}
                        </span>
                        <span className="text-[11px]">{s}</span>
                        {i === 2 && <Badge className="ms-auto bg-[color-mix(in_oklch,var(--a)_14%,white)] px-1.5 text-[9px] text-[var(--a)] ring-0">جارٍ</Badge>}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 rounded-lg bg-[var(--p)] py-2 text-center text-[11px] font-semibold text-white">تأكيد استلام المرحلة</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  );
}

function PreviewLogo({ logoUrl, orgName, className }: { logoUrl: string | null; orgName: string; className?: string }) {
  return logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- local preview / signed URL
    <img src={logoUrl} alt="" className={cn("h-9 w-auto max-w-28 object-contain", className)} />
  ) : (
    <span className={cn("flex size-9 items-center justify-center rounded-lg bg-[var(--raw)] font-bold text-white", className)}>
      {orgName.charAt(0)}
    </span>
  );
}
