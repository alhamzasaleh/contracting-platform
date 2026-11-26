import { SurveyView } from "@/components/clients/survey-view";
import { SAMPLE_SURVEY } from "../../../../sample-clients";
import { previewMapLink, previewNoop, previewPlace } from "../../../../preview-actions";

/** The survey whose contract was sent: its place is frozen («انرسل العقد وتجمّد مكانه»). */
export default function P() {
  return (
    <SurveyView
      detail={{ ...SAMPLE_SURVEY, sentContract: "C-2026-004", canOpenContract: true }}
      canManage
      canQuote
      base="/dev/preview"
      siteActions={{ saveSite: previewNoop, readLink: previewMapLink, readPlace: previewPlace }}
    />
  );
}
