import { AuditView, type AuditItem } from "@/components/settings/audit-view";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const HIDDEN = new Set(["id", "organization_id", "created_at", "updated_at", "created_by", "permission_overrides_raw"]);

function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys]
    .filter((k) => !HIDDEN.has(k))
    .filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null))
    .map((field) => ({ field, before: before?.[field] ?? null, after: after?.[field] ?? null }));
}

export default async function AuditPage() {
  const session = await requirePermission("audit.view");
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("audit_log")
    .select("id, created_at, actor_id, action, table_name, before, after")
    .eq("organization_id", session.organization.id)
    .order("id", { ascending: false })
    .limit(100);

  const actorIds = [...new Set((rows ?? []).map((r) => r.actor_id).filter((x): x is string => Boolean(x)))];
  const { data: profiles } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [] };
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  const items: AuditItem[] = (rows ?? []).map((r) => ({
    id: r.id,
    at: r.created_at,
    actor: r.actor_id ? (names.get(r.actor_id) ?? null) : null,
    action: r.action,
    table: r.table_name,
    changes: diff(r.before as Record<string, unknown> | null, r.after as Record<string, unknown> | null),
  }));

  return <AuditView items={items} />;
}
