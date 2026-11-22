import type { Permission, Role } from "@/lib/auth/permissions";

/** Everything the app shell needs; built from the session (or sample data in preview). */
export type ShellData = {
  user: { name: string | null; phone: string | null };
  org: { name: string; logoUrl: string | null };
  role: Role;
  permissions: Permission[];
  /** Base path for links: "" in the app, "/dev/preview" in the design preview. */
  basePath?: string;
};
