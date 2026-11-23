import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/auth/auth-layout";
import { LoginForm } from "@/components/auth/login-form";
import { publicIdentity } from "@/lib/org";
import { safeNext } from "@/lib/validation/phone";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("welcome") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const identity = await publicIdentity();
  return (
    <AuthLayout identity={identity}>
      <LoginForm next={safeNext(next)} />
    </AuthLayout>
  );
}
