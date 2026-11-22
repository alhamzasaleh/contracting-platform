import { CompanyForm } from "@/components/settings/company-form";
import { SAMPLE_ORG } from "../../sample";

export default function PreviewCompany() {
  return <CompanyForm canEdit values={SAMPLE_ORG} />;
}
