import { ProjectView } from "@/components/projects/project-views";
import { previewNoop } from "../../../preview-actions";
import { SAMPLE_PROJECT_CREDIT } from "../../../sample-projects";

/** Handed over and fully paid, then fewer m² were measured: an amount owed back to the client. */
export default function P() {
  return (
    <ProjectView
      data={SAMPLE_PROJECT_CREDIT}
      base="/dev/preview"
      actions={{
        checkIn: previewNoop, uploadPhoto: previewNoop as never, saveProgress: previewNoop, draftReport: previewNoop as never, sendStage: previewNoop, updateNote: previewNoop,
        measure: { save: previewNoop as never, send: previewNoop, remove: previewNoop, refund: previewNoop },
      }}
    />
  );
}
