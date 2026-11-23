/**
 * Execution (Phase 7) — pure helpers shared by the app and the client page.
 */
export type StageLite = { seq: number; status: "pending" | "in_progress" | "awaiting_client" | "confirmed"; progress: number; is_final: boolean };

/** Overall progress: the average of the stages (each stage counts equally). */
export function overallProgress(stages: Pick<StageLite, "progress" | "status">[]): number {
  if (!stages.length) return 0;
  return Math.round(stages.reduce((s, x) => s + (x.status === "confirmed" ? 100 : x.progress), 0) / stages.length);
}

/** The stage being worked on: the first one not yet confirmed. */
export function currentStage<S extends StageLite>(stages: S[]): S | null {
  return [...stages].sort((a, b) => a.seq - b.seq).find((s) => s.status !== "confirmed") ?? null;
}

/** Client page timeline: quote → contract → accepted → work → handover → warranty. */
export function portalStep(contractStatus: string, stages: StageLite[]): number {
  if (contractStatus !== "accepted") return 1;
  const final = stages.find((s) => s.is_final);
  if (final?.status === "confirmed") return 5;
  if (final?.status === "awaiting_client") return 4;
  if (stages.some((s) => s.status !== "pending" || s.progress > 0)) return 3;
  return 2;
}

/** Distance in metres between two GPS points (haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Coordinates from a Google Maps link when they're written in it (…@24.71,46.67 or ?q=24.71,46.67). */
export function coordsFromMapLink(url: string | null | undefined): { lat: number; lng: number } | null {
  if (!url) return null;
  const m = url.match(/[@=](-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
