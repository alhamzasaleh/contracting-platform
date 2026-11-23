import { ClausesPanel } from "@/components/contracts/clauses-panel";
import { requirePermission } from "@/lib/auth/session";
import { termsSchema } from "@/lib/contracts/terms";
import { createClient } from "@/lib/supabase/server";
import { saveContractTemplate } from "../../contracts/actions";

export default async function ContractTemplatePage() {
  const session = await requirePermission("settings.manage");
  const supabase = await createClient();
  const { data } = await supabase.from("contract_templates").select("terms").eq("organization_id", session.organization.id).maybeSingle();
  const parsed = termsSchema.safeParse(data?.terms ?? {});
  async function save(terms: unknown) {
    "use server";
    return saveContractTemplate({ terms });
  }
  return <ClausesPanel mode="template" initial={parsed.success ? parsed.data : {}} save={save} />;
}
