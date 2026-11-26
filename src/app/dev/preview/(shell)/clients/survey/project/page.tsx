import { SurveyView } from "@/components/clients/survey-view";
import { SAMPLE_SURVEY } from "../../../../sample-clients";
import { previewMapLink, previewNoop, previewPlace } from "../../../../preview-actions";

/** The survey whose contract was accepted: its project keeps the site it was sent with. */
export default function P() {
  return (
    <SurveyView
      detail={{ ...SAMPLE_SURVEY, project: "C-2026-003", canOpenProject: true }}
      canManage
      canQuote
      base="/dev/preview"
      siteActions={{ saveSite: previewNoop, readLink: previewMapLink, readPlace: previewPlace }}
    />
  );
}
