import { getTranslations } from "next-intl/server";
import { MarketersView } from "@/components/marketers/marketers-view";
import { PageHeader } from "@/components/shell/app-shell";
import { previewNoop } from "../../../preview-actions";
import { SAMPLE_MARKETERS_FINANCE } from "../../../sample-marketers";

/** What a finance.view member (no marketers.manage, no finance.manage) sees. */
export default async function P() {
  const t = await getTranslations("marketers");
  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <MarketersView data={SAMPLE_MARKETERS_FINANCE} base="/dev/preview" actions={{ save: previewNoop as never, issueLink: previewNoop as never, revokeLinks: previewNoop, pay: previewNoop as never, remove: previewNoop }} />
    </div>
  );
}
