import { ContractEditor } from "@/components/contracts/contract-views";
import { SAMPLE_CONTRACT_DRAFT } from "../../../sample-contracts";
import { SAMPLE_SCHEDULE } from "../../../sample-schedule";

export default function P() {
  return <ContractEditor draft={SAMPLE_CONTRACT_DRAFT} base="/dev/preview" busy={{ teams: SAMPLE_SCHEDULE.teams, entries: SAMPLE_SCHEDULE.entries }} />;
}
