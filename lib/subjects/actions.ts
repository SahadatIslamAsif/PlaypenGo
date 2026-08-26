"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error: string | null };

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

export async function addSubject(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, userId } = await currentUser();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const teacherName = String(formData.get("teacher_name") ?? "").trim();
  const catalogId = String(formData.get("catalog_id") ?? "").trim();

  if (!displayName) {
    return { error: "Enter a subject name." };
  }

  const { error } = await supabase.from("student_subjects").insert({
    student_id: userId,
    display_name: displayName,
    teacher_name: teacherName || null,
    catalog_id: catalogId || null,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "You already have a subject with that name." };
    }
    return { error: error.message };
  }

  revalidatePath("/subjects");
  return { error: null };
}

export async function addPaper(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, userId } = await currentUser();
  const studentSubjectId = String(formData.get("student_subject_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    return { error: "Enter a paper name." };
  }

  const { error } = await supabase.from("subject_papers").insert({
    student_id: userId,
    student_subject_id: studentSubjectId,
    name,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "This subject already has a paper with that name." };
    }
    return { error: error.message };
  }

  revalidatePath("/subjects");
  return { error: null };
}

export async function addChapter(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, userId } = await currentUser();
  const studentSubjectId = String(formData.get("student_subject_id") ?? "");
  const paperId = String(formData.get("paper_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    return { error: "Enter a chapter name." };
  }

  const { error } = await supabase.from("chapters").insert({
    student_id: userId,
    student_subject_id: studentSubjectId,
    paper_id: paperId || null,
    name,
    source: "manual",
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/subjects");
  return { error: null };
}

export async function updateChapterStatus(chapterId: string, status: string) {
  const { supabase } = await currentUser();

  const { error } = await supabase
    .from("chapters")
    .update({ status })
    .eq("id", chapterId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/subjects");
  return { error: null };
}

export async function deleteSubject(formData: FormData) {
  const { supabase } = await currentUser();
  const id = String(formData.get("student_subject_id") ?? "");
  if (!id) return;

  await supabase.from("student_subjects").delete().eq("id", id);
  revalidatePath("/subjects");
}

export async function deletePaper(formData: FormData) {
  const { supabase } = await currentUser();
  const id = String(formData.get("paper_id") ?? "");
  if (!id) return;

  await supabase.from("subject_papers").delete().eq("id", id);
  revalidatePath("/subjects");
}

export async function deleteChapter(formData: FormData) {
  const { supabase } = await currentUser();
  const id = String(formData.get("chapter_id") ?? "");
  if (!id) return;

  await supabase.from("chapters").delete().eq("id", id);
  revalidatePath("/subjects");
}
