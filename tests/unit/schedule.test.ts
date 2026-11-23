import { describe, expect, it } from "vitest";
import { addDays, anyTeamFree, conflicts, earliestStart, spanOf, suggestStart, weekStart, type Entry, type TeamInfo } from "@/lib/schedule";

const teams: TeamInfo[] = [
  { id: "a", name: "فريق الجبس", services: ["gypsum"], is_active: true },
  { id: "b", name: "فريق الدهان", services: ["interior", "exterior"], is_active: true },
  { id: "c", name: "فريق قديم", services: ["interior"], is_active: false },
];
const entries: Entry[] = [
  { id: "1", team_id: "a", contract_id: "k1", start: "2026-12-01", end: "2026-12-10" },
  { id: "2", team_id: "a", contract_id: "k2", start: "2026-12-14", end: "2026-12-20" },
  { id: "3", team_id: "b", contract_id: "k3", start: "2026-12-03", end: "2026-12-05" },
];

describe("schedule helpers", () => {
  it("spans are inclusive calendar days", () => {
    expect(spanOf("2026-12-01", 10)).toEqual({ start: "2026-12-01", end: "2026-12-10" });
    expect(spanOf("2026-12-31", 1)).toEqual({ start: "2026-12-31", end: "2026-12-31" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("finds the earliest gap that fits the whole job", () => {
    const busy = entries.filter((e) => e.team_id === "a");
    expect(earliestStart(busy, "2026-11-20", 5)).toBe("2026-11-20"); // fits before
    expect(earliestStart(busy, "2026-11-28", 5)).toBe("2026-12-21"); // 3-day gap (11–13) too short for 5
    expect(earliestStart(busy, "2026-11-28", 3)).toBe("2026-11-28"); // fits before the first job
    expect(earliestStart(busy, "2026-11-30", 3)).toBe("2026-12-11"); // 3 days fit the gap exactly
    expect(earliestStart([], "2026-12-01", 30)).toBe("2026-12-01");
  });

  it("detects clashes for the same team only", () => {
    const c = conflicts(entries, { team_id: "a", start: "2026-12-09", end: "2026-12-15" });
    expect(c.map((e) => e.id)).toEqual(["1", "2"]);
    expect(conflicts(entries, { team_id: "b", start: "2026-12-09", end: "2026-12-15" })).toEqual([]);
    // editing an entry doesn't clash with itself
    expect(conflicts(entries, { id: "1", team_id: "a", start: "2026-12-01", end: "2026-12-10" })).toEqual([]);
  });

  it("suggests the soonest suitable team, ignoring inactive ones", () => {
    const s = suggestStart(teams, entries, "interior", "2026-12-02", 4);
    expect(s).toEqual({ date: "2026-12-06", team: teams[1] });
    const g = suggestStart(teams, entries, "gypsum", "2026-12-02", 3);
    expect(g?.date).toBe("2026-12-11");
    expect(suggestStart([], entries, "gypsum", "2026-12-02", 3)).toBeNull();
    // re-planning a contract ignores its own booking
    expect(suggestStart(teams, entries, "gypsum", "2026-12-01", 3, { contract_id: "k1" })?.date).toBe("2026-12-01");
  });

  it("warns when every suitable team is busy", () => {
    expect(anyTeamFree(teams, entries, "gypsum", { start: "2026-12-05", end: "2026-12-06" })).toBe(false);
    expect(anyTeamFree(teams, entries, "interior", { start: "2026-12-06", end: "2026-12-08" })).toBe(true);
    expect(anyTeamFree([], entries, "interior", { start: "2026-12-06", end: "2026-12-08" })).toBe(true);
  });

  it("weeks start on Saturday", () => {
    expect(weekStart("2026-11-23")).toBe("2026-11-21"); // Monday → Saturday before
    expect(weekStart("2026-11-21")).toBe("2026-11-21");
    expect(weekStart("2026-11-27")).toBe("2026-11-21"); // Friday
  });
});
