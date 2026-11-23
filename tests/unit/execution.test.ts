import { describe, expect, it } from "vitest";
import { coordsFromMapLink, currentStage, distanceMeters, overallProgress, portalStep, type StageLite } from "@/lib/execution";

const st = (seq: number, status: StageLite["status"], progress: number, is_final = false): StageLite => ({ seq, status, progress, is_final });

describe("execution helpers", () => {
  it("overall progress averages the stages", () => {
    expect(overallProgress([st(1, "confirmed", 100), st(2, "in_progress", 50), st(3, "pending", 0), st(4, "pending", 0, true)])).toBe(38);
    expect(overallProgress([])).toBe(0);
  });

  it("current stage is the first not confirmed", () => {
    expect(currentStage([st(2, "in_progress", 40), st(1, "confirmed", 100)])?.seq).toBe(2);
    expect(currentStage([st(1, "confirmed", 100)])).toBeNull();
  });

  it("client page step follows the work", () => {
    expect(portalStep("sent", [])).toBe(1);
    expect(portalStep("accepted", [st(1, "pending", 0)])).toBe(2);
    expect(portalStep("accepted", [st(1, "in_progress", 20), st(2, "pending", 0, true)])).toBe(3);
    expect(portalStep("accepted", [st(1, "confirmed", 100), st(2, "awaiting_client", 100, true)])).toBe(4);
    expect(portalStep("accepted", [st(1, "confirmed", 100), st(2, "confirmed", 100, true)])).toBe(5);
  });

  it("GPS distance and map links", () => {
    expect(distanceMeters({ lat: 24.7136, lng: 46.6753 }, { lat: 24.7136, lng: 46.6753 })).toBe(0);
    const d = distanceMeters({ lat: 24.7136, lng: 46.6753 }, { lat: 24.7236, lng: 46.6753 });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
    expect(coordsFromMapLink("https://www.google.com/maps/place/x/@24.7136,46.6753,17z")).toEqual({ lat: 24.7136, lng: 46.6753 });
    expect(coordsFromMapLink("https://maps.google.com/?q=24.5,46.1")).toEqual({ lat: 24.5, lng: 46.1 });
    expect(coordsFromMapLink("https://maps.app.goo.gl/abc")).toBeNull();
  });
});
