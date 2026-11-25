import { QuoteView } from "@/components/quotes/quote-views";
import type { QuoteDetail } from "@/lib/data/quotes";
import { previewNoop } from "../../../preview-actions";
import { SAMPLE_ORG, SAMPLE_QUOTE } from "../../../sample-quotes";

/** The client accepted on his page: «create the contract» stands out. */
const ACCEPTED: QuoteDetail = {
  ...SAMPLE_QUOTE,
  quote: { ...SAMPLE_QUOTE.quote, status: "issued", valid_until: "2026-11-30" },
  approvals: [],
  clientDecision: { decision: "accepted", at: "2026-11-23T18:40:00Z", name: SAMPLE_QUOTE.client.name, note: null, version: 2, ip: "188.48.10.7" },
  link: { active: true, expires_at: "2026-12-31T21:00:00Z", open_count: 3, last_opened_at: "2026-11-23T10:00:00Z", onContract: false },
  // the owner sees «حذف العرض» disabled: the client's acceptance is a record
  canDelete: true,
};

export default function P() {
  return (
    <QuoteView
      detail={ACCEPTED}
      org={SAMPLE_ORG}
      warrantyMonths={6}
      base="/dev/preview"
      actions={{ issue: previewNoop, decide: previewNoop, options: previewNoop, send: previewNoop, revokeLink: previewNoop, deleteQuote: previewNoop }}
    />
  );
}
