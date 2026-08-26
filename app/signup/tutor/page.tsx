import { AuthShell } from "@/components/auth-shell";
import { SignupForm } from "../signup-form";

export default function TutorSignupPage() {
  return (
    <AuthShell title="Tutor account" subtitle="Only pre-approved email addresses can create a tutor account.">
      <SignupForm role="tutor" />
    </AuthShell>
  );
}
