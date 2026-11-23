import { CalibrationView } from "@/components/catalogue/calibration-view";
import { requirePermission } from "@/lib/auth/session";
import { loadCalibration } from "@/lib/data/calibration";
import { applyCalibration } from "../engine-actions";

export default async function CalibrationPage() {
  const session = await requirePermission("costs.view");
  const data = await loadCalibration(session);
  return <CalibrationView data={data} apply={applyCalibration} />;
}
