import { BrandStyle } from "@/components/brand-style";
import { AppShell } from "@/components/shell/app-shell";
import { aiConfigured } from "@/lib/ai/invoice";
import { can, getSession } from "@/lib/auth/session";
import { loadBell } from "@/lib/data/notifications";
import { orgCompactLogoUrl, orgLogoUrl } from "@/lib/org";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const [logoUrl, notifications] = await Promise.all([orgLogoUrl(session.organization), loadBell(session)]);

  return (
    <>
      <BrandStyle primary={session.organization.brand.primary} accent={session.organization.brand.accent} />
      <AppShell
        data={{
          user: { name: session.profile.full_name, phone: session.phone },
          org: { name: session.organization.name, logoUrl, compactLogoUrl: orgCompactLogoUrl(session.organization) },
          role: session.role,
          permissions: session.permissions,
          notifications,
          assistant: can(session, "finance.view") ? { ready: aiConfigured() } : undefined,
        }}
      >
        {children}
      </AppShell>
    </>
  );
}
