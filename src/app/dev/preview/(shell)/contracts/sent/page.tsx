import { ContractView } from "@/components/contracts/contract-views";
import type { ContractDetail } from "@/lib/data/contracts";
import { previewNoop } from "../../../preview-actions";
import { SAMPLE_CONTRACT } from "../../../sample-contracts";
import { SAMPLE_ORG } from "../../../sample-quotes";

/** Sent to the client, waiting for his acceptance: client-page link (create / renew), send, clauses still editable. */
const SENT: ContractDetail = {
  ...SAMPLE_CONTRACT,
  contract: { ...SAMPLE_CONTRACT.contract, status: "sent" },
  payments: SAMPLE_CONTRACT.payments.map((p) => ({ ...p, id: `pay-${p.seq}`, status: "pending", paid_amount: 0, requestable: false })),
  addenda: [],
  receipts: [],
};

export default function P() {
  return (
    <ContractView
      detail={SENT}
      org={SAMPLE_ORG}
      base="/dev/preview"
      actions={{ send: previewNoop, revoke: previewNoop, cancel: previewNoop }}
      addendaActions={{ save: previewNoop, send: previewNoop, cancel: previewNoop, decide: previewNoop, paid: previewNoop }}
      termsSave={previewNoop}
      requestPayment={previewNoop}
    />
  );
}
