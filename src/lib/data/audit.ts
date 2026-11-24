import "server-only";
import type { AuditItem } from "@/components/settings/audit-view";
import type { SessionContext } from "@/lib/auth/session";
import { loadStaffNames } from "@/lib/data/staff";
import { createClient } from "@/lib/supabase/server";

const HIDDEN = new Set(["id", "organization_id", "created_at", "updated_at", "created_by", "permission_overrides_raw"]);

function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys]
    .filter((k) => !HIDDEN.has(k))
    .filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null))
    .map((field) => ({ field, before: before?.[field] ?? null, after: after?.[field] ?? null }));
}

/** The latest 100 audit entries (audit.view); actors named like on every staff page (linked employee «name · job», else name, else phone). */
export async function loadAudit(session: SessionContext): Promise<AuditItem[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: rows } = await supabase
    .from("audit_log")
    .select("id, created_at, actor_id, action, table_name, before, after")
    .eq("organization_id", orgId)
    .order("id", { ascending: false })
    .limit(100);
  const names = await loadStaffNames(supabase, orgId, (rows ?? []).map((r) => r.actor_id));
  return (rows ?? []).map((r) => ({
    id: r.id,
    at: r.created_at,
    actor: r.actor_id ? (names.get(r.actor_id) ?? null) : null,
    action: r.action,
    table: r.table_name,
    changes: diff(r.before as Record<string, unknown> | null, r.after as Record<string, unknown> | null),
  }));
}
