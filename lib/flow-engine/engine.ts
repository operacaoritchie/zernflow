import type { SupabaseClient } from "@supabase/supabase-js";
import { isPhone } from "./phone";
import { validateFieldValue } from "@/lib/field-validation";
import { insideMessagingWindow } from "@/lib/messaging-window";
import type { Database, Json } from "@/lib/types/database";
import type {
  FlowNode,
  FlowEdge,
  FlowExecutionContext,
  SendMessageNodeData,
  ConditionNodeData,
  SmartDelayNodeData,
  DelayNodeData,
  TagNodeData,
  SetFieldNodeData,
  HttpRequestNodeData,
  GoToFlowNodeData,
  ABSplitNodeData,
  CommentReplyNodeData,
  PrivateReplyNodeData,
  AiResponseNodeData,
  EnrollSequenceNodeData,
  SendWhatsAppTemplateNodeData,
} from "./types";
import { executeAiResponse } from "./nodes/ai-response";
import { adaptMessage } from "./platform-adapter";
import { createZernioClient } from "@/lib/zernio-client";
import { requestPublicUrl } from "./request-public-url";
import { normalizeWhatsAppPhone, sendTemplate } from "@/lib/whatsapp-templates";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher";
import { toEngineNodes } from "./normalize-nodes";

export async function executeFlow(
  supabase: SupabaseClient<Database>,
  context: FlowExecutionContext
) {
  // Ensure variables always exists so nodes (aiResponse, httpRequest) can write
  // outputs even when the trigger passed none (e.g. DM-triggered flows).
  context.variables ??= {};

  // Seed {{message}} from the incoming message text so the variable offered in
  // the builder resolves in production, not just in the simulator (which seeds
  // it itself). Guarded so cron resumes with an empty incomingMessage don't
  // clobber a previously stored value.
  if (context.incomingMessage.text) {
    context.variables.message ??= context.incomingMessage.text;
  }

  // Check for active session waiting for input
  const { data: activeSession } = await supabase
    .from("flow_sessions")
    .select("*")
    .eq("contact_id", context.contactId)
    .eq("channel_id", context.channelId)
    .eq("status", "active")
    .eq("waiting_for_input", true)
    .single();

  if (activeSession) {
    return resumeSession(supabase, activeSession, context);
  }

  // Load flow
  const { data: flow } = await supabase
    .from("flows")
    .select("*")
    .eq("id", context.flowId)
    .eq("status", "published")
    .single();

  if (!flow) return;

  const nodes = toEngineNodes(flow.nodes as unknown as FlowNode[]);
  const edges = flow.edges as unknown as FlowEdge[];

  // Get channel platform and late_account_id
  const { data: channel } = await supabase
    .from("channels")
    .select("platform, late_account_id")
    .eq("id", context.channelId)
    .single();

  context.platform = channel?.platform as FlowExecutionContext["platform"];
  if (channel?.late_account_id && !context.lateAccountId) {
    context.lateAccountId = channel.late_account_id;
  }

  // Resolve late_conversation_id from the conversation record if not already set
  if (!context.lateConversationId && context.conversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("late_conversation_id")
      .eq("id", context.conversationId)
      .single();

    if (conversation?.late_conversation_id) {
      context.lateConversationId = conversation.late_conversation_id;
    }
  }

  // Load bot fields for {{bot.field_slug}} interpolation.
  // We fetch all bot fields for this workspace and inject them into context.variables
  // with a "bot." prefix so the existing synchronous interpolateVariables function
  // can resolve them without needing async DB calls.
  const { data: botFields } = await supabase
    .from("bot_fields")
    .select("slug, value")
    .eq("workspace_id", context.workspaceId);

  if (botFields) {
    if (!context.variables) context.variables = {};
    for (const bf of botFields) {
      context.variables[`bot.${bf.slug}`] = bf.value;
    }
  }

  // Create session
  const { data: session } = await supabase
    .from("flow_sessions")
    .insert({
      contact_id: context.contactId,
      flow_id: context.flowId,
      channel_id: context.channelId,
      status: "active",
      variables: context.variables || {},
    })
    .select("id")
    .single();

  if (!session) return;

  // Track flow_started
  await supabase.from("analytics_events").insert({
    workspace_id: context.workspaceId,
    flow_id: context.flowId,
    contact_id: context.contactId,
    event_type: "flow_started",
    metadata: { triggerId: context.triggerId },
  });

  // Fire-and-forget: notify outbound webhooks about the flow start
  dispatchWebhookEvent(context.workspaceId, "flow.started", {
    flowId: context.flowId,
    contactId: context.contactId,
    channelId: context.channelId,
    triggerId: context.triggerId,
  }).catch(() => {});

  // Find the trigger node (entry point)
  const triggerNode = nodes.find((n) => n.type === "trigger");
  if (!triggerNode) return;

  // Get the first connected node
  const firstEdge = edges.find((e) => e.source === triggerNode.id);
  if (!firstEdge) return;

  const startNode = nodes.find((n) => n.id === firstEdge.target);
  if (!startNode) return;

  await traverseNodes(supabase, session.id, startNode, nodes, edges, context, 0);
}

const MAX_TRAVERSAL_DEPTH = 50;

// Thrown before resumeSession advances current_node_id, so callers may retry
// without cancelling the session.
export class FlowLoadError extends Error {}

/** Output handles that only fire on a specific outcome. The plain output of a
 *  node is any edge that does not use one of these. */
const OUTCOME_HANDLES = new Set(["invalid", "timeout"]);

function defaultEdge(edges: FlowEdge[], nodeId: string): FlowEdge | undefined {
  return edges.find(
    (e) => e.source === nodeId && !(e.sourceHandle && OUTCOME_HANDLES.has(e.sourceHandle))
  );
}


export async function resumeSession(
  supabase: SupabaseClient<Database>,
  session: Database["public"]["Tables"]["flow_sessions"]["Row"],
  context: FlowExecutionContext,
  opts: { handle?: string } = {}
) {
  const { data: flow, error: flowError } = await supabase
    .from("flows")
    .select("*")
    .eq("id", session.flow_id)
    .single();

  if (!flow) {
    // postgrest-js swallows transient failures into { data: null, error }, it
    // does not throw. Only PGRST116 (zero rows) means the flow row is genuinely
    // gone; anything else is a transient DB/network blip, so throw and let the
    // caller recover (cron retry with backoff, or the contact's next message on
    // the webhook path) instead of permanently cancelling the session.
    if (flowError && flowError.code !== "PGRST116") {
      throw new FlowLoadError(
        `flow ${session.flow_id} could not be loaded: ${flowError.message}`
      );
    }
    await cancelUnresumableSession(
      supabase,
      session.id,
      `flow ${session.flow_id} no longer exists`
    );
    return;
  }

  const nodes = toEngineNodes(flow.nodes as unknown as FlowNode[]);
  const edges = flow.edges as unknown as FlowEdge[];

  const { data: channel } = await supabase
    .from("channels")
    .select("platform, late_account_id")
    .eq("id", context.channelId)
    .single();

  context.platform = channel?.platform as FlowExecutionContext["platform"];
  if (channel?.late_account_id && !context.lateAccountId) {
    context.lateAccountId = channel.late_account_id;
  }

  // Resolve late_conversation_id if not set
  if (!context.lateConversationId && context.conversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("late_conversation_id")
      .eq("id", context.conversationId)
      .single();

    if (conversation?.late_conversation_id) {
      context.lateConversationId = conversation.late_conversation_id;
    }
  }

  context.variables = (session.variables as Record<string, string>) || {};

  // The resume is driven by a fresh reply; make {{message}} reflect it.
  if (context.incomingMessage.text) {
    context.variables.message = context.incomingMessage.text;
  }

  // Load bot fields for {{bot.field_slug}} interpolation (same as in executeFlow).
  // We re-fetch here so resumed sessions pick up any bot field value changes
  // that occurred while the session was paused.
  const { data: botFields } = await supabase
    .from("bot_fields")
    .select("slug, value")
    .eq("workspace_id", context.workspaceId);

  if (botFields) {
    for (const bf of botFields) {
      context.variables[`bot.${bf.slug}`] = bf.value;
    }
  }

  // Update session
  await supabase
    .from("flow_sessions")
    .update({ waiting_for_input: false, waiting_until: null })
    .eq("id", session.id);

  // Continue from current node
  const currentNode = nodes.find((n) => n.id === session.current_node_id);
  if (!currentNode) {
    // The flow was edited and the paused-on node removed; the session can
    // never advance, so settle it instead of leaving it active forever.
    await cancelUnresumableSession(
      supabase,
      session.id,
      `node ${session.current_node_id} no longer exists in flow ${session.flow_id}`
    );
    return;
  }

  // Get next node after the current one. A timed-out wait follows its
  // "timeout" output instead of the normal one.
  const nextEdge = opts.handle
    ? edges.find((e) => e.source === currentNode.id && e.sourceHandle === opts.handle)
    : defaultEdge(edges, currentNode.id);
  if (!nextEdge) {
    await completeSession(supabase, session.id);
    return;
  }

  const nextNode = nodes.find((n) => n.id === nextEdge.target);
  if (!nextNode) {
    await completeSession(supabase, session.id);
    return;
  }

  await traverseNodes(supabase, session.id, nextNode, nodes, edges, context, 0);
}

async function cancelUnresumableSession(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  reason: string
) {
  console.error(`Cancelling flow session ${sessionId}: ${reason}`);
  const { error } = await supabase
    .from("flow_sessions")
    .update({ status: "cancelled" })
    .eq("id", sessionId);
  if (error) {
    // postgrest swallows network failures into { error }, so an unchecked
    // cancel can silently no-op and strand the session as active forever.
    // current_node_id has not advanced, so FlowLoadError lets callers retry
    // and re-attempt the cancel.
    throw new FlowLoadError(
      `session ${sessionId} could not be cancelled (${reason}): ${error.message}`
    );
  }
}

async function traverseNodes(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  node: FlowNode,
  nodes: FlowNode[],
  edges: FlowEdge[],
  context: FlowExecutionContext,
  depth: number = 0
) {
  if (depth >= MAX_TRAVERSAL_DEPTH) {
    console.error(`Flow traversal exceeded max depth (${MAX_TRAVERSAL_DEPTH}), stopping. Flow: ${context.flowId}`);
    await completeSession(supabase, sessionId);
    return;
  }
  // Update current node
  await supabase
    .from("flow_sessions")
    .update({ current_node_id: node.id })
    .eq("id", sessionId);

  // Track analytics
  await supabase.from("analytics_events").insert({
    workspace_id: context.workspaceId,
    flow_id: context.flowId,
    contact_id: context.contactId,
    event_type: "node_executed",
    metadata: { nodeId: node.id, nodeType: node.type },
  });

  // Execute the node
  const result = await executeNode(supabase, node, context, sessionId);
  const effectiveType = resolveNodeType(node);

  // Persist variables written by output-producing nodes so they survive
  // pauses (resumeSession reloads them from the session row).
  if (
    effectiveType === "aiResponse" ||
    effectiveType === "httpRequest" ||
    effectiveType === "sendWhatsAppTemplate"
  ) {
    await supabase
      .from("flow_sessions")
      .update({ variables: (context.variables ?? {}) as Json })
      .eq("id", sessionId);
  }

  // If the node pauses execution (delay, wait for input, human takeover), stop
  if (result === "pause") return;

  // Find next node(s)
  let nextEdge: FlowEdge | undefined;

  if (result && typeof result === "string" && result.startsWith("handle:")) {
    // Condition/split nodes specify which handle to follow
    const handle = result.replace("handle:", "");
    nextEdge = edges.find(
      (e) => e.source === node.id && e.sourceHandle === handle
    );
  } else {
    nextEdge = defaultEdge(edges, node.id);
  }

  if (!nextEdge) {
    await completeSession(supabase, sessionId);
    return;
  }

  const nextNode = nodes.find((n) => n.id === nextEdge!.target);
  if (!nextNode) {
    await completeSession(supabase, sessionId);
    return;
  }

  // Continue to next node
  await traverseNodes(supabase, sessionId, nextNode, nodes, edges, context, depth + 1);
}

/**
 * Action nodes made in the flow builder are stored as `type: "action"` with the
 * real action in `data.actionType`; flows written straight to the database use
 * the action as the type. Both run the same way.
 */
function resolveNodeType(node: FlowNode): string {
  if ((node.type as string) === "action") {
    const actionType = (node.data as { actionType?: unknown } | undefined)?.actionType;
    return typeof actionType === "string" && actionType ? actionType : "action";
  }
  return node.type;
}

async function executeNode(
  supabase: SupabaseClient<Database>,
  node: FlowNode,
  context: FlowExecutionContext,
  sessionId: string
): Promise<string | void> {
  const type = resolveNodeType(node);
  switch (type) {
    case "sendMessage":
      return executeSendMessage(supabase, node.data as SendMessageNodeData, context);
    case "condition":
      return executeCondition(supabase, node.data as ConditionNodeData, context);
    case "delay":
      return executeDelay(supabase, node.data as DelayNodeData, sessionId, node.id, context);
    case "addTag":
    case "removeTag": {
      // Builder nodes carry only actionType; derive add/remove from it.
      const tagData = node.data as Partial<TagNodeData>;
      return executeTag(
        supabase,
        { ...tagData, action: tagData.action ?? (type === "addTag" ? "add" : "remove") } as TagNodeData,
        context
      );
    }
    case "setCustomField":
      return executeSetField(supabase, node.data as SetFieldNodeData, context);
    case "httpRequest":
      return executeHttpRequest(node.data as HttpRequestNodeData, context);
    case "goToFlow":
      return executeGoToFlow(supabase, node.data as GoToFlowNodeData, context, sessionId);
    case "humanTakeover":
      return executeHumanTakeover(supabase, context, sessionId);
    case "subscribe":
    case "unsubscribe":
      return executeSubscription(supabase, type as "subscribe" | "unsubscribe", context);
    case "commentReply":
      return executeCommentReply(supabase, node.data as CommentReplyNodeData, context);
    case "privateReply":
      return executePrivateReply(supabase, node.data as PrivateReplyNodeData, context);
    case "aiResponse":
      return executeAiResponse(supabase, node.data as AiResponseNodeData, context, sessionId);
    case "abSplit":
      return executeABSplit(node.data as ABSplitNodeData);
    case "smartDelay":
      return executeSmartDelay(supabase, node.data as SmartDelayNodeData, sessionId, node.id, context);
    case "enrollSequence":
      return executeEnrollSequence(supabase, node.data as EnrollSequenceNodeData, context);
    case "sendWhatsAppTemplate":
      return executeSendWhatsAppTemplate(supabase, node.data as SendWhatsAppTemplateNodeData, context);
    default:
      return;
  }
}

async function sendFirstMessageAsPrivateReply(
  supabase: SupabaseClient<Database>,
  zernio: ReturnType<typeof createZernioClient>,
  data: SendMessageNodeData,
  context: FlowExecutionContext,
  lateAccountId: string
) {
  const first = data.messages[0];
  if (!first) return;

  const text = interpolateVariables(
    adaptMessage(first, context.platform ?? "instagram").text,
    context.variables || {}
  );

  try {
    await zernio.comments.sendPrivateReplyToComment({
      path: {
        postId: String(context.variables!.post_id),
        commentId: String(context.variables!.comment_id),
      },
      body: { accountId: lateAccountId, message: text },
    });

    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text,
      sent_by_flow_id: context.flowId,
      status: "sent",
    });

    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "message_sent",
    });
  } catch (error) {
    console.error("Failed to send comment-context message as private reply:", error);
    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text,
      sent_by_flow_id: context.flowId,
      status: "failed",
    });
    return;
  }

  if (data.messages.length > 1) {
    console.warn(
      "Comment flow Send Message node had multiple messages; only the first was sent (one private reply per comment)."
    );
  }
}

async function executeSendMessage(
  supabase: SupabaseClient<Database>,
  data: SendMessageNodeData,
  context: FlowExecutionContext
) {
  // Get workspace for API key
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", context.workspaceId)
    .single();

  if (!workspace?.late_api_key_encrypted) return;

  const zernio = createZernioClient(workspace.late_api_key_encrypted);

  // Resolve late_account_id from channel if not in context
  let lateAccountId = context.lateAccountId;
  if (!lateAccountId) {
    const { data: channel } = await supabase
      .from("channels")
      .select("late_account_id, platform")
      .eq("id", context.channelId)
      .single();

    if (!channel) return;
    lateAccountId = channel.late_account_id;
    if (!context.platform) {
      context.platform = channel.platform as FlowExecutionContext["platform"];
    }
  }

  // Resolve late_conversation_id from conversation if not in context
  let lateConversationId = context.lateConversationId;
  if (!lateConversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("late_conversation_id")
      .eq("id", context.conversationId)
      .single();

    if (!conversation?.late_conversation_id) {
      // Comment-triggered flows have no DM conversation yet. Instagram allows
      // exactly one private reply per comment, so deliver the first message via
      // the private-reply endpoint instead of silently dropping the whole node
      // (users build comment flows with plain Send Message nodes, not Private Reply).
      if (context.variables?.comment_id && context.variables?.post_id && lateAccountId) {
        await sendFirstMessageAsPrivateReply(supabase, zernio, data, context, lateAccountId);
        return;
      }
      console.error("No late_conversation_id found for conversation:", context.conversationId);
      return;
    }
    lateConversationId = conversation.late_conversation_id;
  }

  // Meta only allows automated messages within 24 hours of the contact's last
  // message. Outside it the send would be refused; record why instead.
  const { data: windowRow } = await supabase
    .from("conversations")
    .select("last_inbound_at, platform")
    .eq("id", context.conversationId)
    .maybeSingle();
  if (!insideMessagingWindow(context.platform || windowRow?.platform, windowRow?.last_inbound_at)) {
    console.warn(
      `Skipped Send Message for conversation ${context.conversationId}: outside the 24-hour messaging window`
    );
    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "message_blocked_window",
      metadata: { lastInboundAt: windowRow?.last_inbound_at ?? null } as unknown as Json,
    });
    return;
  }

  for (const msg of data.messages) {
    const adapted = adaptMessage(msg, context.platform!);
    const text = interpolateVariables(adapted.text, context.variables || {});

    try {
      // Media (image/video/audio) is platform-agnostic, so read it from the raw
      // message. `mediaUrl` + `mediaType` supersede the legacy image-only `imageUrl`.
      const rawMsg = msg as { mediaUrl?: string; mediaType?: string; imageUrl?: string };
      const mediaUrl = rawMsg.mediaUrl || rawMsg.imageUrl;
      const mediaType = rawMsg.mediaType || (rawMsg.imageUrl ? "image" : undefined);

      const attachments = mediaUrl
        ? [{ type: mediaType || "image", url: mediaUrl }]
        : undefined;

      // Build the API body with rich messaging fields
      const body: Record<string, unknown> = {
        accountId: lateAccountId,
        message: text,
      };
      // Actually send the media to the recipient. Previously the attachment was only
      // stored locally and never included in the send body, so flow media never
      // reached the contact.
      if (mediaUrl) {
        body.attachmentUrl = mediaUrl;
        body.attachmentType = mediaType || "image";
      }

      if (adapted.buttons?.length) {
        body.buttons = adapted.buttons;
      }
      if (adapted.quickReplies?.length) {
        body.quickReplies = adapted.quickReplies;
      }
      if (adapted.template) {
        body.template = adapted.template;
      }
      if (adapted.replyMarkup) {
        body.replyMarkup = adapted.replyMarkup;
      }

      const response = await zernio.messages.sendInboxMessage({
        path: { conversationId: lateConversationId },
        body: body as Parameters<typeof zernio.messages.sendInboxMessage>[0]["body"],
      });

      // Store outbound message
      await supabase.from("messages").insert({
        conversation_id: context.conversationId,
        direction: "outbound",
        text,
        attachments: attachments || null,
        sent_by_flow_id: context.flowId,
        sent_by_node_id: null,
        platform_message_id: response.data?.data?.messageId || null,
        status: "sent",
      });

      await supabase.from("analytics_events").insert({
        workspace_id: context.workspaceId,
        flow_id: context.flowId,
        contact_id: context.contactId,
        event_type: "message_sent",
      });

      // Fire-and-forget: notify outbound webhooks about the sent message
      dispatchWebhookEvent(context.workspaceId, "message.sent", {
        contactId: context.contactId,
        conversationId: context.conversationId,
        text,
        flowId: context.flowId,
      }).catch(() => {});
    } catch (error) {
      console.error("Failed to send message:", error);
      await supabase.from("messages").insert({
        conversation_id: context.conversationId,
        direction: "outbound",
        text,
        sent_by_flow_id: context.flowId,
        status: "failed",
      });

      await supabase.from("analytics_events").insert({
        workspace_id: context.workspaceId,
        flow_id: context.flowId,
        contact_id: context.contactId,
        event_type: "message_failed",
        metadata: { error: error instanceof Error ? error.message : "Unknown error" },
      });
    }

    // Small delay between messages
    if (data.messages.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function executeCondition(
  supabase: SupabaseClient<Database>,
  data: ConditionNodeData,
  context: FlowExecutionContext
): Promise<string> {
  const { data: contact } = await supabase
    .from("contacts")
    .select("*, contact_tags(tag_id, tags(name)), contact_custom_fields(field_id, value, custom_field_definitions(slug))")
    .eq("id", context.contactId)
    .single();

  if (!contact) return "handle:false";

  const results = data.conditions.map((condition) => {
    let fieldValue: string | undefined;

    // Check built-in fields
    if (condition.field === "platform") {
      fieldValue = context.platform;
    } else if (condition.field === "is_subscribed") {
      fieldValue = String(contact.is_subscribed);
    } else if (condition.field.startsWith("tag:")) {
      const tagName = condition.field.replace("tag:", "");
      const hasTags = Array.isArray(contact.contact_tags);
      const hasTag = hasTags && (contact.contact_tags as Array<{ tags: { name: string } | null }>).some(
        (ct) => ct.tags?.name === tagName
      );
      fieldValue = String(hasTag);
    } else if (condition.field.startsWith("variable:")) {
      const varName = condition.field.replace("variable:", "");
      fieldValue = context.variables?.[varName];
    } else {
      // Check custom fields
      const customFields = contact.contact_custom_fields as Array<{
        value: string;
        custom_field_definitions: { slug: string } | null;
      }> | null;
      const field = customFields?.find(
        (f) => f.custom_field_definitions?.slug === condition.field
      );
      fieldValue = field?.value;
    }

    return evaluateCondition(fieldValue, condition.operator, condition.value);
  });

  const passed =
    data.logic === "and" ? results.every(Boolean) : results.some(Boolean);

  return passed ? "handle:true" : "handle:false";
}

function evaluateCondition(
  actual: string | undefined,
  operator: string,
  expected: string
): boolean {
  switch (operator) {
    case "equals":
      return actual === expected;
    case "not_equals":
      return actual !== expected;
    case "contains":
      return actual?.includes(expected) || false;
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "gt":
      return Number(actual) > Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "is_phone":
      return isPhone(actual);
    default:
      return false;
  }
}

async function executeDelay(
  supabase: SupabaseClient<Database>,
  data: DelayNodeData,
  sessionId: string,
  nodeId: string,
  context: FlowExecutionContext
) {
  const multipliers: Record<string, number> = {
    seconds: 1000,
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
  };

  const delayMs = data.duration * (multipliers[data.unit] || 1000);
  const runAt = new Date(Date.now() + delayMs).toISOString();

  // Schedule a job to resume the flow
  await supabase.from("scheduled_jobs").insert({
    type: "resume_flow",
    payload: {
      sessionId,
      nodeId,
      flowId: context.flowId,
      channelId: context.channelId,
      contactId: context.contactId,
      conversationId: context.conversationId,
      workspaceId: context.workspaceId,
      lateConversationId: context.lateConversationId || null,
      lateAccountId: context.lateAccountId || null,
      variables: context.variables || {},
    },
    run_at: runAt,
  });

  // Update session to waiting
  await supabase
    .from("flow_sessions")
    .update({
      waiting_until: runAt,
      current_node_id: nodeId,
    })
    .eq("id", sessionId);

  return "pause";
}

async function executeTag(
  supabase: SupabaseClient<Database>,
  data: TagNodeData,
  context: FlowExecutionContext
) {
  // Find or create tag
  const { data: tag } = await supabase
    .from("tags")
    .upsert(
      { workspace_id: context.workspaceId, name: data.tagName },
      { onConflict: "workspace_id,name" }
    )
    .select("id")
    .single();

  if (!tag) return;

  if (data.action === "add") {
    await supabase
      .from("contact_tags")
      .upsert({ contact_id: context.contactId, tag_id: tag.id })
      .select();

    // Fire-and-forget: notify outbound webhooks about the tag addition
    dispatchWebhookEvent(context.workspaceId, "tag.added", {
      contactId: context.contactId,
      tagId: tag.id,
      tagName: data.tagName,
    }).catch(() => {});
  } else {
    await supabase
      .from("contact_tags")
      .delete()
      .eq("contact_id", context.contactId)
      .eq("tag_id", tag.id);

    // Fire-and-forget: notify outbound webhooks about the tag removal
    dispatchWebhookEvent(context.workspaceId, "tag.removed", {
      contactId: context.contactId,
      tagId: tag.id,
      tagName: data.tagName,
    }).catch(() => {});
  }
}

async function executeSetField(
  supabase: SupabaseClient<Database>,
  data: SetFieldNodeData,
  context: FlowExecutionContext
) {
  // Find field definition
  const { data: fieldDef } = await supabase
    .from("custom_field_definitions")
    .select("id, type")
    .eq("workspace_id", context.workspaceId)
    .eq("slug", data.fieldSlug)
    .single();

  if (!fieldDef) return;

  const raw = interpolateVariables(data.value, context.variables || {});

  // Phone, CPF, e-mail, number and URL fields only take a value of their
  // type. An invalid one is not saved and the flow follows the node's
  // "invalid" output (or stops there if nothing is connected to it).
  const checked = validateFieldValue(fieldDef.type, raw);
  if (!checked.ok) {
    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "field_invalid",
      metadata: { fieldSlug: data.fieldSlug, fieldType: fieldDef.type, reason: checked.reason } as unknown as Json,
    });
    return "handle:invalid";
  }

  await supabase.from("contact_custom_fields").upsert(
    {
      contact_id: context.contactId,
      field_id: fieldDef.id,
      value: checked.value,
    },
    { onConflict: "contact_id,field_id" }
  );

  // Later nodes in the same run can use the saved value as {{<field slug>}}.
  context.variables = { ...(context.variables ?? {}), [data.fieldSlug]: checked.value };
}

async function executeSmartDelay(
  supabase: SupabaseClient<Database>,
  data: SmartDelayNodeData,
  sessionId: string,
  nodeId: string,
  context: FlowExecutionContext
) {
  // Wait for the contact's next message
  await supabase
    .from("flow_sessions")
    .update({ waiting_for_input: true, current_node_id: nodeId })
    .eq("id", sessionId);

  // With a timeout set, a job fires it: if the contact still has not replied,
  // the flow follows the node's "timeout" output (or ends).
  const timeout = Number(data.timeout);
  if (Number.isFinite(timeout) && timeout > 0) {
    const unitMs: Record<string, number> = {
      seconds: 1000,
      minutes: 60 * 1000,
      hours: 60 * 60 * 1000,
      days: 24 * 60 * 60 * 1000,
    };
    const runAt = new Date(
      Date.now() + timeout * (unitMs[data.timeoutUnit || "minutes"] || unitMs.minutes)
    ).toISOString();
    await supabase.from("scheduled_jobs").insert({
      type: "smart_delay_timeout",
      payload: {
        sessionId,
        nodeId,
        channelId: context.channelId,
        contactId: context.contactId,
        conversationId: context.conversationId,
        workspaceId: context.workspaceId,
        lateConversationId: context.lateConversationId || null,
        lateAccountId: context.lateAccountId || null,
      },
      run_at: runAt,
    });
  }

  return "pause";
}

async function executeHttpRequest(
  data: HttpRequestNodeData,
  context: FlowExecutionContext
) {
  try {
    const url = interpolateVariables(data.url, context.variables || {});
    const body = data.body
      ? interpolateVariables(data.body, context.variables || {})
      : undefined;

    const responseData = await requestPublicUrl({
      method: data.method,
      url,
      headers: {
        "Content-Type": "application/json",
        ...data.headers,
      },
      body: data.method !== "GET" ? body : undefined,
    });

    // Store response in variable if configured
    if (data.responseVariable && context.variables) {
      try {
        context.variables[data.responseVariable] = JSON.parse(responseData);
      } catch {
        context.variables[data.responseVariable] = responseData;
      }
    }
  } catch (error) {
    console.error("HTTP request failed:", error);
  }
}

async function executeGoToFlow(
  supabase: SupabaseClient<Database>,
  data: GoToFlowNodeData,
  context: FlowExecutionContext,
  _sessionId: string
) {
  // Execute the target flow
  await executeFlow(supabase, {
    ...context,
    flowId: data.flowId,
  });
  // If returnAfter is true, the current flow will continue after the target flow completes
  // For now, we just stop the current traversal
  return "pause";
}

async function executeHumanTakeover(
  supabase: SupabaseClient<Database>,
  context: FlowExecutionContext,
  sessionId: string
) {
  // Pause automation on the conversation
  await supabase
    .from("conversations")
    .update({ is_automation_paused: true })
    .eq("id", context.conversationId);

  // Mark session
  await supabase
    .from("flow_sessions")
    .update({
      human_takeover_at: new Date().toISOString(),
      status: "completed",
    })
    .eq("id", sessionId);

  return "pause";
}

async function executeSubscription(
  supabase: SupabaseClient<Database>,
  action: string,
  context: FlowExecutionContext
) {
  await supabase
    .from("contacts")
    .update({ is_subscribed: action === "subscribe" })
    .eq("id", context.contactId);
}

function executeABSplit(data: ABSplitNodeData): string {
  const totalWeight = data.paths.reduce((sum, p) => sum + p.weight, 0);
  const random = Math.random() * totalWeight;

  let cumulative = 0;
  for (let i = 0; i < data.paths.length; i++) {
    cumulative += data.paths[i].weight;
    if (random <= cumulative) {
      return `handle:${data.paths[i].name}`;
    }
  }

  return `handle:${data.paths[0].name}`;
}

/**
 * Post a public reply to the comment that triggered this flow.
 * Uses the comment_id and post_id variables set by the comment processor.
 */
async function executeCommentReply(
  supabase: SupabaseClient<Database>,
  data: CommentReplyNodeData,
  context: FlowExecutionContext
) {
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", context.workspaceId)
    .single();

  if (!workspace?.late_api_key_encrypted) return;

  const zernio = createZernioClient(workspace.late_api_key_encrypted);

  // Resolve late_account_id
  let lateAccountId = context.lateAccountId;
  if (!lateAccountId) {
    const { data: channel } = await supabase
      .from("channels")
      .select("late_account_id")
      .eq("id", context.channelId)
      .single();

    if (!channel) return;
    lateAccountId = channel.late_account_id;
  }

  const commentId = context.variables?.comment_id || context.incomingMessage.sender?.id;
  if (!commentId) return;

  const postId = context.variables?.post_id;
  if (!postId) {
    console.error("No post_id in context variables for commentReply node");
    return;
  }

  const text = interpolateVariables(data.text, context.variables || {});

  try {
    await zernio.comments.replyToInboxPost({
      path: { postId },
      body: { accountId: lateAccountId, message: text, commentId },
    });
  } catch (error) {
    console.error("Failed to post comment reply:", error);
  }
}

/**
 * Send a private DM to the commenter via the Zernio API's private reply endpoint.
 * This creates a DM conversation from a comment context.
 */
async function executePrivateReply(
  supabase: SupabaseClient<Database>,
  data: PrivateReplyNodeData,
  context: FlowExecutionContext
) {
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", context.workspaceId)
    .single();

  if (!workspace?.late_api_key_encrypted) return;

  const zernio = createZernioClient(workspace.late_api_key_encrypted);

  // Resolve late_account_id
  let lateAccountId = context.lateAccountId;
  if (!lateAccountId) {
    const { data: channel } = await supabase
      .from("channels")
      .select("late_account_id")
      .eq("id", context.channelId)
      .single();

    if (!channel) return;
    lateAccountId = channel.late_account_id;
  }

  const commentId = context.variables?.comment_id || context.incomingMessage.sender?.id;
  if (!commentId) return;

  const postId = context.variables?.post_id;
  if (!postId) {
    console.error("No post_id in context variables for privateReply node");
    return;
  }

  const text = interpolateVariables(data.text, context.variables || {});

  try {
    await zernio.comments.sendPrivateReplyToComment({
      path: { postId, commentId },
      body: { accountId: lateAccountId, message: text },
    });

    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text,
      attachments: data.imageUrl
        ? [{ type: "image", url: data.imageUrl }]
        : null,
      sent_by_flow_id: context.flowId,
      status: "sent",
    });
  } catch (error) {
    console.error("Failed to send private reply:", error);
    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text,
      sent_by_flow_id: context.flowId,
      status: "failed",
    });
  }
}

async function completeSession(
  supabase: SupabaseClient<Database>,
  sessionId: string
) {
  // Only an active session can complete: a concurrent cancel (e.g. the cron's
  // stranded-session settle) must not be overwritten to completed. Zero rows
  // matched also skips the flow_completed analytics event below.
  const { data: session } = await supabase
    .from("flow_sessions")
    .update({ status: "completed" })
    .eq("id", sessionId)
    .eq("status", "active")
    .select("flow_id, contact_id, channel_id")
    .single();

  if (session) {
    const { data: flow } = await supabase
      .from("flows")
      .select("workspace_id")
      .eq("id", session.flow_id)
      .single();

    if (flow) {
      await supabase.from("analytics_events").insert({
        workspace_id: flow.workspace_id,
        flow_id: session.flow_id,
        contact_id: session.contact_id,
        event_type: "flow_completed",
      });

      // Fire-and-forget: notify outbound webhooks about the flow completion
      dispatchWebhookEvent(flow.workspace_id, "flow.completed", {
        flowId: session.flow_id,
        contactId: session.contact_id,
        channelId: session.channel_id,
      }).catch(() => {});
    }
  }
}

async function executeEnrollSequence(
  supabase: SupabaseClient<Database>,
  data: EnrollSequenceNodeData,
  context: FlowExecutionContext
) {
  if (!data.sequenceId) {
    console.error("enrollSequence node missing sequenceId");
    return;
  }

  // Verify sequence exists and is active
  const { data: sequence } = await supabase
    .from("sequences")
    .select("id, steps, status")
    .eq("id", data.sequenceId)
    .single();

  if (!sequence || sequence.status !== "active") {
    console.error("Sequence not found or not active:", data.sequenceId);
    return;
  }

  const steps = (sequence.steps as Array<{ type: string; delayMinutes?: number }>) || [];
  if (steps.length === 0) return;

  // Calculate next_step_at based on first step
  let nextStepAt: string;
  const firstStep = steps[0];
  if (firstStep.type === "delay" && firstStep.delayMinutes) {
    nextStepAt = new Date(
      Date.now() + firstStep.delayMinutes * 60 * 1000
    ).toISOString();
  } else {
    nextStepAt = new Date().toISOString();
  }

  // Create enrollment (ignore duplicate errors)
  const { error } = await supabase
    .from("sequence_enrollments")
    .insert({
      sequence_id: data.sequenceId,
      contact_id: context.contactId,
      channel_id: context.channelId,
      next_step_at: nextStepAt,
    });

  if (error && error.code !== "23505") {
    console.error("Failed to enroll contact in sequence:", error);
  }
}

function resolveVariablePath(
  variables: Record<string, unknown>,
  path: string
): unknown {
  // Flat keys win, so workspace bot fields stored as "bot.<slug>" resolve
  // before the dot path is walked into nested objects.
  if (path in variables) return variables[path];
  let value: unknown = variables;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/**
 * Send an approved WhatsApp template from one of the workspace's WhatsApp
 * numbers to a phone stored on the contact (e.g. {{telefone_vaga}}). This is
 * what lets a flow that started on Instagram reach the lead on WhatsApp: Meta
 * only accepts a business-initiated WhatsApp message as an approved template.
 *
 * Never stops the flow. The outcome lands in {{whatsapp_template_status}}
 * ("sent" | "failed" | "invalid_phone") so a Condition node can branch on it.
 */
async function executeSendWhatsAppTemplate(
  supabase: SupabaseClient<Database>,
  data: SendWhatsAppTemplateNodeData,
  context: FlowExecutionContext
) {
  const setStatus = (status: string, extra: Record<string, string> = {}) => {
    context.variables = { ...(context.variables ?? {}), whatsapp_template_status: status, ...extra };
  };

  if (!data.channelId || !data.templateName || !data.templateLanguage) {
    console.error("sendWhatsAppTemplate: node is not configured");
    setStatus("failed");
    return;
  }

  const [{ data: workspace }, { data: channel }] = await Promise.all([
    supabase
      .from("workspaces")
      .select("late_api_key_encrypted")
      .eq("id", context.workspaceId)
      .single(),
    supabase
      .from("channels")
      .select("id, late_account_id, platform, is_active")
      .eq("id", data.channelId)
      .eq("workspace_id", context.workspaceId)
      .single(),
  ]);

  if (!workspace?.late_api_key_encrypted || !channel || channel.platform !== "whatsapp" || !channel.is_active) {
    console.error("sendWhatsAppTemplate: WhatsApp channel or Zernio key unavailable");
    setStatus("failed");
    return;
  }

  // The contact's saved fields ({{telefone_vaga}}) and name ({{contact_name}})
  // fill in where the flow has no variable of that name, so the node works
  // even when the phone was saved in an earlier run of the flow.
  const { data: contact } = await supabase
    .from("contacts")
    .select("display_name, email, contact_custom_fields(value, custom_field_definitions(slug))")
    .eq("id", context.contactId)
    .single();
  const contactVars: Record<string, unknown> = {};
  if (contact) {
    if (contact.display_name) contactVars.contact_name = contact.display_name;
    if (contact.email) contactVars.contact_email = contact.email;
    for (const cf of (contact.contact_custom_fields ?? []) as Array<{
      value: string | null;
      custom_field_definitions: { slug: string } | null;
    }>) {
      if (cf.custom_field_definitions?.slug && cf.value) contactVars[cf.custom_field_definitions.slug] = cf.value;
    }
  }
  const vars = { ...contactVars, ...((context.variables ?? {}) as Record<string, unknown>) };
  const phone = normalizeWhatsAppPhone(interpolateVariables(data.phone || "", vars));
  if (!phone) {
    setStatus("invalid_phone");
    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "message_failed",
      metadata: { node: "sendWhatsAppTemplate", reason: "invalid_phone", template: data.templateName },
    });
    return;
  }

  const params = (data.params ?? []).map((p) => interpolateVariables(p ?? "", vars).trim());

  try {
    const { conversationId } = await sendTemplate(workspace.late_api_key_encrypted, {
      accountId: channel.late_account_id,
      phone,
      templateName: data.templateName,
      templateLanguage: data.templateLanguage,
      templateParams: params,
    });
    setStatus("sent", conversationId ? { whatsapp_conversation_id: conversationId } : {});
    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "message_sent",
      metadata: { node: "sendWhatsAppTemplate", template: data.templateName, channelId: channel.id },
    });
  } catch (err) {
    console.error("sendWhatsAppTemplate failed:", err);
    setStatus("failed");
    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "message_failed",
      metadata: {
        node: "sendWhatsAppTemplate",
        template: data.templateName,
        error: err instanceof Error ? err.message.slice(0, 300) : "unknown",
      },
    });
  }
}

function interpolateVariables(
  text: string,
  variables: Record<string, unknown>
): string {
  // Supports dot paths ({{myvar.data.name}}) into object variables (e.g. parsed
  // httpRequest JSON responses). Unresolved paths leave the token literal.
  return text.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (token, path: string) => {
    const value = resolveVariablePath(variables, path);
    if (value === null || value === undefined) return token;
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}
