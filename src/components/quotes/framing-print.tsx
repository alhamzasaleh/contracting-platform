import { BrandStyle } from "@/components/brand-style";
import type { SessionContext } from "@/lib/auth/session";
import type { FramingDoc } from "@/lib/data/framing";
import { orgLogoUrl } from "@/lib/org";
import { FramingScreen } from "./framing-document";

/** The framing plan print page (quote or project). */
export async function FramingPrint({ session, doc, path }: { session: SessionContext; doc: FramingDoc; path: string }) {
  const o = session.organization;
  const logoUrl = await orgLogoUrl(o);
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={o.brand.primary} accent={o.brand.accent} />
      <FramingScreen org={{ name: o.name, legal_name: o.legal_name, cr_number: o.cr_number, vat_number: o.vat_number, phone: o.phone, city: o.city, logoUrl }} doc={doc} path={path} />
    </main>
  );
}
