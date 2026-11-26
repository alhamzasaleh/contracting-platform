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

// one rule for map links and distances: src/lib/geo.ts
export { distanceMeters, parseMapCoords as coordsFromMapLink } from "@/lib/geo";
