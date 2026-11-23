import { DevicePush } from "@/components/settings/device-push";
import { NotificationPrefsView } from "@/components/settings/notification-prefs";
import { NOTIFICATION_KINDS } from "@/lib/notifications";
import { SAMPLE_SHELL } from "../../../sample";

export default function PreviewNotificationPrefs() {
  const prefs = NOTIFICATION_KINDS.map((kind) => ({ kind, in_app: kind !== "approval_reminder", whatsapp: kind === "approval" || kind === "payment_late", push: kind !== "approval_reminder" }));
  return (
    <div className="grid gap-6">
      <DevicePush preview publicKey={null} devices={1} />
      <NotificationPrefsView preview prefs={prefs} phone={SAMPLE_SHELL.user.phone} whatsappReady={false} />
    </div>
  );
}
