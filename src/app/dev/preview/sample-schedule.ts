import type { ScheduleData } from "@/lib/data/schedule";

/** Sample schedule for /dev/preview (no database). Dates around 2026-11-23. */
export const SAMPLE_TODAY = "2026-11-23";

export const SAMPLE_SCHEDULE: ScheduleData = {
  canManage: true,
  roster: [
    { id: "e1", full_name: "أحمد محمود", job_title: "مركّب جبس" },
    { id: "e2", full_name: "رامي علي", job_title: "مركّب جبس" },
    { id: "e3", full_name: "محمد إقبال", job_title: "دهّان" },
    { id: "e4", full_name: "سليم خان", job_title: "دهّان" },
  ],
  teams: [
    { id: "t1", name: "فريق الجبس", kind: "inhouse", services: ["gypsum"], color: "#1E4D4A", contact_phone: null, is_active: true, notes: null, members: ["e1", "e2"] },
    { id: "t2", name: "فريق الدهان", kind: "inhouse", services: ["interior", "exterior"], color: "#3B5B7A", contact_phone: null, is_active: true, notes: null, members: ["e3", "e4"] },
    { id: "t3", name: "مؤسسة الإتقان (مقاول)", kind: "external", services: ["exterior"], color: "#6B4E71", contact_phone: "966551112222", is_active: true, notes: null, members: [] },
  ],
  projects: [
    { id: "k0", number: "C-2026-003", client: "شركة البناء المتقن", service: "gypsum", status: "accepted", start: "2026-11-21", end: "2026-12-04", days: 14 },
    { id: "k1", number: "C-2026-004", client: "أبو محمد العتيبي", service: "interior", status: "sent", start: "2026-12-01", end: "2026-12-09", days: 9 },
    { id: "k2", number: "C-2026-005", client: "فيلا الياسمين", service: "exterior", status: "accepted", start: "2026-11-28", end: "2026-12-07", days: 10 },
    { id: "k3", number: "C-2026-006", client: "عمارة الريان", service: "gypsum", status: "accepted", start: "2026-12-10", end: "2026-12-19", days: 10 },
  ],
  entries: [
    { id: "s1", team_id: "t1", contract_id: "k0", kind: "work", title: null, notes: null, start: "2026-11-21", end: "2026-12-04" },
    { id: "s2", team_id: "t2", contract_id: "k1", kind: "work", title: null, notes: null, start: "2026-12-01", end: "2026-12-09" },
    { id: "s3", team_id: "t2", contract_id: "k2", kind: "work", title: null, notes: null, start: "2026-11-28", end: "2026-12-03" },
    { id: "s4", team_id: "t1", contract_id: null, kind: "leave", title: "إجازة رامي", notes: null, start: "2026-12-13", end: "2026-12-16" },
  ],
};
