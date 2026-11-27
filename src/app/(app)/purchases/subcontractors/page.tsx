import { SubcontractorsView } from "@/components/purchases/sub-petty-views";
import { requirePermission } from "@/lib/auth/session";
import { loadSubcontractors } from "@/lib/data/subcontractors";
import { addSubPayment, addSubWork, deleteSubWork, issueSubLink, revokeSubLinks, saveAgreement, saveSubcontractor } from "../actions";

export default async function SubcontractorsPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const session = await requirePermission("purchases.view");
  const { s } = await searchParams;
  return (
    <SubcontractorsView
      data={await loadSubcontractors(session)}
      orgName={session.organization.name}
      highlight={typeof s === "string" ? s : null}
      actions={{ saveSub: saveSubcontractor, saveAgreement, addWork: addSubWork, deleteWork: deleteSubWork, addPayment: addSubPayment, issueLink: issueSubLink, revokeLinks: revokeSubLinks }}
    />
  );
}
