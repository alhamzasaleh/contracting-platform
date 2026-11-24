import { unstable_isUnrecognizedActionError, unstable_rethrow } from "next/navigation";

/** What a failed call turns into (error keys under `errors.*` in messages). */
export type CallFailure = { ok: false; error: "connection" | "appUpdated"; fieldErrors?: Record<string, string> };

/**
 * Calls a server action from the browser and never lets a failed call escape.
 *
 * A server action awaited inside a transition that throws (connection dropped, server error,
 * the app updated since the page opened) goes to the page's error boundary: the whole page is
 * replaced by «صار خلل…» and what the user typed is lost. Through settle() the caller gets an
 * ordinary failed result instead, shows a message and keeps the form open.
 * Next's own redirects / not-found (e.g. a signed-out user sent to /login) are still thrown.
 */
export async function settle<R>(call: () => R | PromiseLike<R>): Promise<R | CallFailure> {
  try {
    return await call();
  } catch (error) {
    unstable_rethrow(error);
    if (unstable_isUnrecognizedActionError(error)) return { ok: false, error: "appUpdated" };
    console.error("[action] call failed", error instanceof Error ? error.name : typeof error);
    return { ok: false, error: "connection" };
  }
}
