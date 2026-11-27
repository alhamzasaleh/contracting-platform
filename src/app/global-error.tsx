"use client";
import "./globals.css";
import { GLOBAL_ERROR_TEXT as TEXT, retryOf } from "@/lib/error-page";

/**
 * The root layout itself failed (no providers or theme here): a fixed Arabic + English page
 * (GLOBAL_ERROR_TEXT in src/lib/error-page.ts; the whole messages files aren't imported — this
 * component ships with every page) in the identity's colours instead of Next's English one.
 */
export default function GlobalError(props: { error: unknown; retry?: () => void; unstable_retry?: () => void; reset?: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#22262A", color: "#EFEBE3", fontFamily: "Almarai, system-ui, sans-serif", textAlign: "center", padding: 16 }}>
        <title>{TEXT.name}</title>
        <div style={{ display: "grid", gap: 12, maxWidth: 420 }}>
          <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{TEXT.ar.title}</p>
          <p style={{ fontSize: 14, margin: 0, opacity: 0.8 }}>{TEXT.ar.body}</p>
          <p dir="ltr" style={{ fontSize: 13, margin: 0, opacity: 0.6 }}>
            {TEXT.en.title} — {TEXT.en.body}
          </p>
          <button
            type="button"
            onClick={retryOf(props)}
            style={{ justifySelf: "center", marginTop: 8, border: 0, borderRadius: 9999, padding: "10px 22px", background: "#9A5231", color: "#EFEBE3", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
          >
            {TEXT.ar.retry} · {TEXT.en.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
