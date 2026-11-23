import { getTranslations } from "next-intl/server";
import { ContractView } from "@/components/contracts/contract-views";
import { PageHeader } from "@/components/shell/app-shell";
import { requirePermission } from "@/lib/auth/session";
import { loadContract } from "@/lib/data/contracts";
import { signedAssetUrl } from "@/lib/org";
import { cancelContract, revokeLinks, sendContract } from "../actions";

export default async function ContractPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("quotes.view");
  const t = await getTranslations("contract");
  const [detail, logoUrl] = await Promise.all([loadContract(session, decodeURIComponent(number)), signedAssetUrl(session.organization.logo_path)]);
  const o = session.organization;
  return (
    <div>
      <PageHeader title={t("title")} />
      <ContractView
        detail={detail}
        org={{ name: o.name, legal_name: o.legal_name, cr_number: o.cr_number, vat_number: o.vat_number, phone: o.phone, city: o.city, logoUrl }}
        actions={{ send: sendContract, revoke: revokeLinks, cancel: cancelContract }}
      />
    </div>
  );
}
