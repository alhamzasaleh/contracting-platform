"use client";
import { ArrowLeft, Fingerprint, Pencil, ScanFace } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { finishPasskeySignIn, requestOtp, verifyOtp } from "@/app/(auth)/login/actions";
import { useFormatter } from "@/components/formatter-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { deviceName, useBiometricKind, usePasskeySupport } from "@/lib/client/device";
import { createClient } from "@/lib/supabase/client";
import { normalizeSaudiMobile } from "@/lib/validation/phone";
import { OtpInput } from "./otp-input";
import { settle } from "@/lib/client/action";
import { useFailureText } from "@/lib/client/failure-text";

type Step = "phone" | "code" | "enroll";
const OFFERED_KEY = "malmas-passkey-offered";

function offered(): boolean {
  try {
    return localStorage.getItem(OFFERED_KEY) === "1";
  } catch {
    return true;
  }
}
function markOffered() {
  try {
    localStorage.setItem(OFFERED_KEY, "1");
  } catch {
    /* private mode */
  }
}
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
  const [target, setTarget] = React.useState("/");
  const passkeys = usePasskeySupport();
  const bio = useBiometricKind();
  const BioIcon = bio === "faceid" ? ScanFace : Fingerprint;

  React.useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const failure = useFailureText();
  const errorText = (key: string) =>
    failure(key) ??
    (key === "rateLimited" ? t("common.rateLimited") : key === "error" ? t("common.error") : t.has(`auth.${key}`) ? t(`auth.${key}`) : t("common.error"));

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
      const r = await settle(() => requestOtp({ phone: n }));
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
      const r = await settle(() => verifyOtp({ phone: normalized, code: value, next }));
      if (!r.ok) {
        setCode("");
        return setError(errorText(r.error));
      }
      // offer biometric sign-in once per device, right after the first code sign-in
      if (passkeys && !offered()) {
        setTarget(r.next ?? "/");
        setStep("enroll");
        return;
      }
      router.replace(r.next ?? "/");
      router.refresh();
    });
  };

  const go = (to: string) => {
    router.replace(to);
    router.refresh();
  };

  const signInWithPasskey = () => {
    if (demo) return;
    setError(null);
    startTransition(async () => {
      // a thrown error (browser without WebAuthn, connection lost) must not reach the error page
      const { error: err } = await createClient()
        .auth.signInWithPasskey()
        .catch((e: unknown) => ({ error: e instanceof Error ? e : new Error(String(e)) }));
      if (err) {
        const code = (err as { code?: string }).code ?? "";
        if (code === "ERROR_CEREMONY_ABORTED" || /NotAllowed|abort/i.test(err.message)) return; // the user cancelled
        return setError(t(/not.?found|credential/i.test(`${code} ${err.message}`) ? "auth.passkeyNone" : "auth.passkeyFailed"));
      }
      markOffered();
      const r = await settle(() => finishPasskeySignIn({ next }));
      if (!r.ok) return setError(errorText(r.error));
      go(r.next ?? "/");
    });
  };

  const enroll = () => {
    startTransition(async () => {
      const supabase = createClient();
      const { data, error: err } = await supabase.auth.registerPasskey().catch(() => ({ data: null, error: true as const }));
      markOffered();
      if (!err && data?.id) await supabase.auth.passkey.update({ passkeyId: data.id, friendlyName: deviceName() }).catch(() => undefined);
      go(target);
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
            {passkeys && (
              <>
                <div className="flex items-center gap-3 text-xs text-subtle-foreground" aria-hidden>
                  <span className="h-px flex-1 bg-border" />
                  {t("auth.or")}
                  <span className="h-px flex-1 bg-border" />
                </div>
                <Button type="button" variant="secondary" size="xl" className="w-full" disabled={pending} onClick={signInWithPasskey}>
                  <BioIcon />
                  {t(`auth.passkey_${bio}`)}
                </Button>
              </>
            )}
            <p className="text-center text-xs leading-relaxed text-subtle-foreground">{t("auth.legal")}</p>
          </motion.form>
        ) : step === "enroll" ? (
          <motion.div
            key="enroll"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-6"
          >
            <span className="flex size-16 items-center justify-center rounded-3xl bg-surface-2 text-primary">
              <BioIcon className="size-9" aria-hidden />
            </span>
            <div>
              <h1 className="text-[28px] font-extrabold">{t("auth.enrollTitle")}</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{t("auth.enrollBody")}</p>
            </div>
            <Button size="xl" className="w-full" loading={pending} onClick={enroll}>
              {t("auth.enroll")}
            </Button>
            <Button
              variant="ghost"
              size="xl"
              className="w-full"
              disabled={pending}
              onClick={() => {
                markOffered();
                go(target);
              }}
            >
              {t("auth.enrollLater")}
            </Button>
          </motion.div>
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
