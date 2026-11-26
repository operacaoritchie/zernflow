/**
 * Broadcasts: audience preview, launch, per-recipient delivery job and
 * delivery receipts. Every send goes through the send policy (lib/send-policy).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import {
  checkEligibility,
  classifySendError,
  decideSend,
  nextAllowedTime,
  type SendKind,
  type SkipReason,
} from "@/lib/send-policy";
import {
  fillPlaceholders,
  loadChannel,
  loadContactFacts,
  loadWorkspaceSending,
  policyInputFor,
  recordAttempt,
  type ChannelFacts,
} from "@/lib/send-context";
import { resolveSegmentContacts } from "@/lib/broadcast-segment";
import { idempotencyKeyFor, sendFreeform, sendTemplateMessage, ZernioSendError } from "@/lib/zernio-send";
import { JobRequeueError } from "@/lib/job-errors";
import type { SendingSettings } from "@/lib/workspace-settings";

type SB = SupabaseClient<Database>;
type BroadcastRow = Database["public"]["Tables"]["broadcasts"]["Row"];

/** Spacing between recipients (~15 per minute), leaving room for flow jobs. */
const RECIPIENT_SPACING_MS = 4000;

export interface BroadcastTemplate {
  templateName: string;
  templateLanguage: string;
  params: string[];
  templateBody?: string;
}

export function parseTemplate(raw: Json | null | undefined): BroadcastTemplate | null {
  const t = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  if (!t || typeof t.templateName !== "string" || !t.templateName) return null;
  return {
    templateName: t.templateName,
    templateLanguage: typeof t.templateLanguage === "string" ? t.templateLanguage : "",
    params: Array.isArray(t.params) ? (t.params as unknown[]).map((p) => String(p ?? "")) : [],
    templateBody: typeof t.templateBody === "string" ? t.templateBody : undefined,
  };
}

export function broadcastText(broadcast: Pick<BroadcastRow, "message_content">): string {
  const c = broadcast.message_content as { text?: string } | null;
  return (c?.text ?? "").trim();
}

/** WhatsApp with a template → template; everything else → free-form text. */
export function broadcastKind(channel: ChannelFacts, template: BroadcastTemplate | null): SendKind {
  return channel.platform === "whatsapp" && template ? "template" : "freeform";
}

export type BroadcastProblem =
  | "no_channel"
  | "channel_inactive"
  | "empty_message"
  | "no_template"
  | "no_api_key"
  | "bulk_disabled";

export interface AudienceEntry {
  contactId: string;
  name: string | null;
  phone: string | null;
  reason?: SkipReason;
}

export interface Audience {
  channel: ChannelFacts;
  kind: SendKind;
  total: number;
  eligible: AudienceEntry[];
  skipped: AudienceEntry[];
  skippedByReason: Partial<Record<SkipReason, number>>;
}

/** Problems that block sending no matter who the audience is. */
export async function checkBroadcastSetup(
  supabase: SB,
  broadcast: BroadcastRow
): Promise<{ problem: BroadcastProblem } | { channel: ChannelFacts; settings: SendingSettings; apiKey: string }> {
  if (!broadcast.channel_id) return { problem: "no_channel" };
  const channel = await loadChannel(supabase, broadcast.channel_id);
  if (!channel) return { problem: "no_channel" };
  if (!channel.isActive) return { problem: "channel_inactive" };

  const template = parseTemplate(broadcast.template);
  if (channel.platform === "whatsapp") {
    if (!template && !broadcastText(broadcast)) return { problem: "no_template" };
  } else if (!broadcastText(broadcast)) {
    return { problem: "empty_message" };
  }

  const { settings, apiKey } = await loadWorkspaceSending(supabase, broadcast.workspace_id);
  if (!apiKey) return { problem: "no_api_key" };
  if (!settings.bulkSendingEnabled) return { problem: "bulk_disabled" };
  return { channel, settings, apiKey };
}

/** Who would receive the broadcast now, and who is left out and why. No writes. */
export async function buildAudience(
  supabase: SB,
  broadcast: BroadcastRow,
  channel: ChannelFacts,
  settings: SendingSettings
): Promise<Audience> {
  const template = parseTemplate(broadcast.template);
  const kind = broadcastKind(channel, template);
  const contactIds = await resolveSegmentContacts(supabase, broadcast.workspace_id, broadcast.segment_filter);
  const facts = await loadContactFacts(supabase, broadcast.workspace_id, contactIds);

  const eligible: AudienceEntry[] = [];
  const skipped: AudienceEntry[] = [];
  const skippedByReason: Partial<Record<SkipReason, number>> = {};

  for (const id of contactIds) {
    const f = facts.get(id);
    if (!f) continue;
    // Contacts who never talked on this channel show up as "no_conversation".
    const decision = checkEligibility(
      policyInputFor(f, channel, kind, settings, { templateSet: kind === "template" ? !!template : undefined })
    );
    const entry: AudienceEntry = { contactId: id, name: f.displayName, phone: f.phone };
    if (decision.action === "send") {
      eligible.push(entry);
    } else if (decision.action === "skip") {
      entry.reason = decision.reason;
      skipped.push(entry);
      skippedByReason[decision.reason] = (skippedByReason[decision.reason] ?? 0) + 1;
    }
  }

  return { channel, kind, total: contactIds.length, eligible, skipped, skippedByReason };
}

export class BroadcastLaunchError extends Error {
  constructor(
    public code: string,
    message?: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(message ?? code);
  }
}

/**
 * Creates the recipient rows (eligible = pending, others = skipped with the
 * reason) and schedules one delivery job per eligible recipient.
 * Claims the broadcast first (draft/scheduled → sending) so it never launches twice.
 */
export async function launchBroadcast(
  supabase: SB,
  broadcast: BroadcastRow,
  opts: { confirmCount?: number | null; fromStatuses?: Array<BroadcastRow["status"]> } = {}
): Promise<{ eligible: number; skipped: number; startsAt: string }> {
  const setup = await checkBroadcastSetup(supabase, broadcast);
  if ("problem" in setup) throw new BroadcastLaunchError(setup.problem);
  const { channel, settings } = setup;

  const audience = await buildAudience(supabase, broadcast, channel, settings);
  if (audience.eligible.length === 0) {
    throw new BroadcastLaunchError("no_eligible", undefined, { skippedByReason: audience.skippedByReason });
  }
  if (
    opts.confirmCount !== undefined &&
    audience.eligible.length > settings.confirmThreshold &&
    opts.confirmCount !== audience.eligible.length
  ) {
    throw new BroadcastLaunchError("confirmation_required", undefined, { eligible: audience.eligible.length });
  }

  const fromStatuses = opts.fromStatuses ?? ["draft", "scheduled"];
  const { data: claimed, error: claimError } = await supabase
    .from("broadcasts")
    .update({ status: "sending", total_recipients: audience.eligible.length, paused_at: null })
    .eq("id", broadcast.id)
    .in("status", fromStatuses)
    .select("id");
  if (claimError) throw new BroadcastLaunchError("claim_failed", claimError.message);
  if (!claimed || claimed.length === 0) throw new BroadcastLaunchError("already_started");

  try {
    // A relaunch (e.g. after a failed first attempt) must not double the rows.
    await supabase.from("broadcast_recipients").delete().eq("broadcast_id", broadcast.id);

    const rows = [
      ...audience.eligible.map((e) => ({
        broadcast_id: broadcast.id,
        contact_id: e.contactId,
        channel_id: channel.id,
        status: "pending",
        phone: audience.kind === "template" ? e.phone : null,
      })),
      ...audience.skipped.map((e) => ({
        broadcast_id: broadcast.id,
        contact_id: e.contactId,
        channel_id: channel.id,
        status: "skipped",
        skip_reason: e.reason ?? null,
        phone: e.phone,
      })),
    ];

    const pendingIds: string[] = [];
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await supabase
        .from("broadcast_recipients")
        .insert(rows.slice(i, i + 500))
        .select("id, status");
      if (error) throw new Error(`could not create recipients: ${error.message}`);
      pendingIds.push(...(data ?? []).filter((r) => r.status === "pending").map((r) => r.id));
    }

    const now = Date.now();
    const start = (settings.quietHours && nextAllowedTime(now, settings.quietHours))?.getTime() ?? now;
    const jobs = pendingIds.map((recipientId, index) => ({
      type: "send_broadcast",
      payload: { broadcastId: broadcast.id, recipientId } as unknown as Json,
      run_at: new Date(start + index * RECIPIENT_SPACING_MS).toISOString(),
      status: "pending" as const,
    }));
    for (let i = 0; i < jobs.length; i += 100) {
      const { error } = await supabase.from("scheduled_jobs").insert(jobs.slice(i, i + 100));
      if (error) throw new Error(`could not schedule deliveries: ${error.message}`);
    }

    await supabase.rpc("refresh_broadcast_counts", { b_id: broadcast.id });
    return {
      eligible: audience.eligible.length,
      skipped: audience.skipped.length,
      startsAt: new Date(start).toISOString(),
    };
  } catch (err) {
    // Undo: nothing was sent yet (jobs run from the cron), so going back to
    // the previous state is safe.
    await supabase.from("scheduled_jobs").delete().eq("type", "send_broadcast").contains("payload", { broadcastId: broadcast.id }).eq("status", "pending");
    await supabase.from("broadcast_recipients").delete().eq("broadcast_id", broadcast.id);
    await supabase
      .from("broadcasts")
      .update({ status: broadcast.status, total_recipients: 0 })
      .eq("id", broadcast.id);
    throw err;
  }
}

/** Marks the broadcast completed once no recipient is left unfinished. */
export async function settleBroadcastIfDone(supabase: SB, broadcastId: string) {
  const { count, error } = await supabase
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcastId)
    .in("status", ["pending", "sending"]);
  if (error) return;
  if (count === 0) {
    await supabase
      .from("broadcasts")
      .update({ status: "completed" })
      .eq("id", broadcastId)
      .eq("status", "sending");
  }
}

export async function refreshBroadcastCounts(supabase: SB, broadcastId: string) {
  const { error } = await supabase.rpc("refresh_broadcast_counts", { b_id: broadcastId });
  if (error) console.error(`refresh_broadcast_counts(${broadcastId}) failed:`, error.message);
}

/**
 * Delivery job for one recipient. Re-checks the policy at send time (the
 * window may have closed, the contact may have said SAIR), honours quiet
 * hours and pause, and retries only temporary errors. The Idempotency-Key
 * ties every retry to the first attempt, so a retry never double-sends.
 */
export async function deliverBroadcastRecipient(
  supabase: SB,
  payload: { broadcastId: string; recipientId: string }
) {
  const { data: recipient, error: recipientError } = await supabase
    .from("broadcast_recipients")
    .select("*, broadcasts(*)")
    .eq("id", payload.recipientId)
    .single();

  if (!recipient) {
    if (recipientError && recipientError.code !== "PGRST116") {
      throw new Error(`broadcast recipient ${payload.recipientId} could not be loaded: ${recipientError.message}`);
    }
    return;
  }
  if (recipient.status !== "pending" && recipient.status !== "sending") return;

  const broadcast = recipient.broadcasts as unknown as BroadcastRow | null;
  if (!broadcast) return;

  const settleSkip = async (reason: string) => {
    await supabase
      .from("broadcast_recipients")
      .update({ status: "skipped", skip_reason: reason })
      .eq("id", recipient.id)
      .in("status", ["pending", "sending"]);
    await recordAttempt(supabase, {
      workspaceId: broadcast.workspace_id,
      source: "broadcast",
      sourceId: broadcast.id,
      contactId: recipient.contact_id,
      channelId: recipient.channel_id,
      decision: "skipped",
      reason,
    });
    await refreshBroadcastCounts(supabase, broadcast.id);
    await settleBroadcastIfDone(supabase, broadcast.id);
  };

  if (broadcast.status === "cancelled") return settleSkip("cancelled");
  if (broadcast.status === "paused") {
    throw new JobRequeueError(new Date(Date.now() + 60_000), "broadcast paused");
  }

  const { settings, apiKey } = await loadWorkspaceSending(supabase, broadcast.workspace_id);
  const channel = await loadChannel(supabase, broadcast.channel_id ?? recipient.channel_id);
  if (!channel) return settleSkip("channel_inactive");
  if (!apiKey) return settleSkip("no_api_key");

  const template = parseTemplate(broadcast.template);
  const kind = broadcastKind(channel, template);
  const facts = (await loadContactFacts(supabase, broadcast.workspace_id, [recipient.contact_id])).get(
    recipient.contact_id
  );
  if (!facts) return settleSkip("contact_deleted");

  const decision = decideSend(
    policyInputFor(facts, channel, kind, settings, { templateSet: kind === "template" ? !!template : undefined })
  );
  if (decision.action === "wait") {
    throw new JobRequeueError(decision.until, "quiet hours");
  }
  if (decision.action === "skip") {
    if (decision.reason === "bulk_disabled") {
      // Emergency switch: hold, do not drop; it resumes when switched back on.
      throw new JobRequeueError(new Date(Date.now() + 5 * 60_000), "bulk sending disabled");
    }
    return settleSkip(decision.reason);
  }

  // Claim (a 'sending' row is a retry of an earlier attempt; the idempotency
  // key makes re-sending it safe).
  const { data: claim, error: claimError } = await supabase
    .from("broadcast_recipients")
    .update({ status: "sending" })
    .eq("id", recipient.id)
    .in("status", ["pending", "sending"])
    .select("id");
  if (claimError) throw new Error(`failed to claim recipient ${recipient.id}: ${claimError.message}`);
  if (!claim || claim.length === 0) return;

  const idempotencyKey = idempotencyKeyFor(`broadcast:${recipient.id}`);
  try {
    let messageId: string | null;
    if (kind === "template") {
      const sent = await sendTemplateMessage(apiKey, {
        accountId: channel.lateAccountId,
        phone: facts.phone!,
        templateName: template!.templateName,
        templateLanguage: template!.templateLanguage,
        templateParams: template!.params.map((p) => fillPlaceholders(p, facts.variables).trim()),
        idempotencyKey,
      });
      messageId = sent.messageId;
    } else {
      const conv = facts.conversations.find((c) => c.channelId === channel.id)!;
      const sent = await sendFreeform(apiKey, {
        accountId: channel.lateAccountId,
        conversationId: conv.lateConversationId!,
        text: fillPlaceholders(broadcastText(broadcast), facts.variables),
        idempotencyKey,
      });
      messageId = sent.messageId;
    }

    await supabase
      .from("broadcast_recipients")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        platform_message_id: messageId,
        phone: kind === "template" ? facts.phone : recipient.phone,
        error_message: null,
      })
      .eq("id", recipient.id);
    await recordAttempt(supabase, {
      workspaceId: broadcast.workspace_id,
      source: "broadcast",
      sourceId: broadcast.id,
      contactId: recipient.contact_id,
      channelId: channel.id,
      kind,
      decision: "sent",
      platformMessageId: messageId,
    });
  } catch (err) {
    const status = err instanceof ZernioSendError ? err.status : null;
    const message = err instanceof Error ? err.message : String(err);
    const info = classifySendError(status, message);

    if (info.temporary) {
      // Back to pending and let the job retry with backoff; when retries run
      // out the cron settles the recipient as failed.
      await supabase
        .from("broadcast_recipients")
        .update({ status: "pending", error_message: message.slice(0, 500) })
        .eq("id", recipient.id);
      throw err;
    }

    await supabase
      .from("broadcast_recipients")
      .update(
        info.reason
          ? { status: "skipped", skip_reason: info.reason, error_message: message.slice(0, 500) }
          : { status: "failed", error_message: message.slice(0, 500) }
      )
      .eq("id", recipient.id);
    await recordAttempt(supabase, {
      workspaceId: broadcast.workspace_id,
      source: "broadcast",
      sourceId: broadcast.id,
      contactId: recipient.contact_id,
      channelId: channel.id,
      kind,
      decision: info.reason ? "skipped" : "failed",
      reason: info.reason,
      error: message,
    });
  }

  await refreshBroadcastCounts(supabase, broadcast.id);
  await settleBroadcastIfDone(supabase, broadcast.id);
}

/** A delivery job that ran out of retries: the recipient becomes failed. */
export async function settleRecipientAfterRetries(
  supabase: SB,
  payload: { broadcastId?: string; recipientId?: string } | null,
  errorMessage: string
) {
  if (!payload?.broadcastId || !payload?.recipientId) return;
  const { error } = await supabase
    .from("broadcast_recipients")
    .update({ status: "failed", error_message: errorMessage.slice(0, 500) })
    .eq("id", payload.recipientId)
    .in("status", ["pending", "sending"]);
  if (error) {
    console.error(`Failed to settle broadcast recipient ${payload.recipientId}:`, error);
    return;
  }
  await refreshBroadcastCounts(supabase, payload.broadcastId);
  await settleBroadcastIfDone(supabase, payload.broadcastId);
}

const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

/**
 * message.delivered / message.read / message.failed from Zernio. Matches the
 * recipient by the message id stored at send time and only moves forward
 * (a late "delivered" never overwrites "read").
 */
export async function applyDeliveryReceipt(
  supabase: SB,
  event: "message.delivered" | "message.read" | "message.failed",
  messageIds: string[],
  errorText: string | null
): Promise<number> {
  const ids = Array.from(new Set(messageIds.filter(Boolean)));
  if (ids.length === 0) return 0;

  const { data: rows, error } = await supabase
    .from("broadcast_recipients")
    .select("id, broadcast_id, status")
    .in("platform_message_id", ids);
  if (error || !rows?.length) return 0;

  const now = new Date().toISOString();
  const touched = new Set<string>();
  for (const row of rows) {
    if (event === "message.failed") {
      if (row.status === "failed") continue;
      await supabase
        .from("broadcast_recipients")
        .update({ status: "failed", error_message: (errorText ?? "delivery failed").slice(0, 500) })
        .eq("id", row.id);
    } else {
      const target = event === "message.read" ? "read" : "delivered";
      if ((STATUS_RANK[row.status] ?? 0) >= STATUS_RANK[target] || !(row.status in STATUS_RANK)) continue;
      await supabase
        .from("broadcast_recipients")
        .update(target === "read" ? { status: "read", read_at: now } : { status: "delivered", delivered_at: now })
        .eq("id", row.id);
    }
    touched.add(row.broadcast_id);
  }
  for (const id of touched) await refreshBroadcastCounts(supabase, id);
  return touched.size;
}
