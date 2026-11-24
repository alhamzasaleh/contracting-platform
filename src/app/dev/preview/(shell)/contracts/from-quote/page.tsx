import { ContractView } from "@/components/contracts/contract-views";
import type { ContractDetail } from "@/lib/data/contracts";
import { previewNoop } from "../../../preview-actions";
import { SAMPLE_CONTRACT } from "../../../sample-contracts";
import { SAMPLE_ORG } from "../../../sample-quotes";

/**
 * A draft contract made from a quote the client accepted on his page: the client already has the
 * link (issued from the quote), so «send the contract» puts it on that same page — no new link.
 */
const FROM_QUOTE: ContractDetail = {
  ...SAMPLE_CONTRACT,
  contract: { ...SAMPLE_CONTRACT.contract, status: "draft" },
  payments: SAMPLE_CONTRACT.payments.map((p) => ({ ...p, id: `pay-${p.seq}`, status: "pending", paid_amount: 0, requestable: false })),
  addenda: [],
  receipts: [],
  link: { active: true, expires_at: "2027-07-10T00:00:00Z", last_opened_at: "2026-11-23T18:30:00Z", open_count: 4 },
  quoteAccepted: { at: "2026-11-23T18:40:00Z", name: SAMPLE_CONTRACT.client.name },
};

export default function P() {
  return (
    <ContractView
      detail={FROM_QUOTE}
      org={SAMPLE_ORG}
      base="/dev/preview"
      actions={{ send: previewNoop, revoke: previewNoop, cancel: previewNoop }}
      addendaActions={{ save: previewNoop, send: previewNoop, cancel: previewNoop, decide: previewNoop, paid: previewNoop }}
      termsSave={previewNoop}
      requestPayment={previewNoop}
    />
  );
}
