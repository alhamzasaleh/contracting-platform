import { UserX } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const t = await getTranslations("onboarding");
  const tUser = await getTranslations("user");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  await supabase.rpc("accept_pending_invitations");
  const { count } = await supabase
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.user.id)
    .eq("status", "active");
  if ((count ?? 0) > 0) redirect("/");

  const [{ data: canCreate }, { data: profile }] = await Promise.all([
    supabase.rpc("can_create_organization"),
    supabase.from("profiles").select("full_name").eq("id", auth.user.id).single(),
  ]);

  return (
    <AuthLayout>
      {canCreate ? (
        <OnboardingForm defaultName={profile?.full_name} />
      ) : (
        <div className="flex flex-col items-start gap-4">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-warning-soft text-warning">
            <UserX className="size-6" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{t("closedTitle")}</h1>
          <p className="text-[15px] text-muted-foreground">{t("closedBody")}</p>
          <form action="/auth/signout" method="post">
            <Button variant="secondary" type="submit">
              {tUser("signOut")}
            </Button>
          </form>
        </div>
      )}
    </AuthLayout>
  );
}
