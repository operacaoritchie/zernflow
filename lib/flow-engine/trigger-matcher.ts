import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { generateText, createGateway } from "ai";

interface IncomingMessage {
  text?: string;
  postbackPayload?: string;
  quickReplyPayload?: string;
  sender?: { id: string };
}

type Trigger = Database["public"]["Tables"]["triggers"]["Row"];

export async function matchTrigger(
  supabase: SupabaseClient<Database>,
  {
    channelId,
    workspaceId,
    conversationId,
    message,
    isFirstMessage,
  }: {
    channelId: string;
    workspaceId: string;
    conversationId: string;
    message: IncomingMessage;
    /** Caller-known "first inbound message" signal; inbound messages are not
     * mirrored locally, so the legacy count query below always sees 0. */
    isFirstMessage?: boolean;
  }
): Promise<Trigger | null> {
  // Triggers with null channel_id are workspace-wide, NOT global: the flows
  // join must be pinned to the channel's workspace or one tenant's triggers
  // (and flows) would run on another tenant's channels.
  const { data: triggers } = await supabase
    .from("triggers")
    .select("*, flows!inner(status, workspace_id)")
    .or(`channel_id.eq.${channelId},channel_id.is.null`)
    .eq("is_active", true)
    .eq("flows.status", "published")
    .eq("flows.workspace_id", workspaceId)
    .order("priority", { ascending: false });

  if (!triggers || triggers.length === 0) return null;

  // Priority order: postback > quick_reply > keyword > welcome > default
  // 1. Check postback triggers
  if (message.postbackPayload) {
    const match = triggers.find(
      (t) =>
        t.type === "postback" &&
        (t.config as { payload?: string })?.payload === message.postbackPayload
    );
    if (match) return match;
  }

  // 2. Check quick_reply triggers
  if (message.quickReplyPayload) {
    const match = triggers.find(
      (t) =>
        t.type === "quick_reply" &&
        (t.config as { payload?: string })?.payload ===
          message.quickReplyPayload
    );
    if (match) return match;
  }

  // 3. Check keyword triggers
  if (message.text) {
    const text = message.text.toLowerCase().trim();

    for (const trigger of triggers.filter((t) => t.type === "keyword")) {
      const config = trigger.config as {
        keywords?: Array<string | { value: string; matchType?: "exact" | "contains" | "startsWith" }>;
        excludeKeywords?: string[];
        replyVariations?: string[];
        matchType?: "exact" | "contains" | "startsWith";
      };

      if (!config.keywords) continue;

      let keywordMatched = false;

      for (const kw of config.keywords) {
        // Support both formats: plain string or { value, matchType } object
        const keyword = (typeof kw === "string" ? kw : kw.value).toLowerCase();
        const matchType =
          (typeof kw === "object" && kw.matchType) || config.matchType || "contains";

        if (matchType === "exact" && text === keyword) { keywordMatched = true; break; }
        if (matchType === "contains" && text.includes(keyword)) { keywordMatched = true; break; }
        if (matchType === "startsWith" && text.startsWith(keyword)) { keywordMatched = true; break; }
      }

      if (!keywordMatched) continue;

      // Check exclude keywords: if the message contains any excluded term,
      // skip this trigger entirely and try the next one
      const excludeKeywords = config.excludeKeywords;
      if (excludeKeywords && excludeKeywords.length > 0) {
        const excluded = excludeKeywords.some((ek) =>
          text.includes(ek.toLowerCase())
        );
        if (excluded) continue;
      }

      return trigger;
    }
  }

  // 4. Check welcome trigger (first inbound message for this contact on this channel)
  let firstMessage = isFirstMessage;
  if (firstMessage === undefined) {
    const { count } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("direction", "inbound");
    firstMessage = count === 1;
  }

  if (firstMessage) {
    const welcomeTrigger = triggers.find((t) => t.type === "welcome");
    if (welcomeTrigger) return welcomeTrigger;
  }

  // 4.5. AI Intent Recognition: if no keyword matched and workspace has AI configured,
  // use AI to classify the message intent against available keyword triggers.
  // This runs after keyword matching but before the default trigger so that
  // semantically similar messages (e.g. "what's the cost?" matching a "pricing" keyword)
  // can still route to the correct flow.
  if (message.text) {
    const keywordTriggers = triggers.filter(
      (t) => t.type === "keyword" && t.config
    );
    if (keywordTriggers.length > 0) {
      const aiMatch = await matchByAiIntent(
        supabase,
        keywordTriggers,
        message.text,
        channelId
      );
      if (aiMatch) return aiMatch;
    }
  }

  // 5. Default trigger
  const defaultTrigger = triggers.find((t) => t.type === "default");
  return defaultTrigger || null;
}

/**
 * Use AI to classify an incoming message against the available keyword triggers.
 * Builds a numbered list of intents (with their keywords) and asks the AI model
 * to return the index of the best matching intent, or -1 if none match.
 *
 * This is best-effort: if the workspace has no AI key configured, the AI call
 * fails, times out (5s), or returns an invalid index, we silently return null
 * so message processing falls through to the default trigger.
 *
 * Runs through the Vercel AI Gateway, like the AI Response node.
 *
 * @param supabase - Supabase client for database lookups
 * @param keywordTriggers - keyword-type triggers to match against
 * @param messageText - the user's incoming message text
 * @param channelId - channel ID to resolve workspace AI config
 * @returns the matched trigger, or null if no AI match
 */
async function matchByAiIntent(
  supabase: SupabaseClient<Database>,
  keywordTriggers: Trigger[],
  messageText: string,
  channelId: string
): Promise<Trigger | null> {
  // Get workspace via channel to check AI config
  const { data: channel } = await supabase
    .from("channels")
    .select("workspace_id")
    .eq("id", channelId)
    .single();

  if (!channel) return null;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("ai_api_key")
    .eq("id", channel.workspace_id)
    .single();

  // Only run AI intent if an AI Gateway key is configured
  if (!workspace?.ai_api_key && !process.env.AI_GATEWAY_API_KEY) return null;

  // Build intent descriptions from keyword triggers
  const intents = keywordTriggers.map((t, i) => {
    const config = t.config as {
      keywords?: Array<string | { value: string }>;
    };
    const keywords = (config.keywords || []).map((k) =>
      typeof k === "string" ? k : k.value
    );
    return { index: i, keywords: keywords.join(", ") };
  });

  const intentList = intents
    .map((i) => `${i.index}: keywords=[${i.keywords}]`)
    .join("\n");

  try {
    // Same credentials as the AI Response node: the workspace's AI Gateway key,
    // or the deployment's AI_GATEWAY_API_KEY.
    const gw = createGateway({
      apiKey: workspace?.ai_api_key || process.env.AI_GATEWAY_API_KEY || undefined,
    });
    const result = await generateText({
      model: gw("openai/gpt-4o-mini"),
      system:
        "You are a message intent classifier. Given a user message and a list of intents (each with associated keywords), return ONLY the intent index number that best matches the message. The message and keywords may be in any language. If no intent matches, return -1. Return ONLY the number, nothing else.",
      prompt: `Message: "${messageText}"\n\nIntents:\n${intentList}`,
      maxOutputTokens: 10,
      temperature: 0,
      abortSignal: AbortSignal.timeout(5000), // don't block message handling
    });
    const responseText = result.text;

    const matchIndex = parseInt(responseText.trim(), 10);
    if (
      isNaN(matchIndex) ||
      matchIndex < 0 ||
      matchIndex >= keywordTriggers.length
    ) {
      return null;
    }

    return keywordTriggers[matchIndex];
  } catch (error) {
    // AI intent matching is best-effort, never block message processing
    console.error("AI intent matching failed:", error);
    return null;
  }
}
