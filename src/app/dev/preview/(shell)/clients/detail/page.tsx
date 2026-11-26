import { ClientDetailView } from "@/components/clients/clients-view";
import { previewMapLink, previewNoop } from "../../../preview-actions";
import { SAMPLE_CLIENT_DETAIL } from "../../../sample-clients";

/** As the owner sees it: «حذف العميل» disabled (he has contracts), a survey with quotes and one that can go. */
const OWNER = {
  ...SAMPLE_CLIENT_DETAIL,
  surveys: [
    { ...SAMPLE_CLIENT_DETAIL.surveys[0], quotes: 2 },
    { id: "s2", number: "SV-2026-006", title: "ملحق الحديقة", mode: "total" as const, visit_date: "2026-11-23", rooms: 0, quotes: 0 },
  ],
  canDelete: true,
  contractCount: 2,
};

export default function P() {
  return <ClientDetailView detail={OWNER} canManage canQuote base="/dev/preview" onDelete={previewNoop} onDeleteSurvey={previewNoop} onReadLink={previewMapLink} />;
}
