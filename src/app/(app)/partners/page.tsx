import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MarketersView } from "@/components/marketers/marketers-view";
import { PageHeader } from "@/components/shell/app-shell";
import { can, getSession } from "@/lib/auth/session";
import { loadMarketers } from "@/lib/data/marketers";
import { issueMarketerLink, payCommission, revokeMarketerLinks, saveMarketer } from "./actions";

/** «شركاء النجاح» — whoever manages partners (marketers.manage) or follows the money (finance.view). */
export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const { k } = await searchParams;
  const session = await getSession();
  if (!can(session, "marketers.manage") && !can(session, "finance.view")) redirect("/?denied=1");
  const t = await getTranslations("marketers");
  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <MarketersView data={await loadMarketers(session)} highlight={k && /^[0-9a-f-]{36}$/.test(k) ? k : null} actions={{ save: saveMarketer, issueLink: issueMarketerLink, revokeLinks: revokeMarketerLinks, pay: payCommission }} />
    </div>
  );
}
