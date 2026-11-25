import type { ClientDetail, ClientListItem, SurveyDetail } from "@/lib/data/clients";

/** Illustrative clients, survey and rooms for the design preview only. */
export const SAMPLE_CLIENTS: ClientListItem[] = [
  { id: "c1", number: "CL-2026-003", name: "أبو محمد العتيبي", phone: "966551234567", city: "الرياض", surveys: 1, quotes: 2, created_at: "2026-11-20T09:00:00Z" },
  { id: "c2", number: "CL-2026-002", name: "شركة البناء المتقن", phone: "966501112233", city: "الرياض", surveys: 2, quotes: 1, created_at: "2026-11-12T09:00:00Z" },
  { id: "c3", number: "CL-2026-001", name: "م. سارة القحطاني", phone: null, city: "الخرج", surveys: 0, quotes: 0, created_at: "2026-11-02T09:00:00Z" },
];

export const SAMPLE_CLIENT_DETAIL: ClientDetail = {
  client: { id: "c1", number: "CL-2026-003", name: "أبو محمد العتيبي", phone: "966551234567", city: "الرياض", district: "النرجس", id_number: "1012345678", location_url: "https://maps.app.goo.gl/example", notes: "فيلا دورين، يفضّل التواصل بالواتساب بعد العصر.", marketer_id: "mk1" },
  marketers: [{ id: "mk1", number: "MK-2026-001", name: "سعد بن فهد الدوسري", is_active: true, commission_percent: 5 }],
  surveys: [{ id: "s1", number: "SV-2026-004", title: "فيلا النرجس", mode: "rooms", visit_date: "2026-11-21", rooms: 6 }],
  quotes: [
    { id: "q1", number: "Q-2026-007", service: "gypsum", status: "issued", version: 2, total: 31840, created_at: "2026-11-21T10:00:00Z" },
    { id: "q2", number: "Q-2026-008", service: "interior", status: "draft", version: 1, total: 28400, created_at: "2026-11-21T11:00:00Z" },
  ],
  contracts: [
    { number: "C-2026-003", service: "gypsum", status: "accepted", total: 31840, openMaintenance: 1 },
    { number: "C-2026-005", service: "interior", status: "sent", total: 28400, openMaintenance: 0 },
  ],
  balance: { billed: 33640, received: 12800, outstanding: 20840 },
  invoices: [
    { number: "INV-2026-004", total: 12000, issue_date: "2026-11-19" },
    { number: "INV-2026-006", total: 1800, issue_date: "2026-11-22" },
  ],
  canViewProjects: true,
};

const r = (id: string, name: string, L: number, W: number, extra: Partial<SurveyDetail["rooms"][number]> = {}) => ({
  id, name, unit_label: "الدور الأرضي", length_m: L, width_m: W, height_m: 3.2, openings_m2: 4,
  gypsum_ceiling: true, ceiling_board: "normal" as const, paint_walls: true, paint_ceiling: true, wall_zone: "normal" as const, ...extra,
});

export const SAMPLE_SURVEY: SurveyDetail = {
  survey: { id: "s1", number: "SV-2026-004", title: "فيلا النرجس", mode: "rooms", visit_date: "2026-11-21", notes: null, totals: { partitions: 24, troughM: 30, shadowM: 40, hatches: { "40x40": 2 }, colours: 2, facade: 420 } },
  client: { id: "c1", number: "CL-2026-003", name: "أبو محمد العتيبي" },
  rooms: [
    r("r1", "المجلس", 8, 6, { openings_m2: 8 }),
    r("r2", "الصالة", 7, 6),
    r("r3", "المطبخ", 5, 4, { ceiling_board: "fire" }),
    r("r4", "حمام الضيوف", 2.5, 2, { ceiling_board: "moisture", wall_zone: "wet", openings_m2: 2 }),
    r("r5", "غرفة النوم", 5, 4.5, { unit_label: "الدور الأول", wall_zone: "decorative" }),
    r("r6", "المخزن", 3, 2, { gypsum_ceiling: false, paint_ceiling: false }),
  ],
};
