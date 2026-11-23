import { ClausesPanel } from "@/components/contracts/clauses-panel";

export default function PreviewContractTemplate() {
  return (
    <ClausesPanel
      mode="template"
      initial={{ overrides: { warranty: { body: "يضمن الطرف الأول الأعمال لمدة {warranty} أشهر من الاستلام النهائي." } }, custom: [{ id: "c-sample", title: "الكهرباء والماء", body: "يوفّر الطرف الثاني الكهرباء والماء في الموقع طوال مدة العمل.", after: "second" }] }}
    />
  );
}
