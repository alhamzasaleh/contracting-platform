import type { Permission, Role } from "@/lib/auth/permissions";
import type { NotificationItem } from "@/lib/notifications";

/** Everything the app shell needs; built from the session (or sample data in preview). */
export type ShellData = {
  user: { name: string | null; phone: string | null };
  org: { name: string; logoUrl: string | null };
  role: Role;
  permissions: Permission[];
  /** In-app notifications (bell). */
  notifications?: { items: NotificationItem[]; unread: number; canDecide: boolean };
  /** Floating assistant button (finance users, AI key configured or not). */
  assistant?: { ready: boolean };
  /** Base path for links: "" in the app, "/dev/preview" in the design preview. */
  basePath?: string;
};
