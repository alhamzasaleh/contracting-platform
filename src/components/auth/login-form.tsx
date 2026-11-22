"use client";
import { ArrowLeft, Pencil } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { requestOtp, verifyOtp } from "@/app/(auth)/login/actions";
import { useFormatter } from "@/components/formatter-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { normalizeSaudiMobile } from "@/lib/validation/phone";
import { OtpInput } from "./otp-input";

type Step = "phone" | "code";
const RESEND_SECONDS = 60;

export function LoginForm({ next, demo }: { next?: string; demo?: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const { fmt } = useFormatter();
  const [step, setStep] = React.useState<Step>("phone");
  const [phone, setPhone] = React.useState("");
  const [normalized, setNormalized] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [countdown, setCountdown] = React.useState(0);

  React.useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const errorText = (key: string) =>
    key === "rateLimited" ? t("common.rateLimited") : key === "error" ? t("common.error") : t(`auth.${key}`);

  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    const n = normalizeSaudiMobile(phone);
    if (!n) return setError(errorText("phoneInvalid"));
    if (demo) {
      setNormalized(n);
      setStep("code");
      setCountdown(RESEND_SECONDS);
      return;
    }
    startTransition(async () => {
      const r = await requestOtp({ phone: n });
      if (!r.ok) return setError(errorText(r.error));
      setNormalized(n);
      setStep("code");
      setCountdown(RESEND_SECONDS);
    });
  };

  const verify = (value = code) => {
    if (!normalized || value.length !== 6 || demo) return;
    setError(null);
    startTransition(async () => {
      const r = await verifyOtp({ phone: normalized, code: value, next });
      if (!r.ok) {
        setCode("");
        return setError(errorText(r.error));
      }
      router.replace(r.next ?? "/");
      router.refresh();
    });
  };

  const pretty = normalized ? `+966 ${normalized.slice(3, 5)} ${normalized.slice(5, 8)} ${normalized.slice(8)}` : "";

  return (
    <div>
      <AnimatePresence mode="wait" initial={false}>
        {step === "phone" ? (
          <motion.form
            key="phone"
            onSubmit={send}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-6"
            noValidate
          >
            <div>
              <h1 className="text-[28px] font-extrabold">{t("auth.welcome")}</h1>
              <p className="mt-2 text-[15px] text-muted-foreground">{t("auth.subtitle")}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">{t("auth.phone")}</Label>
              <div className="relative" dir="ltr">
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder={t("auth.phonePlaceholder")}
                  className="h-14 pl-[6.25rem] font-latin text-lg tracking-wide"
                  autoFocus
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "phone-error" : undefined}
                />
                <span className="pointer-events-none absolute inset-y-0 left-0 my-3 flex items-center gap-2 border-r border-border pr-3 pl-4 font-latin text-[15px] text-muted-foreground">
                  <span aria-hidden>🇸🇦</span>+966
                </span>
              </div>
              {error && (
                <p id="phone-error" className="text-[13px] text-danger" role="alert">
                  {error}
                </p>
              )}
            </div>
            <Button type="submit" size="xl" loading={pending} className="w-full">
              {t("auth.sendCode")}
              {!pending && <ArrowLeft className="ltr:rotate-180" />}
            </Button>
            <p className="text-center text-xs leading-relaxed text-subtle-foreground">{t("auth.legal")}</p>
          </motion.form>
        ) : (
          <motion.div
            key="code"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-6"
          >
            <div>
              <h1 className="text-[28px] font-extrabold">{t("auth.code")}</h1>
              <p className="mt-2 text-[15px] text-muted-foreground">
                {t("auth.codeSentTo")}{" "}
                <span className="ltr-inline font-medium text-foreground">{fmt.digits(pretty)}</span>
              </p>
            </div>
            <div className="grid gap-2">
              <OtpInput
                value={code}
                onChange={(v) => {
                  setCode(v);
                  if (error) setError(null);
                }}
                onComplete={verify}
                invalid={Boolean(error)}
                disabled={pending}
                label={t("auth.code")}
              />
              {error && (
                <p className="text-[13px] text-danger" role="alert">
                  {error}
                </p>
              )}
            </div>
            <Button size="xl" className="w-full" loading={pending} disabled={code.length !== 6} onClick={() => verify()}>
              {t("auth.verify")}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setCode("");
                  setError(null);
                }}
                className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Pencil className="size-3.5" />
                {t("auth.changeNumber")}
              </button>
              <button
                type="button"
                disabled={countdown > 0 || pending}
                onClick={() => send()}
                className="font-medium text-primary disabled:font-normal disabled:text-subtle-foreground"
              >
                {countdown > 0 ? (
                  <span className="num">{t("auth.resendIn", { seconds: fmt.number(countdown) })}</span>
                ) : (
                  t("auth.resend")
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
