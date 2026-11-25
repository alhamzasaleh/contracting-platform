import { getTranslations } from "next-intl/server";
import { MarketersView } from "@/components/marketers/marketers-view";
import { PageHeader } from "@/components/shell/app-shell";
import { previewNoop } from "../../preview-actions";
import { SAMPLE_MARKETERS } from "../../sample-marketers";

export default async function P() {
  const t = await getTranslations("marketers");
  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <MarketersView data={SAMPLE_MARKETERS} base="/dev/preview" highlight="k1" actions={{ save: previewNoop as never, issueLink: previewNoop as never, revokeLinks: previewNoop, pay: previewNoop as never, remove: previewNoop }} />
    </div>
  );
}
