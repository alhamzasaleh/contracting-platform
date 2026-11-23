import { ClientDetailView } from "@/components/clients/clients-view";
import { SAMPLE_CLIENT_DETAIL } from "../../../sample-clients";

export default function P() {
  return <ClientDetailView detail={SAMPLE_CLIENT_DETAIL} canManage canQuote base="/dev/preview" />;
}
