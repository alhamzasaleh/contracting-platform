import { ClientsView } from "@/components/clients/clients-view";
import { SAMPLE_CLIENTS } from "../../sample-clients";

export default function P() {
  return <ClientsView clients={SAMPLE_CLIENTS} canManage base="/dev/preview" marketers={[{ id: "mk1", number: "MK-2026-001", name: "سعد بن فهد الدوسري", is_active: true, commission_percent: 5 }]} />;
}
