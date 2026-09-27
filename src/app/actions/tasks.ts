"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type TaskResult = { error?: string; ok?: boolean };

const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};

export async function addTask(_prev: unknown, fd: FormData): Promise<TaskResult> {
  const supabase = await createClient();
  const title = text(fd, "title");
  const projectId = text(fd, "project_id");
  if (!title) return { error: "Say what the task is." };
  if (!projectId) return { error: "Choose the project it is for." };
  const due = text(fd, "due_date");

  const { error } = await supabase.from("project_tasks").insert({
    project_id: projectId,
    title,
    description: text(fd, "description"),
    assignee_id: text(fd, "assignee_id"),
    due_date: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
  });
  if (error) return { error: error.message };

  revalidatePath("/tasks");
  revalidatePath("/");
  return { ok: true };
}

/** Tick a task off, or open it again. */
export async function setTaskDone(id: string, done: boolean): Promise<TaskResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("project_tasks")
    .update(
      done ? { status: "completed", completed_at: new Date().toISOString() } : { status: "not_started", completed_at: null },
      { count: "exact" },
    )
    .eq("id", id);
  if (error) return { error: error.message };
  if (!count) return { error: "You don't have permission to change tasks." };
  revalidatePath("/tasks");
  revalidatePath("/");
  return { ok: true };
}
