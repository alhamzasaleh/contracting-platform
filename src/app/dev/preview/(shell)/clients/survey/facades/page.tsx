import { SurveyView } from "@/components/clients/survey-view";
import { SAMPLE_FACADES, SAMPLE_SURVEY } from "../../../../sample-clients";
import { previewMapLink, previewNoop, previewPlace } from "../../../../preview-actions";

/** The survey with façades approved from the elevations, and a typed façade area that differs. */
export default function P() {
  return (
    <SurveyView
      detail={{ ...SAMPLE_SURVEY, survey: { ...SAMPLE_SURVEY.survey, facades: SAMPLE_FACADES, totals: { ...SAMPLE_SURVEY.survey.totals, facade: 250 } } }}
      canManage
      canQuote
      base="/dev/preview"
      facadeSample={SAMPLE_FACADES}
      siteActions={{ saveSite: previewNoop, readLink: previewMapLink, readPlace: previewPlace }}
    />
  );
}
