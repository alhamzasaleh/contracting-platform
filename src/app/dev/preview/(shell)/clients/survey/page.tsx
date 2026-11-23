import { SurveyView } from "@/components/clients/survey-view";
import { SAMPLE_SURVEY } from "../../../sample-clients";

export default function P() {
  return <SurveyView detail={SAMPLE_SURVEY} canManage canQuote base="/dev/preview" />;
}
