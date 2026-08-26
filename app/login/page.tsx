import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <AuthShell title="Sign in to PlaypenGo" subtitle="Track assessments the school portal won't show you yet.">
      <LoginForm />
    </AuthShell>
  );
}
