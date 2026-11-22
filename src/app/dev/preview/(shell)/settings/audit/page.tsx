import { AuditView } from "@/components/settings/audit-view";
import { SAMPLE_AUDIT } from "../../../sample";

export default function PreviewAudit() {
  return <AuditView items={SAMPLE_AUDIT} />;
}
