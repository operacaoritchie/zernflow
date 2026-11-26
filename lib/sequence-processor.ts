/**
 * Sequences: due steps are claimed by the sequences cron and run as
 * `sequence_step` jobs on the scheduled_jobs queue, so they get the queue's
 * retries with backoff. Every message step goes through the send policy.
 *
 * Enrollment states:
 *   active        → next_step_at says when the current step runs
 *   paused_window → the 24-hour window closed; resumes when the contact writes
 *   completed / cancelled / exited (unsubscribed, human, replied) / failed / expired
 *
 * Only the job whose id is in step_job_id may run the step (no double sends);
 * a claim whose job vanished is released after 15 minutes.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import type { Database, Json, SequenceStep } from "@/lib/types/database";
import { classifySendError, decideSend, type SendKind } from "@/lib/send-policy";
import {
  fillPlaceholders,
  loadChannel,
  loadContactFacts,
  loadWorkspaceSending,
  policyInputFor,
  recordAttempt,
} from "@/lib/send-context";
import { idempotencyKeyFor, sendFreeform, sendTemplateMessage, ZernioSendError } from "@/lib/zernio-send";
import { nextStepAt } from "@/lib/sequence-steps";

export { nextStepAt, validateSteps, stepsAfterLongWait } from "@/lib/sequence-steps";

type SB = SupabaseClient<Database>;

const STALE_CLAIM_MS = 15 * 60 * 1000;
const HOLD_MS = 10 * 60 * 1000;

// ── Cron: claim due steps ────────────────────────────────────────────────────

export async function processSequenceSteps() {
  const supabase = await createServiceClient();
  const now = Date.now();

  const expired = await expirePausedEnrollments(supabase, now);
  const released = await releaseStaleClaims(supabase, now);

  const { data: due, error } = await supabase
    .from("sequence_enrollments")
    .select("id, current_step_index, next_step_at")
    .eq("status", "active")
    .is("step_job_id", null)
    .lte("next_step_at", new Date(now).toISOString())
    .order("next_step_at", { ascending: true })
    .limit(50);

  if (error || !due) {
    console.error("Failed to fetch sequence enrollments:", error);
    return { queued: 0, expired, released };
  }

  let queued = 0;
  for (const enrollment of due) {
    const jobId = randomUUID();
    const { data: claimed, error: claimError } = await supabase
      .from("sequence_enrollments")
      .update({ step_job_id: jobId, step_claimed_at: new Date().toISOString() })
      .eq("id", enrollment.id)
      .eq("status", "active")
      .is("step_job_id", null)
      .select("id");
    if (claimError || !claimed || claimed.length === 0) continue;

    const { error: jobError } = await supabase.from("scheduled_jobs").insert({
      id: jobId,
      type: "sequence_step",
      payload: { enrollmentId: enrollment.id, stepIndex: enrollment.current_step_index } as unknown as Json,
      run_at: new Date().toISOString(),
      status: "pending",
    });
    if (jobError) {
      console.error(`Failed to queue sequence step for ${enrollment.id}:`, jobError.message);
      await supabase
        .from("sequence_enrollments")
        .update({ step_job_id: null, step_claimed_at: null })
        .eq("id", enrollment.id)
        .eq("step_job_id", jobId);
      continue;
    }
    queued++;
  }

  return { queued, expired, released, total: due.length };
}

async function expirePausedEnrollments(supabase: SB, now: number): Promise<number> {
  const { data } = await supabase
    .from("sequence_enrollments")
    .select("id, paused_since, sequences(max_pause_days)")
    .eq("status", "paused_window")
    .lt("paused_since", new Date(now - 24 * 60 * 60 * 1000).toISOString())
    .limit(200);
  let count = 0;
  for (const e of data ?? []) {
    const days = (e.sequences as { max_pause_days: number } | null)?.max_pause_days ?? 30;
    if (!e.paused_since || new Date(e.paused_since).getTime() + days * 86_400_000 > now) continue;
    await supabase
      .from("sequence_enrollments")
      .update({ status: "expired", exit_reason: "window_closed", next_step_at: null })
      .eq("id", e.id)
      .eq("status", "paused_window");
    count++;
  }
  return count;
}

async function releaseStaleClaims(supabase: SB, now: number): Promise<number> {
  const { data } = await supabase
    .from("sequence_enrollments")
    .select("id, step_job_id")
    .not("step_job_id", "is", null)
    .lt("step_claimed_at", new Date(now - STALE_CLAIM_MS).toISOString())
    .limit(50);
  let count = 0;
  for (const e of data ?? []) {
    if (!e.step_job_id) continue;
    const { data: job } = await supabase
      .from("scheduled_jobs")
      .select("status")
      .eq("id", e.step_job_id)
      .maybeSingle();
    if (job && (job.status === "pending" || job.status === "processing")) continue;
    await supabase
      .from("sequence_enrollments")
      .update({ step_job_id: null, step_claimed_at: null })
      .eq("id", e.id)
      .eq("step_job_id", e.step_job_id);
    count++;
  }
  return count;
}

// ── Job: run one step ────────────────────────────────────────────────────────

type EnrollmentUpdate = Database["public"]["Tables"]["sequence_enrollments"]["Update"];

export async function processSequenceStepJob(
  supabase: SB,
  job: { id: string; payload: Json }
) {
  const payload = job.payload as { enrollmentId?: string; stepIndex?: number } | null;
  if (!payload?.enrollmentId) return;

  const { data: enrollment, error } = await supabase
    .from("sequence_enrollments")
    .select("*, sequences(*)")
    .eq("id", payload.enrollmentId)
    .single();
  if (!enrollment) {
    if (error && error.code !== "PGRST116") {
      throw new Error(`enrollment ${payload.enrollmentId} could not be loaded: ${error.message}`);
    }
    return;
  }
  if (enrollment.step_job_id !== job.id) return; // another claim owns this step

  /** Writes the outcome and gives up the claim in one CAS. */
  const release = async (patch: EnrollmentUpdate) => {
    const { error: updateError } = await supabase
      .from("sequence_enrollments")
      .update({ ...patch, step_job_id: null, step_claimed_at: null })
      .eq("id", enrollment.id)
      .eq("step_job_id", job.id);
    if (updateError) throw new Error(`could not update enrollment ${enrollment.id}: ${updateError.message}`);
  };

  if (enrollment.status !== "active") return release({});

  const sequence = enrollment.sequences as unknown as Database["public"]["Tables"]["sequences"]["Row"] | null;
  if (!sequence) return release({ status: "cancelled", next_step_at: null });
  if (sequence.status !== "active") {
    // Paused or back in draft: hold the contact where they are.
    return release({ next_step_at: new Date(Date.now() + HOLD_MS).toISOString() });
  }

  const steps = ((sequence.steps as unknown as SequenceStep[]) || []).filter(Boolean);
  const index = enrollment.current_step_index;
  if (payload.stepIndex !== undefined && payload.stepIndex !== index) return release({});

  const advance = async () => {
    const next = index + 1;
    if (next >= steps.length) {
      return release({
        current_step_index: next,
        status: "completed",
        completed_at: new Date().toISOString(),
        next_step_at: null,
        last_error: null,
      });
    }
    return release({ current_step_index: next, next_step_at: nextStepAt(steps, next), last_error: null });
  };

  if (index >= steps.length) {
    return release({ status: "completed", completed_at: new Date().toISOString(), next_step_at: null });
  }

  const step = steps[index];
  if (step.type === "delay") return advance();

  const kind: SendKind = step.type === "template" ? "template" : "freeform";
  const channelId = kind === "template" ? step.channelId : enrollment.channel_id;
  const channel = channelId ? await loadChannel(supabase, channelId) : null;
  const { settings, apiKey } = await loadWorkspaceSending(supabase, sequence.workspace_id);

  const fail = async (reason: string, detail?: string) => {
    await recordAttempt(supabase, {
      workspaceId: sequence.workspace_id,
      source: "sequence",
      sourceId: enrollment.id,
      contactId: enrollment.contact_id,
      channelId: channel?.id ?? null,
      kind,
      decision: "failed",
      reason,
      error: detail ?? null,
    });
    return release({ status: "failed", last_error: detail ? `${reason}: ${detail}`.slice(0, 500) : reason, next_step_at: null });
  };

  if (!channel) return fail("channel_inactive");
  if (!apiKey) return fail("no_api_key");

  const facts = (await loadContactFacts(supabase, sequence.workspace_id, [enrollment.contact_id])).get(
    enrollment.contact_id
  );
  if (!facts) return release({ status: "cancelled", exit_reason: "contact_deleted", next_step_at: null });

  const decision = decideSend(
    policyInputFor(facts, channel, kind, settings, {
      templateSet: kind === "template" ? !!(step.templateName && step.templateLanguage) : undefined,
    })
  );

  const audit = (decisionLabel: "sent" | "skipped" | "waiting", extra: { reason?: string; platformMessageId?: string | null } = {}) =>
    recordAttempt(supabase, {
      workspaceId: sequence.workspace_id,
      source: "sequence",
      sourceId: enrollment.id,
      contactId: enrollment.contact_id,
      channelId: channel.id,
      kind,
      decision: decisionLabel,
      reason: extra.reason ?? null,
      platformMessageId: extra.platformMessageId ?? null,
    });

  if (decision.action === "wait") {
    return release({ next_step_at: decision.until.toISOString() });
  }

  if (decision.action === "skip") {
    switch (decision.reason) {
      case "unsubscribed":
      case "phone_opted_out":
      case "human_takeover":
        await audit("skipped", { reason: decision.reason });
        return release({ status: "exited", exit_reason: decision.reason, next_step_at: null });
      case "window_closed":
        await audit("waiting", { reason: decision.reason });
        return release({ status: "paused_window", paused_since: new Date().toISOString(), next_step_at: null });
      case "bulk_disabled":
        return release({ next_step_at: new Date(Date.now() + 5 * 60_000).toISOString() });
      case "no_phone":
      case "no_consent":
      case "template_not_set":
        // A WhatsApp step the contact cannot receive is skipped; the rest of
        // the sequence still runs.
        await audit("skipped", { reason: decision.reason });
        return advance();
      default:
        return fail(decision.reason);
    }
  }

  const idempotencyKey = idempotencyKeyFor(`sequence:${enrollment.id}:${index}`);
  try {
    let messageId: string | null = null;
    if (kind === "template") {
      const sent = await sendTemplateMessage(apiKey, {
        accountId: channel.lateAccountId,
        phone: facts.phone!,
        templateName: step.templateName!,
        templateLanguage: step.templateLanguage!,
        templateParams: (step.params ?? []).map((p) => fillPlaceholders(p ?? "", facts.variables).trim()),
        idempotencyKey,
      });
      messageId = sent.messageId;
    } else {
      const conv = facts.conversations.find((c) => c.channelId === channel.id)!;
      const text = fillPlaceholders(step.content ?? "", facts.variables);
      const sent = await sendFreeform(apiKey, {
        accountId: channel.lateAccountId,
        conversationId: conv.lateConversationId!,
        text,
        idempotencyKey,
      });
      messageId = sent.messageId;
      await supabase.from("messages").insert({
        conversation_id: conv.id,
        direction: "outbound",
        text,
        status: "sent",
        platform_message_id: messageId,
      });
    }
    await audit("sent", { platformMessageId: messageId });
  } catch (err) {
    const status = err instanceof ZernioSendError ? err.status : null;
    const message = err instanceof Error ? err.message : String(err);
    const info = classifySendError(status, message);
    if (info.temporary) throw err; // queue retries; the claim stays with this job
    if (info.reason === "window_closed") {
      await audit("waiting", { reason: "window_closed" });
      return release({ status: "paused_window", paused_since: new Date().toISOString(), next_step_at: null });
    }
    return fail("send_failed", message);
  }

  return advance();
}

/** A step job that ran out of retries: the enrollment becomes failed. */
export async function settleSequenceStepAfterRetries(
  supabase: SB,
  jobId: string,
  payload: Json,
  errorMessage: string
) {
  const p = payload as { enrollmentId?: string } | null;
  if (!p?.enrollmentId) return;
  const { error } = await supabase
    .from("sequence_enrollments")
    .update({
      status: "failed",
      last_error: errorMessage.slice(0, 500),
      next_step_at: null,
      step_job_id: null,
      step_claimed_at: null,
    })
    .eq("id", p.enrollmentId)
    .eq("step_job_id", jobId);
  if (error) console.error(`Failed to settle enrollment ${p.enrollmentId}:`, error.message);
}

/**
 * The contact wrote on a channel: reopens the window. Enrollments paused for
 * the window resume now; sequences set to stop on reply end here.
 */
export async function onContactMessage(supabase: SB, contactId: string, channelId: string) {
  const { data } = await supabase
    .from("sequence_enrollments")
    .select("id, status, channel_id, sequences(exit_on_reply)")
    .eq("contact_id", contactId)
    .in("status", ["active", "paused_window"]);

  for (const e of data ?? []) {
    const exitOnReply = (e.sequences as { exit_on_reply: boolean } | null)?.exit_on_reply === true;
    if (exitOnReply) {
      await supabase
        .from("sequence_enrollments")
        .update({ status: "exited", exit_reason: "replied", next_step_at: null })
        .eq("id", e.id)
        .in("status", ["active", "paused_window"]);
    } else if (e.status === "paused_window" && e.channel_id === channelId) {
      await supabase
        .from("sequence_enrollments")
        .update({ status: "active", paused_since: null, next_step_at: new Date().toISOString() })
        .eq("id", e.id)
        .eq("status", "paused_window");
    }
  }
}
