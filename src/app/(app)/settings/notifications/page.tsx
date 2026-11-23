import { NotificationPrefsView } from "@/components/settings/notification-prefs";
import { getSession } from "@/lib/auth/session";
import { loadNotificationPrefs } from "@/lib/data/notifications";
import { whatsappConfigured } from "@/lib/notifications/whatsapp";

export default async function NotificationPrefsPage() {
  const session = await getSession();
  const { prefs, phone } = await loadNotificationPrefs(session);
  return <NotificationPrefsView prefs={prefs} phone={phone} whatsappReady={whatsappConfigured()} />;
}
