import { DevicePush } from "@/components/settings/device-push";
import { NotificationPrefsView } from "@/components/settings/notification-prefs";
import { getSession } from "@/lib/auth/session";
import { loadNotificationPrefs } from "@/lib/data/notifications";
import { pushPublicKey } from "@/lib/notifications/push";
import { whatsappConfigured } from "@/lib/notifications/whatsapp";

export default async function NotificationPrefsPage() {
  const session = await getSession();
  const [{ prefs, phone, devices }, publicKey] = await Promise.all([loadNotificationPrefs(session), pushPublicKey()]);
  return (
    <div className="grid gap-6">
      <DevicePush publicKey={publicKey} devices={devices} />
      <NotificationPrefsView prefs={prefs} phone={phone} whatsappReady={whatsappConfigured()} />
    </div>
  );
}
