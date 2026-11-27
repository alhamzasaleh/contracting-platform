import { ProjectView } from "@/components/projects/project-views";
import { previewNoop } from "../../../preview-actions";
import { SAMPLE_PROJECT } from "../../../sample-projects";

export default function P() {
  return (
    <ProjectView
      data={SAMPLE_PROJECT}
      base="/dev/preview"
      actions={{
        checkIn: previewNoop, uploadPhoto: previewNoop as never, saveProgress: previewNoop, draftReport: previewNoop as never, sendStage: previewNoop, updateNote: previewNoop,
        saveSite: previewNoop, readSiteLink: previewNoop as never,
        measure: { save: previewNoop as never, send: previewNoop, remove: previewNoop, refund: previewNoop },
      }}
    />
  );
}
