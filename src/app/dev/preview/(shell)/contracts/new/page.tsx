import { ContractEditor } from "@/components/contracts/contract-views";
import { SAMPLE_CONTRACT_DRAFT } from "../../../sample-contracts";

export default function P() {
  return <ContractEditor draft={SAMPLE_CONTRACT_DRAFT} base="/dev/preview" />;
}
