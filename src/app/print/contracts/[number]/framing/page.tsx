import { FramingPrint } from "@/components/quotes/framing-print";
import { requirePermission } from "@/lib/auth/session";
import { loadProjectFraming } from "@/lib/data/framing";

/** Metal framing plan of a project (its contract's agreed version) — for the technician on site. */
export default async function PrintProjectFraming({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("quotes.view");
  const doc = await loadProjectFraming(session, decodeURIComponent(number));
  return <FramingPrint session={session} doc={doc} path={`/print/contracts/${encodeURIComponent(doc.number)}/framing`} />;
}
