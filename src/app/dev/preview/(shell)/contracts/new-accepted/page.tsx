import { ContractEditor } from "@/components/contracts/contract-views";
import { SAMPLE_CONTRACT_DRAFT_ACCEPTED } from "../../../sample-contracts";
import { SAMPLE_SCHEDULE } from "../../../sample-schedule";

/** A new contract from a quote the client accepted on his page (his option shown, no second choice). */
export default function P() {
  return <ContractEditor draft={SAMPLE_CONTRACT_DRAFT_ACCEPTED} base="/dev/preview" busy={{ teams: SAMPLE_SCHEDULE.teams, entries: SAMPLE_SCHEDULE.entries }} />;
}
