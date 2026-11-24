import { useTranslations } from "next-intl";
import * as React from "react";
import type { CallFailure } from "./action";

/**
 * The message key for a call that never got an answer (settle() → "connection" / "appUpdated"),
 * or null for a refusal the screen maps itself. On the client page the visitor is never told to
 * reload (his signature / note would be lost): "appUpdated" reads as "try again shortly".
 */
export function failureKey(error: string, opts: { clientPage?: boolean } = {}): string | null {
  if (error === "connection") return "errors.connection";
  if (error === "appUpdated") return opts.clientPage ? "errors.sendLater" : "errors.appUpdated";
  return null;
}

/** Every error settle() can return. */
export const CALL_FAILURES: CallFailure["error"][] = ["connection", "appUpdated"];

/** `failure(r.error) ?? <the screen's own message>` — use it on every result of a settle() call. */
export function useFailureText(opts: { clientPage?: boolean } = {}) {
  const t = useTranslations();
  const clientPage = !!opts.clientPage;
  return React.useCallback(
    (error: string): string | null => {
      const key = failureKey(error, { clientPage });
      return key ? t(key) : null;
    },
    [t, clientPage],
  );
}
