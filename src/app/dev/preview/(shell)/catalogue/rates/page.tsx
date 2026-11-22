import { RatesView } from "@/components/catalogue/rates-view";
import { SAMPLE_RATES } from "../../../sample-engine";

export default function P() {
  return <RatesView rates={SAMPLE_RATES} canManage />;
}
