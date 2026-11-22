import { CalculatorView } from "@/components/catalogue/calculator-view";
import { SAMPLE_ENGINE_DATA } from "../../../sample-engine";

export default function P() {
  return <CalculatorView data={SAMPLE_ENGINE_DATA} vatPercent={0} />;
}
