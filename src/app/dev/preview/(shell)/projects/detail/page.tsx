import { ProjectView } from "@/components/projects/project-views";
import { SAMPLE_PROJECT } from "../../../sample-projects";

export default function P() {
  return <ProjectView data={SAMPLE_PROJECT} base="/dev/preview" />;
}
