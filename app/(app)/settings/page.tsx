import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GuardianSettings } from "./_components/guardian-settings";
import { StudentSettings } from "./_components/student-settings";
import { TutorSettings } from "./_components/tutor-settings";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role === "student") return <StudentSettings userId={user.id} />;
  if (profile?.role === "guardian") return <GuardianSettings userId={user.id} />;
  if (profile?.role === "tutor") return <TutorSettings userId={user.id} />;

  return null;
}
