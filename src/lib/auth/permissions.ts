/**
 * Permission keys and preset roles.
 *
 * Mirrors `private.all_permissions()` / `private.role_permissions()` in
 * supabase/migrations. The database is the source of truth and enforces
 * everything through RLS; this file only drives what the UI shows.
 * `tests/db/permissions-sync.test.ts` fails if the two drift apart.
 */

export const PERMISSIONS = [
  "settings.manage",
  "members.manage",
  "audit.view",
  "clients.view",
  "clients.manage",
  "catalogue.view",
  "catalogue.manage",
  "costs.view",
  "quotes.view",
  "quotes.manage",
  "projects.view",
  "projects.manage",
  "schedule.view",
  "schedule.manage",
  "purchases.view",
  "purchases.manage",
  "finance.view",
  "finance.manage",
  "approvals.decide",
  "reports.view",
  "hr.view",
  "hr.manage",
  "marketers.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ["owner", "supervisor", "finance", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  supervisor: [
    "clients.view",
    "clients.manage",
    "catalogue.view",
    "costs.view",
    "quotes.view",
    "quotes.manage",
    "projects.view",
    "projects.manage",
    "schedule.view",
    "schedule.manage",
    "purchases.view",
    "purchases.manage",
  ],
  finance: [
    "clients.view",
    "catalogue.view",
    "costs.view",
    "quotes.view",
    "projects.view",
    "schedule.view",
    "purchases.view",
    "purchases.manage",
    "finance.view",
    "finance.manage",
    "reports.view",
    "audit.view",
    "hr.view",
  ],
  viewer: ["clients.view", "quotes.view", "projects.view", "schedule.view"],
};

/** Groups for the permissions editor UI. */
export const PERMISSION_GROUPS: { key: string; permissions: Permission[] }[] = [
  { key: "administration", permissions: ["settings.manage", "members.manage", "audit.view"] },
  { key: "sales", permissions: ["clients.view", "clients.manage", "quotes.view", "quotes.manage", "marketers.manage"] },
  { key: "catalogue", permissions: ["catalogue.view", "catalogue.manage", "costs.view"] },
  { key: "hr", permissions: ["hr.view", "hr.manage"] },
  {
    key: "operations",
    permissions: ["projects.view", "projects.manage", "schedule.view", "schedule.manage"],
  },
  {
    key: "finance",
    permissions: [
      "purchases.view",
      "purchases.manage",
      "finance.view",
      "finance.manage",
      "approvals.decide",
      // "reports.view" is kept for the database but not offered: reports use finance.view.
    ],
  },
];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export type PermissionOverrides = { grant: Permission[]; deny: Permission[] };

/** Same rule as private.member_permissions(): role + grants − denies; owner = all. */
export function effectivePermissions(role: Role, overrides?: PermissionOverrides): Permission[] {
  if (role === "owner") return [...PERMISSIONS];
  const set = new Set<Permission>([...ROLE_PERMISSIONS[role], ...(overrides?.grant ?? [])]);
  for (const p of overrides?.deny ?? []) set.delete(p);
  return PERMISSIONS.filter((p) => set.has(p));
}
