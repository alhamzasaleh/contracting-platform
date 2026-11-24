import { MembersView } from "@/components/settings/members-view";
import { previewNoop } from "../../../preview-actions";
import { SAMPLE_INVITES, SAMPLE_MEMBERS } from "../../../sample";

export default function PreviewMembers() {
  return (
    <MembersView
      members={SAMPLE_MEMBERS}
      invitations={SAMPLE_INVITES}
      canManage
      isOwner
      canViewHr
      actions={{ invite: previewNoop, update: previewNoop, revoke: previewNoop, link: previewNoop, unlink: previewNoop }}
      base="/dev/preview"
      // typing 0537087857 offers to link the invitation to رحيم الله خان
      employees={[{ employee_id: "e1", full_name: "رحيم الله خان", job_title: "دهّان", phone: "966537087857", user_id: null }]}
      projects={[
        { id: "k1", number: "C-2026-004", client: "أبو محمد العتيبي" },
        { id: "k0", number: "C-2026-003", client: "شركة البناء المتقن" },
      ]}
    />
  );
}
