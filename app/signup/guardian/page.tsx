import { AuthShell } from "@/components/auth-shell";
import { SignupForm } from "../signup-form";

export default function GuardianSignupPage() {
  return (
    <AuthShell title="Guardian account" subtitle="You'll enter your student's family code next.">
      <SignupForm role="guardian" />
    </AuthShell>
  );
}
