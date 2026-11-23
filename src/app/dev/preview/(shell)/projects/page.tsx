import { ProjectsList } from "@/components/projects/project-views";
import { SAMPLE_PROJECTS } from "../../sample-projects";

export default function P() {
  return <ProjectsList projects={SAMPLE_PROJECTS} base="/dev/preview" />;
}
