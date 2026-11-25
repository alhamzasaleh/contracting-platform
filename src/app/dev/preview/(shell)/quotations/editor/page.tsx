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
      partners={[{ id: "mk1", number: "MK-2026-001", name: "سعد بن فهد الدوسري", is_active: true, commission_percent: 5 }]}
      partnerId="mk1"
      base="/dev/preview"
      history={{
        won: 7, lost: 3, winRate: 70, wonMargin: 26.5, lostMargin: 32, suggestedMargin: 26.5, durationFactor: 1.18,
        pricePerM2: [{ workType: "walls", median: 31, count: 7 }, { workType: "ceilings", median: 28, count: 6 }],
      }}
    />
  );
}
