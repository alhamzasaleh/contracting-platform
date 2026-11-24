import type { ActionResult } from "@/lib/actions";

/**
 * Should a failed action show a message? Field errors only replace the message when the form shows
 * them (it passed onFieldErrors); otherwise a refused save would look saved (owner, Nov 2026: the
 * survey totals were refused with nothing on screen).
 */
export function actionFailureToast(r: ActionResult<unknown>, formShowsFieldErrors: boolean): boolean {
  if (r.ok) return false;
  const hasFieldErrors = !!r.fieldErrors && Object.keys(r.fieldErrors).length > 0;
  return !(hasFieldErrors && formShowsFieldErrors);
}
