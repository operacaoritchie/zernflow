import { validateSteps } from "@/lib/sequence-steps";
import type { SequenceStep } from "@/lib/types/database";
import { arrArg, bool, dbOf, objArg, optUuid, str, writeTool } from "./helpers";

const SEGMENT_FIELDS = ["has_tag", "missing_tag", "platform", "is_subscribed", "last_interaction", "custom_field"];

/** Throws on a filter the audience resolver would not understand. Returns it cleaned. */
export function checkSegment(raw: Record<string, unknown> | undefined) {
  if (!raw) return null;
  const bad = (m: string) => new Error(`Invalid segment_filter: ${m}`);
  const comb = (v: unknown) => (v === "or" ? "or" : "and");
  const groups = Array.isArray(raw.groups) ? raw.groups : null;
  if (!groups || groups.length > 10) throw bad("groups must be a list of up to 10 groups");
  return {
    combinator: comb(raw.combinator),
    groups: groups.map((g) => {
      const rules = (g as { rules?: unknown }).rules;
      if (!Array.isArray(rules) || rules.length > 20) throw bad("each group needs up to 20 rules");
      return {
        combinator: comb((g as { combinator?: unknown }).combinator),
        rules: rules.map((r) => {
          const rule = r as { field?: unknown; operator?: unknown; value?: unknown };
          if (typeof rule.field !== "string" || !SEGMENT_FIELDS.includes(rule.field)) throw bad(`rule field must be one of ${SEGMENT_FIELDS.join(", ")}`);
          return { field: rule.field, operator: String(rule.operator ?? "is").slice(0, 30), value: String(rule.value ?? "").slice(0, 200) };
        }),
      };
    }),
  };
}

export const broadcastSaveDraft = writeTool({
  name: "broadcast_save_draft",
  title: "Save a broadcast draft",
  description:
    "Creates (or edits, with broadcast_id) a broadcast as a DRAFT with a text message and an optional audience filter. It is never scheduled and never sent: someone must review and send it in the app. Use broadcast_verify_audience to see who would receive it.",
  properties: {
    broadcast_id: { type: "string", description: "Existing draft to edit (uuid). Omit to create." },
    name: { type: "string" },
    message_text: { type: "string", description: "Message text. {{first_name}} and field slugs are replaced when sent." },
    segment_filter: { type: "object", description: "{ combinator, groups: [{ combinator, rules: [{ field, operator, value }] }] }. Fields: " + SEGMENT_FIELDS.join(", ") },
  },
  required: ["name", "message_text"],
  async run(args, ctx) {
    const db = dbOf(ctx);
    const name = str(args, "name", 120);
    const text = str(args, "message_text", 2000);
    if (!name || !text) throw new Error("name and message_text are required");
    const segment = checkSegment(objArg(args, "segment_filter"));
    const id = optUuid(args, "broadcast_id");
    const fields = { name, message_content: { text }, segment_filter: segment };

    if (id) {
      const { data: cur, error } = await db.from("broadcasts").select("id, status").eq("id", id).eq("workspace_id", ctx.workspaceId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!cur) throw new Error("Broadcast not found in this workspace");
      if ((cur as { status: string }).status !== "draft") throw new Error(`This broadcast is ${(cur as { status: string }).status}. Only drafts can be edited.`);
      const { data, error: uErr } = await db.from("broadcasts").update({ ...fields, scheduled_for: null, updated_at: new Date().toISOString() }).eq("id", id).eq("workspace_id", ctx.workspaceId).eq("status", "draft").select("id, name, status");
      if (uErr) throw new Error(uErr.message);
      if (!data?.length) throw new Error("The broadcast changed while saving; read it again and retry.");
      return { ...data[0], next: "Check the audience with broadcast_verify_audience, then review and send it in the app." };
    }
    const { data, error } = await db.from("broadcasts").insert({ workspace_id: ctx.workspaceId, status: "draft", scheduled_for: null, ...fields }).select("id, name, status").single();
    if (error) throw new Error(error.message);
    return { ...(data as object), next: "Check the audience with broadcast_verify_audience, then review and send it in the app." };
  },
});

const STEP_TYPES = ["message", "delay", "template"];

export const sequenceSaveDraft = writeTool({
  name: "sequence_save_draft",
  title: "Save a sequence draft",
  description:
    "Creates (or edits, with sequence_id) a sequence as a DRAFT. Steps: { type: 'message', content } | { type: 'delay', delayMinutes } | { type: 'template', channelId, templateName, templateLanguage, params? }. It is never activated: nobody is enrolled until someone activates it in the app. Returns `problems` that would block activation.",
  properties: {
    sequence_id: { type: "string", description: "Existing draft to edit (uuid). Omit to create." },
    name: { type: "string" },
    description: { type: "string" },
    steps: { type: "array", items: { type: "object" } },
    exit_on_reply: { type: "boolean", description: "Remove the contact from the sequence when they reply (default true)." },
  },
  required: ["name", "steps"],
  async run(args, ctx) {
    const db = dbOf(ctx);
    const name = str(args, "name", 120);
    if (!name) throw new Error("name is required");
    const stepsIn = arrArg(args, "steps", 50);
    if (!stepsIn) throw new Error("steps is required");
    const steps = stepsIn.map((s, i) => {
      const t = (s as { type?: unknown })?.type;
      if (typeof t !== "string" || !STEP_TYPES.includes(t)) throw new Error(`step ${i + 1}: type must be one of ${STEP_TYPES.join(", ")}`);
      return s as SequenceStep;
    });
    const problems = validateSteps(steps);
    const exit = bool(args, "exit_on_reply");
    const fields = { name, description: str(args, "description", 500) ?? null, steps: JSON.parse(JSON.stringify(steps)), ...(exit !== undefined ? { exit_on_reply: exit } : {}) };
    const id = optUuid(args, "sequence_id");

    if (id) {
      const { data: cur, error } = await db.from("sequences").select("id, status").eq("id", id).eq("workspace_id", ctx.workspaceId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!cur) throw new Error("Sequence not found in this workspace");
      if ((cur as { status: string }).status !== "draft") throw new Error(`This sequence is ${(cur as { status: string }).status}. Only drafts can be edited by MCP.`);
      const { data, error: uErr } = await db.from("sequences").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).eq("workspace_id", ctx.workspaceId).eq("status", "draft").select("id, name, status");
      if (uErr) throw new Error(uErr.message);
      if (!data?.length) throw new Error("The sequence changed while saving; read it again and retry.");
      return { ...data[0], problems, next: "Review and activate it in the app." };
    }
    const { data, error } = await db.from("sequences").insert({ workspace_id: ctx.workspaceId, status: "draft", ...fields }).select("id, name, status").single();
    if (error) throw new Error(error.message);
    return { ...(data as object), problems, next: "Review and activate it in the app." };
  },
});

export const DRAFT_TOOLS = [broadcastSaveDraft, sequenceSaveDraft];
