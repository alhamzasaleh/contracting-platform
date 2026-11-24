import { AuditView } from "@/components/settings/audit-view";
import { requirePermission } from "@/lib/auth/session";
import { loadAudit } from "@/lib/data/audit";

export default async function AuditPage() {
  const session = await requirePermission("audit.view");
  return <AuditView items={await loadAudit(session)} />;
}
