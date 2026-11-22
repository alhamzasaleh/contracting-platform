import { MembersView } from "@/components/settings/members-view";
import { SAMPLE_INVITES, SAMPLE_MEMBERS } from "../../../sample";

export default function PreviewMembers() {
  return <MembersView members={SAMPLE_MEMBERS} invitations={SAMPLE_INVITES} canManage isOwner />;
}
