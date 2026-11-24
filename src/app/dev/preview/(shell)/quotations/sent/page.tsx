import { QuoteView } from "@/components/quotes/quote-views";
import type { QuoteDetail } from "@/lib/data/quotes";
import { previewNoop } from "../../../preview-actions";
import { SAMPLE_ORG, SAMPLE_QUOTE } from "../../../sample-quotes";

/** Issued and sent to the client; he asked for changes (the note shows, the link is active). */
const SENT: QuoteDetail = {
  ...SAMPLE_QUOTE,
  quote: { ...SAMPLE_QUOTE.quote, status: "issued", valid_until: "2026-11-30" },
  approvals: [],
  clientDecision: { decision: "changes_requested", at: "2026-11-23T10:15:00Z", name: null, note: "نبي لون الصالة أفتح، ونشيل دهان السقف في المجلس.", version: null, ip: "188.48.10.7" },
  link: { active: true, expires_at: "2026-12-31T21:00:00Z", open_count: 3, last_opened_at: "2026-11-23T10:00:00Z", onContract: false },
};

export default function P() {
  return (
    <QuoteView
      detail={SENT}
      org={SAMPLE_ORG}
      warrantyMonths={6}
      base="/dev/preview"
      actions={{ issue: previewNoop, decide: previewNoop, options: previewNoop, send: previewNoop, revokeLink: previewNoop }}
    />
  );
}
