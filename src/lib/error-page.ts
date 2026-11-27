/**
 * Where «الرئيسية» on an error page may go: staff pages → the app's home; a client's or a success
 * partner's or a subcontractor's own page (/p/…, /m/…, /s/…) → nowhere (home is the staff sign-in, not for them).
 */
export function errorHomeHref(pathname: string | null | undefined): string | null {
  return pathname && /^\/(p|m|s)(\/|$)/.test(pathname) ? null : "/";
}

/** The retry an error boundary got (Next 16.2+: retry re-fetches; older: reset re-renders). */
export function retryOf(p: { retry?: () => void; unstable_retry?: () => void; reset?: () => void }): () => void {
  return p.retry ?? p.unstable_retry ?? p.reset ?? (() => window.location.reload());
}

/** The root-layout error page's fixed text (no messages there) = messages errorPage; tests/unit/error-pages.test.ts keeps them equal. */
export const GLOBAL_ERROR_TEXT = {
  name: "ملمس",
  ar: { title: "صار خلل أثناء فتح الصفحة", body: "جرّب مرة ثانية. إذا تكرر، تواصل معنا وقل لنا وش كنت تسوي.", retry: "حاول مرة ثانية" },
  en: { title: "Something went wrong opening this page", body: "Please try again. If it keeps happening, tell us what you were doing.", retry: "Try again" },
};
