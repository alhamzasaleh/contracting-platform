import { SurveyView } from "@/components/clients/survey-view";
import { SAMPLE_SURVEY } from "../../../sample-clients";

export default function P() {
  return <SurveyView
      detail={SAMPLE_SURVEY}
      canManage
      canQuote
      base="/dev/preview"
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
