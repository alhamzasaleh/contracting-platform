import { AuthLayout } from "@/components/auth/auth-layout";
import { LoginForm } from "@/components/auth/login-form";

export default function PreviewLogin() {
  return (
    <AuthLayout>
      <LoginForm demo />
    </AuthLayout>
  );
}
