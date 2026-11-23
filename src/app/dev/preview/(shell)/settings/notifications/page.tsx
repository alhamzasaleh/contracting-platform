import { NotificationPrefsView } from "@/components/settings/notification-prefs";
import { NOTIFICATION_KINDS } from "@/lib/notifications";
import { SAMPLE_SHELL } from "../../../sample";

export default function PreviewNotificationPrefs() {
  const prefs = NOTIFICATION_KINDS.map((kind) => ({ kind, in_app: kind !== "approval_reminder", whatsapp: kind === "approval" || kind === "payment_late" }));
  return <NotificationPrefsView preview prefs={prefs} phone={SAMPLE_SHELL.user.phone} whatsappReady={false} />;
}
