import { QuoteEditorView } from "@/components/quotes/quote-views";
import { SAMPLE_SURVEY } from "../../../sample-clients";
import { SAMPLE_PRICING_CTX, SAMPLE_QUANTITIES } from "../../../sample-quotes";

export default function P() {
  return (
    <QuoteEditorView
      kind="interior"
      quantities={SAMPLE_QUANTITIES}
      gaps={[]}
      survey={{ id: "s1", number: SAMPLE_SURVEY.survey.number, title: SAMPLE_SURVEY.survey.title, mode: "rooms" }}
      client={SAMPLE_SURVEY.client}
      quote={null}
      initial={null}
      discount={0}
      method="unit"
      notes={null}
      ctx={SAMPLE_PRICING_CTX}
      templates={{}}
      canSeeCrewCost
      base="/dev/preview"
    />
  );
}
