import { MembersView } from "@/components/settings/members-view";
import { SAMPLE_INVITES, SAMPLE_MEMBERS } from "../../../sample";

export default function PreviewMembers() {
  return (
    <MembersView
      members={SAMPLE_MEMBERS}
      invitations={SAMPLE_INVITES}
      canManage
      isOwner
      projects={[
        { id: "k1", number: "C-2026-004", client: "أبو محمد العتيبي" },
        { id: "k0", number: "C-2026-003", client: "شركة البناء المتقن" },
      ]}
    />
  );
}
