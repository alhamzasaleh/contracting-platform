import { ServicesView } from "@/components/catalogue/services-view";
import { SAMPLE_SERVICES } from "../../sample-catalogue";

export default function P() {
  return <ServicesView services={SAMPLE_SERVICES} canManage basePath="/dev/preview" />;
}
