import { ContractView } from "@/components/contracts/contract-views";
import { SAMPLE_CONTRACT } from "../../../sample-contracts";
import { SAMPLE_ORG } from "../../../sample-quotes";

export default function P() {
  return <ContractView detail={SAMPLE_CONTRACT} org={SAMPLE_ORG} base="/dev/preview" />;
}
