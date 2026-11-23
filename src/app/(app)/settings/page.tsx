import { CompanyForm } from "@/components/settings/company-form";
import { can, getSession } from "@/lib/auth/session";
import { updateCompany } from "./actions";

export default async function CompanySettingsPage() {
  const session = await getSession();
  const o = session.organization;
  return (
    <CompanyForm
      canEdit={can(session, "settings.manage")}
      onSave={updateCompany}
      values={{
        name: o.name,
        legal_name: o.legal_name,
        cr_number: o.cr_number,
        vat_number: o.vat_number,
        phone: o.phone,
        email: o.email,
        city: o.city,
        address: o.address,
        signatory_name: o.signatory_name,
        signatory_title: o.signatory_title,
      }}
    />
  );
}
