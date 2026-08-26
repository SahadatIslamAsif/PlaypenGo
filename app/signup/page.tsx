import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";

const roles = [
  {
    href: "/signup/student",
    title: "Student",
    description: "Track your own subjects, results, and syllabus progress.",
  },
  {
    href: "/signup/guardian",
    title: "Guardian",
    description: "Follow a linked student's results as they're logged.",
  },
  {
    href: "/signup/tutor",
    title: "Tutor",
    description: "Log papers for your students and approve guardian links.",
  },
] as const;

export default function SignupPage() {
  return (
    <AuthShell title="Create an account" subtitle="Choose the role that matches you.">
      <div className="flex flex-col gap-3">
        {roles.map((role) => (
          <Link
            key={role.href}
            href={role.href}
            className="rounded-card border border-hairline bg-surface p-4 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <p className="text-sm font-semibold text-ink">{role.title}</p>
            <p className="mt-0.5 text-xs text-muted">{role.description}</p>
          </Link>
        ))}
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
