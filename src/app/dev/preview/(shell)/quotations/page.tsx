import { QuotesView } from "@/components/quotes/quote-views";
import { SAMPLE_QUOTES } from "../../sample-quotes";

export default function P() {
  return <QuotesView quotes={SAMPLE_QUOTES} base="/dev/preview" />;
}
