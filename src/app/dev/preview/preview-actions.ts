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
