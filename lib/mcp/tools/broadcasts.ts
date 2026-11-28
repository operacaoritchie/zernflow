import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { buildAudience, checkBroadcastSetup, parseTemplate } from "@/lib/broadcasts";
import { maskText } from "../mask";
import { dbOf, groupCount, limitArg, must, offsetArg, page, paging, readTool, str, uuid } from "./helpers";

type BroadcastRow = Database["public"]["Tables"]["broadcasts"]["Row"];

async function ownBroadcast(ctx: Parameters<typeof dbOf>[0], id: string): Promise<BroadcastRow> {
  const { data, error } = await dbOf(ctx).from("broadcasts").select("*").eq("id", id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Broadcast not found in this workspace");
  return data as BroadcastRow;
}

const summary = (b: BroadcastRow) => ({
  id: b.id,
  name: b.name,
  status: b.status,
  channel_id: b.channel_id,
  scheduled_for: b.scheduled_for,
  paused_at: b.paused_at,
  total_recipients: b.total_recipients,
  sent: b.sent,
  delivered: b.delivered,
  read: b.read,
  failed: b.failed,
  skipped: b.skipped,
  uses_template: !!parseTemplate(b.template),
  created_at: b.created_at,
  updated_at: b.updated_at,
});

export const broadcastsList = readTool({
  name: "broadcasts_list",
  title: "List broadcasts",
  description: "Broadcasts (transmissões) with status and delivery counters. Filter by status.",
  properties: {
    status: { type: "string", enum: ["draft", "scheduled", "sending", "paused", "completed", "failed", "cancelled"] },
    ...paging,
  },
  async run(args, ctx) {
    const limit = limitArg(args);
    const offset = offsetArg(args);
    let q = dbOf(ctx)
      .from("broadcasts")
      .select("*")
      .eq("workspace_id", ctx.workspaceId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit);
    const status = str(args, "status", 20);
    if (status) q = q.eq("status", status);
    const rows = must(await q, "broadcasts") as BroadcastRow[];
    return page(rows.map(summary), limit, offset);
  },
});

export const broadcastGet = readTool({
  name: "broadcast_get",
  title: "Get a broadcast",
  description:
    "One broadcast: message, template, segment filter, schedule, counters, and recipients by status and skip reason (no phone numbers).",
  properties: { broadcast_id: { type: "string", description: "Broadcast id (uuid)." } },
  required: ["broadcast_id"],
  async run(args, ctx) {
    const b = await ownBroadcast(ctx, uuid(args, "broadcast_id"));
    const recipients = must(
      await dbOf(ctx).from("broadcast_recipients").select("status, skip_reason, error_message").eq("broadcast_id", b.id).limit(5000),
      "recipients"
    ) as Array<{ status: string; skip_reason: string | null; error_message: string | null }>;
    return {
      ...summary(b),
      message: b.message_content,
      template: b.template,
      segment_filter: b.segment_filter,
      recipients_by_status: groupCount(recipients, (r) => r.status),
      skipped_by_reason: groupCount(
        recipients.filter((r) => r.skip_reason),
        (r) => r.skip_reason
      ),
      top_errors: Object.entries(
        groupCount(
          recipients.filter((r) => r.error_message),
          (r) => maskText((r.error_message ?? "").slice(0, 120)) ?? ""
        )
      )
        .sort((a, b2) => b2[1] - a[1])
        .slice(0, 5)
        .map(([error, count]) => ({ error, count })),
    };
  },
});

export const broadcastVerifyAudience = readTool({
  name: "broadcast_verify_audience",
  title: "Preview who would receive a broadcast",
  description:
    "Dry run for a draft/scheduled broadcast: whether it can be sent, how many contacts are eligible and how many are left out and why. Nothing is sent or written. Contact names are shown; phone numbers are not.",
  properties: {
    broadcast_id: { type: "string", description: "Broadcast id (uuid)." },
    sample: { type: "integer", minimum: 0, maximum: 10, description: "How many eligible contact names to show (default 5)." },
  },
  required: ["broadcast_id"],
  async run(args, ctx) {
    const b = await ownBroadcast(ctx, uuid(args, "broadcast_id"));
    const sb = ctx.supabase as unknown as SupabaseClient<Database>;
    const setup = await checkBroadcastSetup(sb, b);
    if ("problem" in setup) {
      return { can_send: false, problem: setup.problem, broadcast: summary(b) };
    }
    const audience = await buildAudience(sb, b, setup.channel, setup.settings);
    const n = typeof args.sample === "number" ? Math.min(10, Math.max(0, Math.floor(args.sample))) : 5;
    return {
      can_send: audience.eligible.length > 0,
      broadcast: summary(b),
      channel_platform: setup.channel.platform,
      send_kind: audience.kind,
      segment_total: audience.total,
      eligible: audience.eligible.length,
      skipped: audience.skipped.length,
      skipped_by_reason: audience.skippedByReason,
      confirmation_threshold: setup.settings.confirmThreshold,
      needs_confirmation: audience.eligible.length > setup.settings.confirmThreshold,
      eligible_sample: audience.eligible.slice(0, n).map((e) => ({ contact_id: e.contactId, name: e.name })),
    };
  },
});

export const BROADCAST_TOOLS = [broadcastsList, broadcastGet, broadcastVerifyAudience];
