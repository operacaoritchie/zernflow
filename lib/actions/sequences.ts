"use server";

import { getT } from "@/lib/i18n/server";
import { getWorkspace } from "@/lib/workspace";
import { revalidatePath } from "next/cache";
import type { SequenceStep } from "@/lib/types/database";
import { nextStepAt, validateSteps } from "@/lib/sequence-steps";

export async function createSequence(name: string) {
  const t = await getT("errors");
  const { workspace, supabase } = await getWorkspace();

  const trimmed = name.trim();
  if (!trimmed) return { error: t("nameRequired") };

  const { data, error } = await supabase
    .from("sequences")
    .insert({ workspace_id: workspace.id, name: trimmed })
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath("/dashboard/sequences");
  return { ok: true, sequence: data };
}

export async function updateSequence(
  sequenceId: string,
  updates: {
    name?: string;
    description?: string | null;
    steps?: SequenceStep[];
    status?: "draft" | "active" | "paused";
    exitOnReply?: boolean;
  }
) {
  const t = await getT("errors");
  const { workspace, supabase } = await getWorkspace();

  // Verify ownership
  const { data: existing } = await supabase
    .from("sequences")
    .select("id")
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id)
    .single();

  if (!existing) return { error: t("sequenceNotFound") };

  if (updates.status === "active") {
    const { data: current } = await supabase.from("sequences").select("steps").eq("id", sequenceId).single();
    const steps = updates.steps ?? ((current?.steps as unknown as SequenceStep[]) || []);
    const problems = validateSteps(steps);
    if (problems.length) return { error: t("sequenceInvalid"), problems };
  }

  const { exitOnReply, ...rest } = updates;
  const { data, error } = await supabase
    .from("sequences")
    .update({
      ...rest,
      ...(exitOnReply !== undefined ? { exit_on_reply: exitOnReply } : {}),
      steps: updates.steps ? JSON.parse(JSON.stringify(updates.steps)) : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sequenceId)
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath("/dashboard/sequences");
  revalidatePath(`/dashboard/sequences/${sequenceId}`);
  return { ok: true, sequence: data };
}

export async function deleteSequence(sequenceId: string) {
  const { workspace, supabase } = await getWorkspace();

  const { error } = await supabase
    .from("sequences")
    .delete()
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/sequences");
  return { ok: true };
}

export async function enrollContact(
  sequenceId: string,
  contactId: string,
  channelId: string
) {
  const t = await getT("errors");
  const { workspace, supabase } = await getWorkspace();

  // Verify sequence ownership
  const { data: sequence } = await supabase
    .from("sequences")
    .select("id, steps, status")
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id)
    .single();

  if (!sequence) return { error: t("sequenceNotFound") };
  if (sequence.status !== "active") return { error: t("sequenceInactive") };

  const steps = (sequence.steps as unknown as SequenceStep[]) || [];
  if (steps.length === 0) return { error: t("sequenceNoSteps") };

  const { data, error } = await supabase
    .from("sequence_enrollments")
    .insert({
      sequence_id: sequenceId,
      contact_id: contactId,
      channel_id: channelId,
      next_step_at: nextStepAt(steps, 0),
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: t("alreadyEnrolled") };
    }
    return { error: error.message };
  }

  revalidatePath(`/dashboard/sequences/${sequenceId}`);
  return { ok: true, enrollment: data };
}

export async function cancelEnrollment(enrollmentId: string) {
  const t = await getT("errors");
  const { workspace, supabase } = await getWorkspace();

  // Verify the enrollment belongs to a sequence in this workspace
  const { data: enrollment } = await supabase
    .from("sequence_enrollments")
    .select("id, sequence_id, sequences!inner(workspace_id)")
    .eq("id", enrollmentId)
    .single();

  if (!enrollment) return { error: t("enrollmentNotFound") };

  const seq = enrollment.sequences as unknown as { workspace_id: string };
  if (seq.workspace_id !== workspace.id) {
    return { error: t("enrollmentNotFound") };
  }

  const { error } = await supabase
    .from("sequence_enrollments")
    .update({ status: "cancelled", next_step_at: null })
    .eq("id", enrollmentId);

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/sequences/${enrollment.sequence_id}`);
  return { ok: true };
}

/** Contacts matching a search, with the channels they can be enrolled on. */
export async function searchContactsForEnrollment(query: string) {
  const { workspace, supabase } = await getWorkspace();
  const q = query.trim().replace(/^@/, "");
  if (q.length < 2) return { contacts: [] };

  const { data } = await supabase
    .from("contacts")
    .select("id, display_name, contact_channels(platform_username, channel_id, channels(platform, display_name, username))")
    .eq("workspace_id", workspace.id)
    .ilike("display_name", `%${q}%`)
    .limit(8);

  const { data: byUsername } = await supabase
    .from("contact_channels")
    .select("contact_id, contacts!inner(id, workspace_id, display_name, contact_channels(platform_username, channel_id, channels(platform, display_name, username)))")
    .eq("contacts.workspace_id", workspace.id)
    .ilike("platform_username", `%${q}%`)
    .limit(8);

  type Row = {
    id: string;
    display_name: string | null;
    contact_channels: Array<{
      platform_username: string | null;
      channel_id: string;
      channels: { platform: string; display_name: string | null; username: string | null } | null;
    }> | null;
  };
  const rows = new Map<string, Row>();
  for (const c of (data ?? []) as Row[]) rows.set(c.id, c);
  for (const r of (byUsername ?? []) as Array<{ contacts: Row }>) rows.set(r.contacts.id, r.contacts);

  return {
    contacts: Array.from(rows.values()).slice(0, 8).map((c) => ({
      id: c.id,
      name: c.display_name,
      channels: (c.contact_channels ?? []).map((cc) => ({
        channelId: cc.channel_id,
        platform: cc.channels?.platform ?? "",
        username: cc.platform_username,
      })),
    })),
  };
}
