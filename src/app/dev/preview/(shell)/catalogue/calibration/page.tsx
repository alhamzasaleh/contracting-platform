import { CalibrationView } from "@/components/catalogue/calibration-view";

export default function P() {
  return (
    <CalibrationView
      data={{
        projects: 5,
        canApply: true,
        rows: [
          {
            productId: "p1", label: "دهان جدران — Jotun", variance: 0.14, consistent: true,
            projects: [
              { contract: "C-2026-001", planned: 12, actual: 13.8, variance: 0.15 },
              { contract: "C-2026-003", planned: 8, actual: 9.1, variance: 0.14 },
              { contract: "C-2026-004", planned: 10, actual: 11.2, variance: 0.12 },
            ],
            group: { id: "g1", name: "دهان جدران داخلي", coverage: 6.67, suggested: 5.85 },
          },
          {
            productId: "p2", label: "معجون جبس 20 كجم", variance: 0.11, consistent: true,
            projects: [
              { contract: "C-2026-002", planned: 30, actual: 33, variance: 0.1 },
              { contract: "C-2026-003", planned: 25, actual: 28, variance: 0.12 },
              { contract: "C-2026-005", planned: 20, actual: 22.2, variance: 0.11 },
            ],
            group: null,
          },
          {
            productId: "p3", label: "أساس — الجزيرة", variance: -0.03, consistent: false,
            projects: [
              { contract: "C-2026-001", planned: 3, actual: 2.9, variance: -0.03 },
              { contract: "C-2026-004", planned: 2, actual: 2.1, variance: 0.05 },
            ],
            group: { id: "g3", name: "أساس داخلي", coverage: 7.78, suggested: null },
          },
        ],
      }}
    />
  );
}
