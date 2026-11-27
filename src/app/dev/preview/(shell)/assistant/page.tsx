import { AssistantView } from "@/components/assistant/assistant-view";
import { PageHeader } from "@/components/shell/app-shell";
import { previewAsk } from "../../preview-actions";

export default function PreviewAssistant() {
  return (
    <div>
      <PageHeader title="المساعد" description="اسأل عن أرقام شركتك بالكتابة أو الصوت." />
      <AssistantView
        ready
        ask={previewAsk}
        base="/dev/preview"
        sample={[
          { role: "user", text: "كم ربحت هالشهر؟" },
          {
            role: "assistant",
            text: "هالشهر حصّلت 54,600 ر.س من 3 مشاريع. الربح المتوقع من المشاريع اللي تشتغل عليها حالياً حوالي 21,300 ر.س، والفعلي حتى الآن 14,900 ر.س لأن مشروع C-2026-004 ما خلص.",
            answer: {
              answer: "",
              figures: [
                { label: "المحصّل هذا الشهر", value: "54,600 ر.س" },
                { label: "الربح المتوقع", value: "21,300 ر.س" },
                { label: "الربح الفعلي حتى الآن", value: "14,900 ر.س" },
              ],
              links: [{ label: "تقرير الأرباح", href: "/reports" }],
            },
          },
        ]}
      />
    </div>
  );
}
