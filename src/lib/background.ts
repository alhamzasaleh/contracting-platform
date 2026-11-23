import "server-only";
import { flushWhatsApp } from "@/lib/notifications/flush";
import { flushPush } from "@/lib/notifications/push";
import { runQoyodSync } from "@/lib/qoyod/sync";

/** Work done after the response (via `after()`): WhatsApp messages, device push and the Qoyod queue. */
export async function runBackground(): Promise<void> {
  await Promise.allSettled([flushWhatsApp(), flushPush(), runQoyodSync()]);
}
