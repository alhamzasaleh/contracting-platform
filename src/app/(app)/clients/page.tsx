import { getTranslations } from "next-intl/server";
import { ClientsView } from "@/components/clients/clients-view";
import { PageHeader } from "@/components/shell/app-shell";
import { can, requirePermission } from "@/lib/auth/session";
import { loadClients } from "@/lib/data/clients";
import { loadMarketerChoices } from "@/lib/data/marketers";
import { createClient } from "@/lib/supabase/server";
import { readMapLink, saveClient } from "./actions";

export default async function ClientsPage() {
  const session = await requirePermission("clients.view");
  const t = await getTranslations("clients");
  const [clients, marketers] = await Promise.all([loadClients(session), loadMarketerChoices(await createClient(), session.organization.id)]);
  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ClientsView clients={clients} canManage={can(session, "clients.manage")} onSave={saveClient} onReadLink={readMapLink} marketers={marketers} />
    </div>
  );
}
