import { ScheduleView } from "@/components/schedule/schedule-view";
import { SAMPLE_SCHEDULE, SAMPLE_TODAY } from "../../sample-schedule";

export default function P() {
  return <ScheduleView data={SAMPLE_SCHEDULE} today={SAMPLE_TODAY} />;
}
