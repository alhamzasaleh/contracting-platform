"use server";
import type { ActionResult } from "@/lib/actions";

/** Design preview only: «من الرابط» answers with a fixed pin in Riyadh. */
export async function previewMapLink(_input?: unknown): Promise<ActionResult<{ lat: number; lng: number } | null>> {
  void _input;
  return { ok: true, data: { lat: 24.8031, lng: 46.6105 } };
}

/**
 * Design preview only: stands in for a real server action so buttons that need one
 * render on /dev/preview. It does nothing and touches no data.
 */
export async function previewNoop(_input?: unknown): Promise<ActionResult> {
  void _input;
  return { ok: true };
}

/** Design preview only: the city and district of a pin (fixed). */
export async function previewPlace(_input?: unknown): Promise<ActionResult<{ city: string | null; district: string | null } | null>> {
  void _input;
  return { ok: true, data: { city: "الرياض", district: "الملقا" } };
}

/** Design preview only: «إنشاء المعاينة» answers with the sample survey's number. */
export async function previewNewSurvey(_input?: unknown): Promise<ActionResult<{ number: string }>> {
  void _input;
  return { ok: true, data: { number: "SV-2026-004" } };
}
