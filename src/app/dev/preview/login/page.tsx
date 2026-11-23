import { AuthLayout } from "@/components/auth/auth-layout";
import { LoginForm } from "@/components/auth/login-form";
import { SAMPLE_ORG } from "../sample";
import { SAMPLE_LOGO } from "../sample-logo";

export default function PreviewLogin() {
  return (
    <AuthLayout identity={{ name: SAMPLE_ORG.name, logoUrl: SAMPLE_LOGO }}>
      <LoginForm demo />
    </AuthLayout>
  );
}
