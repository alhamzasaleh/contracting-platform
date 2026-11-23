import "server-only";
import { flushWhatsApp } from "@/lib/notifications/flush";
import { runQoyodSync } from "@/lib/qoyod/sync";

/** Work done after the response (via `after()`): WhatsApp messages and the Qoyod queue. */
export async function runBackground(): Promise<void> {
  await Promise.allSettled([flushWhatsApp(), runQoyodSync()]);
}
