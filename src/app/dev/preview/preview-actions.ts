"use server";
import type { ActionResult } from "@/lib/actions";

/**
 * Design preview only: stands in for a real server action so buttons that need one
 * render on /dev/preview. It does nothing and touches no data.
 */
export async function previewNoop(_input?: unknown): Promise<ActionResult> {
  void _input;
  return { ok: true };
}
