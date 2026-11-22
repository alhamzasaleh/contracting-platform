import { BrandingEditor } from "@/components/settings/branding-editor";
import { can, getSession } from "@/lib/auth/session";
import { signedAssetUrl } from "@/lib/org";
import { removeLogo, saveBranding } from "../actions";

export default async function BrandingPage() {
  const session = await getSession();
  const o = session.organization;
  const logoUrl = await signedAssetUrl(o.logo_path);
  return (
    <BrandingEditor
      orgName={o.name}
      initialBrand={{ primary: o.brand.primary, accent: o.brand.accent ?? null, source: o.brand.source ?? "default" }}
      initialLogoUrl={logoUrl}
      canEdit={can(session, "settings.manage")}
      onSave={saveBranding}
      onRemoveLogo={removeLogo}
    />
  );
}
