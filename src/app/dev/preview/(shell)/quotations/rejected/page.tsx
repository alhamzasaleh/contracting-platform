import { QuoteView } from "@/components/quotes/quote-views";
import type { QuoteDetail } from "@/lib/data/quotes";
import { previewNoop } from "../../../preview-actions";
import { SAMPLE_ORG, SAMPLE_QUOTE } from "../../../sample-quotes";

/** The client declined on his page (with a reason). */
const REJECTED: QuoteDetail = {
  ...SAMPLE_QUOTE,
  quote: { ...SAMPLE_QUOTE.quote, status: "rejected", valid_until: "2026-11-30" },
  approvals: [],
  clientDecision: { decision: "rejected", at: "2026-11-23T18:40:00Z", name: null, note: "السعر أعلى من الميزانية.", version: null, ip: "188.48.10.7" },
  link: { active: false, expires_at: null, open_count: 3, last_opened_at: "2026-11-23T10:00:00Z", onContract: false },
};

export default function P() {
  return (
    <QuoteView
      detail={REJECTED}
      org={SAMPLE_ORG}
      warrantyMonths={6}
      base="/dev/preview"
      actions={{ issue: previewNoop, decide: previewNoop, options: previewNoop, send: previewNoop, revokeLink: previewNoop }}
    />
  );
}
