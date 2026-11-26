import { describe, expect, it } from "vitest";
import { upcomingSurveys } from "@/lib/survey/upcoming";

/** «معاينات قادمة» on the home page (owner, Nov 2026): booked visits from today on, soonest first. */
const row = (number: string, date: string | null, time: string | null, extra: Partial<Parameters<typeof upcomingSurveys>[0][number]> = {}) => ({
  number, visit_date: date, visit_time: time, latitude: null, longitude: null,
  client: { number: "CL-1", name: "عبدالله", latitude: 24.7, longitude: 46.6 }, ...extra,
});

describe("upcoming surveys", () => {
  it("from today within 14 days, soonest first (a time before none on the same day)", () => {
    const r = upcomingSurveys(
      [row("SV-3", "2026-11-28", null), row("SV-1", "2026-11-26", "16:00:00"), row("SV-2", "2026-11-26", "09:30:00"), row("SV-0", "2026-11-25", "09:00:00"), row("SV-9", "2026-12-20", null), row("SV-x", null, null), row("SV-4", "2026-11-26", null)],
      "2026-11-26",
    );
    expect(r.map((s) => s.number)).toEqual(["SV-2", "SV-1", "SV-4", "SV-3"]);
  });
  it("the place to go: the survey's own site, else the client's; none when neither", () => {
    const [own, client, none] = upcomingSurveys(
      [
        row("SV-1", "2026-11-26", "08:00:00", { latitude: 24.8, longitude: 46.61 }),
        row("SV-2", "2026-11-26", "09:00:00"),
        row("SV-3", "2026-11-26", "10:00:00", { client: { number: "CL-2", name: "س", latitude: null, longitude: null } }),
      ],
      "2026-11-26",
    );
    expect(own.site).toEqual({ lat: 24.8, lng: 46.61 });
    expect(client.site).toEqual({ lat: 24.7, lng: 46.6 });
    expect(none.site).toBeNull();
    expect(own.time).toBe("08:00");
  });
});
