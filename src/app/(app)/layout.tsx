import { BrandStyle } from "@/components/brand-style";
import { AppShell } from "@/components/shell/app-shell";
import { getSession } from "@/lib/auth/session";
import { loadBell } from "@/lib/data/notifications";
import { logoDataUrl } from "@/lib/org";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const [logoUrl, notifications] = await Promise.all([logoDataUrl(session.organization.logo_path), loadBell(session)]);

  return (
    <>
      <BrandStyle primary={session.organization.brand.primary} accent={session.organization.brand.accent} />
      <AppShell
        data={{
          user: { name: session.profile.full_name, phone: session.phone },
          org: { name: session.organization.name, logoUrl },
          role: session.role,
          permissions: session.permissions,
          notifications,
        }}
      >
        {children}
      </AppShell>
    </>
  );
}
