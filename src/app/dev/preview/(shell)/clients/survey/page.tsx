import { SurveyView } from "@/components/clients/survey-view";
import { SAMPLE_SURVEY, SAMPLE_FACADES } from "../../../sample-clients";
import { previewMapLink, previewNoop, previewPlace } from "../../../preview-actions";

export default function P() {
  return <SurveyView
      detail={{ ...SAMPLE_SURVEY, canDelete: true, quotes: 0 }}
      canManage
      canQuote
      base="/dev/preview"
      facadeSample={SAMPLE_FACADES}
      siteActions={{ saveSite: previewNoop, readLink: previewMapLink, readPlace: previewPlace }}
      planSample={[
        {
          page: 8,
          floor: "الدور الأرضي",
          conflicts: ["جدول التشطيبات يذكر GF-01 و GF-02 و GF-04 وهي غير موجودة في المسقط"],
          rooms: [
            { label: "GF-07", name: "مجلس", unit_label: "الدور الأرضي", length_m: 6.2, width_m: 4.5, open_space: false, confirmed: true, notes: [] },
            { label: "GF-06", name: "غرفة طعام", unit_label: "الدور الأرضي", length_m: 4.9, width_m: 4.6, open_space: false, confirmed: true, notes: [] },
            { label: "GF-11", name: "ردهة وجلسة العائلة (جزء 1)", unit_label: "الدور الأرضي", length_m: 8.1, width_m: 3, open_space: true, confirmed: false, notes: ["الحد العلوي عند خط الدرج"] },
            { label: "GF-19", name: "مطبخ خارجي", unit_label: "الدور الأرضي", length_m: 4.02, width_m: 3.7, open_space: false, confirmed: false, notes: ["العمق 4.02 أو 4.71"] },
          ],
        },
        {
          page: 9,
          floor: "الدور الأول",
          conflicts: [],
          rooms: [
            { label: "F1-17", name: "غرفة النوم الرئيسية", unit_label: "الدور الأول", length_m: 7.5, width_m: 5.72, open_space: false, confirmed: true, notes: [] },
            { label: "GF-07", name: "مجلس", unit_label: "الدور الأول", length_m: 6.2, width_m: 4.5, open_space: false, confirmed: true, notes: [] },
            { label: "F1-04", name: "صالة", unit_label: "الدور الأول", length_m: 4.7, width_m: null, open_space: true, confirmed: false, notes: ["العرض لحد صندوق الدرج 4.30 أو 4.70"] },
          ],
        },
      ]}
      aiSample={{
        rooms: [
          { name: "المجلس", unit_label: "الدور الأرضي", length_m: 6, width_m: 5, height_m: 3.2, openings_m2: 4, gypsum_ceiling: true, ceiling_board: "normal", wall_zone: "normal", paint_walls: true, paint_ceiling: true, missing: [] },
          { name: "حمام الضيوف", unit_label: "الدور الأرضي", length_m: 2, width_m: 2.5, height_m: 3.2, openings_m2: 0, gypsum_ceiling: true, ceiling_board: "moisture", wall_zone: "wet", paint_walls: true, paint_ceiling: true, missing: ["height"] },
          { name: "المطبخ", unit_label: null, length_m: 4, width_m: null, height_m: 3.2, openings_m2: 0, gypsum_ceiling: false, ceiling_board: "normal", wall_zone: "wet", paint_walls: true, paint_ceiling: true, missing: ["width", "height"] },
        ],
        totals: { troughM: 12 },
        unclear: ["عرض المطبخ غير مذكور", "ارتفاع الحمام أُخذ من ارتفاع المجلس"],
      }}
    />;
}
