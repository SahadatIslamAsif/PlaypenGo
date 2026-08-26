import { AuthShell } from "@/components/auth-shell";
import { SignupForm } from "../signup-form";

export default function StudentSignupPage() {
  return (
    <AuthShell title="Student account" subtitle="You'll get a family code to share with your guardian once you're in.">
      <SignupForm role="student" />
    </AuthShell>
  );
}
