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

/** Design preview only: «الرقم مسجّل لعميل ثاني» — the sample client م. سارة القحطاني holds 0537000044. */
export async function previewFindPhone(input?: unknown): Promise<ActionResult<{ number: string; name: string } | null>> {
  const phone = (input as { phone?: string } | undefined)?.phone;
  return { ok: true, data: phone === "966537000044" ? { number: "CL-2026-001", name: "م. سارة القحطاني" } : null };
}

/** Design preview only: the assistant answers with a fixed reply (no AI, no data). */
export async function previewAsk(_input?: unknown): Promise<ActionResult<{ answer: string; figures: { label: string; value: string }[]; links: { label: string; href: string }[] }>> {
  void _input;
  return { ok: true, data: { answer: "هالشهر حصّلت 54,600 ر.س.", figures: [{ label: "المحصّل هذا الشهر", value: "54,600 ر.س" }], links: [{ label: "التحصيل والأرباح", href: "/reports" }] } };
}
