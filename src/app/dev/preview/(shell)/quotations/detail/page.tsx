import { QuoteView } from "@/components/quotes/quote-views";
import { SAMPLE_ORG, SAMPLE_QUOTE } from "../../../sample-quotes";

export default function P() {
  return <QuoteView detail={{ ...SAMPLE_QUOTE, canDelete: true }} org={SAMPLE_ORG} warrantyMonths={6} base="/dev/preview" />;
}
