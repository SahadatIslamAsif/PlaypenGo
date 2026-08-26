import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GuardianHome } from "./_components/guardian-home";
import { StudentHome } from "./_components/student-home";
import { TutorHome } from "./_components/tutor-home";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role === "student") return <StudentHome userId={user.id} />;
  if (profile?.role === "guardian") return <GuardianHome userId={user.id} />;
  if (profile?.role === "tutor") return <TutorHome userId={user.id} />;

  return null;
}
