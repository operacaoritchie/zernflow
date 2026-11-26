import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { executeFlow } from "@/lib/flow-engine/engine";
import { matchTrigger } from "@/lib/flow-engine/trigger-matcher";
import { resolveWebhookSecret, verifyWebhookSignature } from "@/lib/zernio-webhook";
import { upsertContactForSender } from "@/lib/inbox-sync";
import { processComment } from "@/lib/comment-processor";
import type { Database } from "@/lib/types/database";
import { messagePreview } from "@/lib/message-preview";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher";
import crypto from "crypto";

// ── Zernio API webhook payload ───────────────────────────────────────────────

interface WebhookPayload {
  id?: string;
  event: string;
  message: {
    id: string;
    conversationId: string;
    platform: string;
    platformMessageId: string;
    direction: string;
    text: string | null;
    attachments: Array<{ type: string; url: string; payload?: string }>;
    sender: {
      id: string;
      name: string;
      username: string | null;
      picture: string | null;
    };
    sentAt: string;
    isRead: boolean;
  };
  conversation: {
    id: string;
    platformConversationId: string | null;
    participantId: string;
    participantName: string;
    participantUsername: string | null;
    participantPicture: string | null;
    status: string;
  };
  account: {
    id: string;
    platform: string;
    username: string;
    displayName: string;
  };
  metadata?: {
    quickReplyPayload?: string;
    callbackData?: string;
    postbackPayload?: string;
    postbackTitle?: string;
  };
  timestamp: string;
}

interface CommentWebhookPayload {
  id?: string;
  event: string;
  comment: {
    id: string;
    /** Zernio post ID; null when the comment is on a post not published through Zernio. */
    postId: string | null;
    platformPostId: string;
    platform: string;
    text: string;
    author: { id: string; username?: string; name?: string; picture?: string };
    createdAt: string;
    isReply: boolean;
    parentCommentId: string | null;
    /** Instagram only: present (true) on comments made during a live broadcast. */
    isLive?: boolean;
  };
  post: { id: string; platformPostId: string };
  account: { id: string; platform: string; username: string };
  timestamp: string;
}

// ── Webhook handler ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    return await handleWebhook(request);
  } catch (err) {
    console.error("Webhook handler error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Claim an event id for processing. Returns false when another delivery of the
 * same event already claimed it (Zernio retries with the same id), so retries
 * and redeliveries never re-run a flow. Events without an id are processed
 * unconditionally rather than dropped.
 */
async function claimWebhookEvent(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  eventId: string | null | undefined
): Promise<boolean> {
  if (!eventId) return true;
  const { error } = await supabase
    .from("webhook_events")
    .insert({ event_id: eventId });
  if (!error) return true;
  if (error.code === "23505") return false;
  // Table missing / transient DB error: fail open so deliveries keep working.
  console.error("webhook_events claim failed:", error);
  return true;
}

async function handleWebhook(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-late-signature");
  const headerEventId = request.headers.get("x-late-event-id");

  let parsed: { event?: string; id?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventId = parsed.id || headerEventId;

  if (parsed.event === "comment.received") {
    return handleCommentWebhook(parsed as CommentWebhookPayload, body, signature, eventId);
  }

  // Everything else besides message.received is acknowledged and ignored
  if (parsed.event !== "message.received") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const payload = parsed as WebhookPayload;

  const { message: msg, account } = payload;

  // Ignore outbound messages (sent by the bot itself) to prevent loops
  if (msg.direction === "outbound") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const supabase = await createServiceClient();

  // Look up channel by late_account_id
  const { data: channel } = await supabase
    .from("channels")
    .select("*")
    .eq("late_account_id", account.id)
    .eq("is_active", true)
    .single();

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  // Prevent loops: if the sender is another connected account in this
  // workspace, skip. This happens when both sides of a DM conversation
  // are connected (e.g. during testing).
  if (msg.sender.username) {
    const { data: senderChannel } = await supabase
      .from("channels")
      .select("id")
      .eq("workspace_id", channel.workspace_id)
      .eq("username", msg.sender.username)
      .eq("is_active", true)
      .maybeSingle();

    if (senderChannel) {
      return NextResponse.json({ ok: true, skipped: true, reason: "sender_is_own_account" });
    }
  }

  // Verify HMAC-SHA256 signature against the workspace-level secret
  // (falls back to the legacy per-channel secret during transition).
  const secret = await resolveWebhookSecret(supabase, channel);
  if (secret && !verifyWebhookSignature(secret, body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!(await claimWebhookEvent(supabase, eventId))) {
    return NextResponse.json({ ok: true, skipped: true, reason: "duplicate_event" });
  }

  // Ack immediately and process after the response: Zernio aborts deliveries
  // at 5s and retries, so contact upserts + flow execution (Zernio sends, AI
  // nodes) must never run before the 200 goes out.
  after(async () => {
    try {
      await processMessageEvent(supabase, payload, channel);
    } catch (err) {
      console.error("Webhook message processing error:", err);
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}

async function processMessageEvent(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  payload: WebhookPayload,
  channel: Database["public"]["Tables"]["channels"]["Row"],
) {
  const { message: msg, conversation: conv, account, metadata } = payload;

  // ── Upsert contact ───────────────────────────────────────────────────────

  const senderId = msg.sender.id;
  const senderName = msg.sender.name || msg.sender.username || senderId;

  const contact = await upsertContactForSender({
    supabase,
    channel,
    senderId,
    senderName,
    senderPicture: msg.sender.picture || null,
    senderUsername: msg.sender.username || null,
    interactionAt: new Date().toISOString(),
  });

  if (!contact) {
    console.error("Failed to create contact for webhook message");
    return;
  }

  const contactId = contact.contactId;

  if (!contact.existed) {
    // Fire-and-forget: notify outbound webhooks about the new contact
    dispatchWebhookEvent(channel.workspace_id, "contact.created", {
      contactId,
      displayName: senderName,
      platform: channel.platform,
    }).catch(() => {});
  }

  // ── Upsert conversation ──────────────────────────────────────────────────

  const preview = messagePreview(msg.text);

  const { data: conversation } = await supabase
    .from("conversations")
    .upsert(
      {
        workspace_id: channel.workspace_id,
        channel_id: channel.id,
        contact_id: contactId,
        platform: channel.platform,
        late_conversation_id: conv.id,
        status: "open",
        last_message_at: new Date().toISOString(),
        last_message_preview: preview,
        unread_count: 1,
        // Opens (or renews) Meta's 24-hour window for automated messages.
        last_inbound_at: msg.sentAt || new Date().toISOString(),
      },
      { onConflict: "channel_id,contact_id" }
    )
    .select("id, is_automation_paused")
    .single();

  if (!conversation) {
    console.error("Failed to upsert conversation for webhook message");
    return;
  }

  if (contact.existed) {
    await supabase
      .rpc("increment_unread", {
        conv_id: conversation.id,
        preview,
      })
      .then(() => {});
  }

  // ── Auto-assign new conversations (round-robin) ──────────────────────────
  // A contact's first message opens a new conversation. When the workspace has
  // round-robin auto-assignment on, hand it to the next member in rotation.
  if (!contact.existed) {
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("auto_assign_mode, last_assigned_member_index")
      .eq("id", channel.workspace_id)
      .single();

    if (workspace?.auto_assign_mode === "round-robin") {
      const { data: members } = await supabase
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", channel.workspace_id)
        .order("created_at", { ascending: true });

      if (members && members.length > 0) {
        const nextIndex =
          ((workspace.last_assigned_member_index ?? -1) + 1) % members.length;
        await supabase
          .from("conversations")
          .update({ assigned_to: members[nextIndex].user_id })
          .eq("id", conversation.id);
        await supabase
          .from("workspaces")
          .update({ last_assigned_member_index: nextIndex })
          .eq("id", channel.workspace_id);
      }
    }
  }

  // Messages are stored by Zernio (source of truth) — no local insert needed.

  // Fire-and-forget: notify outbound webhooks about the received message
  dispatchWebhookEvent(channel.workspace_id, "message.received", {
    contactId,
    conversationId: conversation.id,
    text: msg.text || null,
    platform: channel.platform,
  }).catch(() => {});

  // ── Flow engine ───────────────────────────────────────────────────────────

  if (!conversation.is_automation_paused) {
    const incomingMessage = {
      text: msg.text || undefined,
      postbackPayload: metadata?.postbackPayload || undefined,
      quickReplyPayload: metadata?.quickReplyPayload || undefined,
      callbackData: metadata?.callbackData || undefined,
      sender: {
        id: msg.sender.id,
        name: msg.sender.name,
        username: msg.sender.username || undefined,
      },
    };

    const handled = await handleGlobalKeywords(
      supabase,
      channel.workspace_id,
      contactId,
      msg.text || undefined
    );

    if (!handled) {
      // A flow paused on a "wait for reply" step must resume on ANY reply, not
      // only on one that also matches a trigger. Without this, a plain "oi"
      // matched nothing, executeFlow never ran, and the session stayed stuck.
      // executeFlow resumes the waiting session itself when one exists.
      const { data: waitingSession } = await supabase
        .from("flow_sessions")
        .select("id, flow_id")
        .eq("contact_id", contactId)
        .eq("channel_id", channel.id)
        .eq("status", "active")
        .eq("waiting_for_input", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const trigger = waitingSession
        ? null
        : await matchTrigger(supabase, {
            channelId: channel.id,
            workspaceId: channel.workspace_id,
            conversationId: conversation.id,
            message: incomingMessage,
            isFirstMessage: !contact.existed,
          });
      const target = waitingSession
        ? // Sessions do not store their trigger; the resume path never reads it.
          { id: "", flow_id: waitingSession.flow_id }
        : trigger;
      if (target) {
        try {
          await executeFlow(supabase, {
            triggerId: target.id,
            flowId: target.flow_id,
            channelId: channel.id,
            contactId,
            conversationId: conversation.id,
            workspaceId: channel.workspace_id,
            incomingMessage,
            lateConversationId: conv.id,
            lateAccountId: account.id,
          });
        } catch (err) {
          console.error("Flow execution error:", err);
        }
      }
    }
  }
}

// ── Comment webhook ─────────────────────────────────────────────────────────

async function handleCommentWebhook(
  payload: CommentWebhookPayload,
  rawBody: string,
  signature: string | null,
  eventId: string | null | undefined
) {
  const supabase = await createServiceClient();

  const { data: channel } = await supabase
    .from("channels")
    .select("*")
    .eq("late_account_id", payload.account.id)
    .eq("is_active", true)
    .single();

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  // Prevent loops: our own comments (e.g. the configured public reply) also
  // arrive as comment.received and must never re-trigger a flow.
  if (
    payload.comment.author?.username &&
    payload.comment.author.username === channel.username
  ) {
    return NextResponse.json({ ok: true, skipped: true, reason: "own_comment" });
  }

  const secret = await resolveWebhookSecret(supabase, channel);
  if (secret && !verifyWebhookSignature(secret, rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!(await claimWebhookEvent(supabase, eventId))) {
    return NextResponse.json({ ok: true, skipped: true, reason: "duplicate_event" });
  }

  // Ack before processing (same 5s delivery budget as messages); processComment
  // additionally dedupes on (channel_id, platform_comment_id) so cross-event
  // redeliveries of the same comment stay one-shot.
  after(async () => {
    try {
      await processComment({
        supabase,
        channel,
        comment: {
          id: payload.comment.id,
          // Native posts (not published through Zernio) have a null postId; fall
          // back to the platform post id so flows still run. Zernio's private-reply
          // endpoint only needs the comment id, so the placeholder is harmless.
          postId: payload.comment.postId || payload.comment.platformPostId,
          text: payload.comment.text,
          author: payload.comment.author,
          isLive: payload.comment.isLive === true,
        },
      });
    } catch (err) {
      console.error("Webhook comment processing error:", err);
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}

// ── Global keywords ─────────────────────────────────────────────────────────

// Built-in STOP keywords that always work, regardless of workspace configuration.
// These are a compliance requirement: users must always be able to opt out of
// messaging by sending any of these common unsubscribe phrases.
const STOP_KEYWORDS = [
  "stop", "unsubscribe", "cancel", "quit", "optout", "opt-out",
  // Portuguese
  "parar", "pare", "sair", "cancelar", "descadastrar",
  // Spanish
  "baja", "detener", "darme de baja",
];

// Built-in START keywords that always work. These allow users who previously
// opted out to re-subscribe by sending a common opt-in phrase.
const START_KEYWORDS = [
  "start", "subscribe", "optin", "opt-in",
  // Portuguese
  "voltar", "iniciar", "assinar",
  // Spanish
  "alta", "empezar", "suscribir",
];

async function handleGlobalKeywords(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  workspaceId: string,
  contactId: string,
  text: string | undefined
): Promise<boolean> {
  if (!text) return false;

  const normalizedText = text.toLowerCase().trim();

  // Check built-in keywords first (always active, can't be disabled).
  // This ensures compliance-critical opt-out keywords work even if the
  // workspace hasn't configured any global keywords.
  if (STOP_KEYWORDS.includes(normalizedText)) {
    await supabase
      .from("contacts")
      .update({ is_subscribed: false })
      .eq("id", contactId);
    return true;
  }

  if (START_KEYWORDS.includes(normalizedText)) {
    await supabase
      .from("contacts")
      .update({ is_subscribed: true })
      .eq("id", contactId);
    return true;
  }

  // Then check workspace-configured keywords (custom keywords set by the user)
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("global_keywords")
    .eq("id", workspaceId)
    .single();

  if (!workspace?.global_keywords) return false;

  const keywords = workspace.global_keywords as Array<{
    keyword: string;
    action?: string;
    flowId?: string;
  }>;

  for (const kw of keywords) {
    if (normalizedText === kw.keyword.toLowerCase()) {
      if (kw.action === "unsubscribe") {
        await supabase
          .from("contacts")
          .update({ is_subscribed: false })
          .eq("id", contactId);
        return true;
      }
      if (kw.action === "subscribe") {
        await supabase
          .from("contacts")
          .update({ is_subscribed: true })
          .eq("id", contactId);
        return true;
      }
      return false;
    }
  }

  return false;
}
