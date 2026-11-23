import { ContractsView } from "@/components/contracts/contract-views";
import { SAMPLE_CONTRACTS } from "../../sample-contracts";

export default function P() {
  return <ContractsView contracts={SAMPLE_CONTRACTS} base="/dev/preview" />;
}
