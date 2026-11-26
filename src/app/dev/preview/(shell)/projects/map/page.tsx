import { ProjectsMapView } from "@/components/projects/projects-map";
import { SAMPLE_PROJECTS } from "../../../sample-projects";

export default function P() {
  return <ProjectsMapView projects={SAMPLE_PROJECTS} base="/dev/preview" canSetSite />;
}
