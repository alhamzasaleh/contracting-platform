/**
 * "Notifications on this device" without surprises on a shared iPad: the browser's push
 * subscription may have been turned on by someone else, so it is claimed for the signed-in user
 * (the database moves the row to him) before the card says «on» — and a subscription the app
 * didn't just create is never unsubscribed (that would silence the other user without a word).
 */
export type PushSubLike = {
  endpoint: string;
  unsubscribe: () => Promise<boolean>;
  toJSON: () => { endpoint?: string; keys?: Record<string, string | undefined> };
};
export type PushSave = (input: { endpoint: string | undefined; keys: { p256dh: string | undefined; auth: string | undefined }; device: string }) => Promise<{ ok: boolean }>;

const payload = (sub: PushSubLike, device: string) => {
  const json = sub.toJSON();
  return { endpoint: json.endpoint ?? sub.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth }, device };
};

/** On load: an existing subscription counts as «on» only once it is saved for this user. */
export async function claimDevice(sub: PushSubLike | null | undefined, save: PushSave, device: string): Promise<"on" | "off"> {
  if (!sub) return "off";
  try {
    return (await save(payload(sub, device))).ok ? "on" : "off";
  } catch {
    return "off";
  }
}

/** Turning on: reuse the browser's subscription or create one; if saving fails, undo only what was created here. */
export async function enableDevice(o: { existing: PushSubLike | null | undefined; subscribe: () => Promise<PushSubLike>; save: PushSave; device: string }): Promise<boolean> {
  const sub = o.existing ?? (await o.subscribe());
  const r = await o.save(payload(sub, o.device)).catch(() => ({ ok: false }));
  if (r.ok) return true;
  if (!o.existing) await sub.unsubscribe().catch(() => undefined);
  return false;
}
