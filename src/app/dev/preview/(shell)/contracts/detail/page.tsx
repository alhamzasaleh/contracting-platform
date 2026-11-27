import { ContractView } from "@/components/contracts/contract-views";
import type { ContractDetail } from "@/lib/data/contracts";
import { previewNoop } from "../../../preview-actions";
import { SAMPLE_CONTRACT, SAMPLE_PAYMENTS } from "../../../sample-contracts";
import { SAMPLE_ORG } from "../../../sample-quotes";

/** Accepted by the client: signing payment requested (9 days ago) and partly paid, material supply waiting for staff to request it. */
const ACCEPTED: ContractDetail = {
  ...SAMPLE_CONTRACT,
  contract: { ...SAMPLE_CONTRACT.contract, status: "accepted", accepted_at: "2026-11-23T10:15:00Z", accepted_name: SAMPLE_CONTRACT.client.name, accepted_ip: "188.48.10.20", accepted_user_agent: "Mozilla/5.0 (iPhone)", signed: true },
  payments: SAMPLE_PAYMENTS.map((p, i) => ({
    ...p,
    id: `pay-${p.seq}`,
    status: i === 0 ? "requested" : "pending",
    paid_amount: i === 0 ? Math.round(p.amount / 2) : 0,
    requestable: p.due_event === "material_supply",
    // requested 9 days ago: the WhatsApp reminder says it's late
    late_days: i === 0 ? 9 : null,
  })),
  // quantity settlement: one sheet signed by the client (+517.50), one still with him
  measurements: {
    sheets: [
      { number: "MS-2026-001", status: "approved", diff_subtotal: 450, diff_total: 517.5, credit_amount: 0, refunded_at: null },
      { number: "MS-2026-002", status: "sent", diff_subtotal: -190, diff_total: -218.5, credit_amount: 0, refunded_at: null },
    ],
    net: 450,
    total: 517.5,
    owed: 0,
  },
};

export default function P() {
  return (
    <ContractView
      detail={ACCEPTED}
      org={SAMPLE_ORG}
      base="/dev/preview"
      actions={{ send: previewNoop, revoke: previewNoop, cancel: previewNoop }}
      addendaActions={{ save: previewNoop, send: previewNoop, cancel: previewNoop, decide: previewNoop, paid: previewNoop, saveCost: previewNoop }}
      termsSave={previewNoop}
      requestPayment={previewNoop}
    />
  );
}
