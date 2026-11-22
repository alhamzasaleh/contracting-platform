import { LabourView } from "@/components/catalogue/labour-view";
import { SAMPLE_SERVICES } from "../../../sample-catalogue";

export default function P() {
  return (
    <LabourView
      labour={[
        { id: "l1", service_id: "s2", name: "مقاول دهانات — أبو فيصل", basis: "external_per_unit", rate: 9, notes: null, is_active: true },
        { id: "l2", service_id: "s1", name: "فريق جبس خارجي", basis: "external_lump", rate: 4500, notes: null, is_active: true },
      ]}
      extras={[
        { id: "x1", name: "تأجير سقالات", unit: "day", default_amount: 150, is_active: true },
        { id: "x2", name: "نقل مواد", unit: "trip", default_amount: 250, is_active: true },
      ]}
      services={SAMPLE_SERVICES.map((s) => ({ id: s.id, name_ar: s.name_ar }))}
      canManage
    />
  );
}
