import { ClientsView } from "@/components/clients/clients-view";
import { SAMPLE_CLIENTS } from "../../sample-clients";

export default function P() {
  return <ClientsView clients={SAMPLE_CLIENTS} canManage base="/dev/preview" />;
}
