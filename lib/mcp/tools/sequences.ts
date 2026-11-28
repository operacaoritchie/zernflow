import { maskText } from "../mask";
import { dbOf, groupCount, limitArg, must, offsetArg, paging, readTool, str, uuid } from "./helpers";

interface SequenceRow {
  id: string; name: string; description: string | null; status: string; steps: unknown;
  exit_on_reply: boolean; max_pause_days: number; created_at: string; updated_at: string;
}

export const sequencesList = readTool({
  name: "sequences_list",
  title: "List sequences",
  description: "Sequences (drip campaigns) with status, number of steps and enrollments by status.",
  properties: { status: { type: "string", enum: ["draft", "active", "paused", "archived"] }, ...paging },
  async run(args, ctx) {
    const db = dbOf(ctx);
    const limit = limitArg(args);
    const offset = offsetArg(args);
    let q = db
      .from("sequences")
      .select("id, name, description, status, steps, exit_on_reply, max_pause_days, created_at, updated_at")
      .eq("workspace_id", ctx.workspaceId)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit);
    const status = str(args, "status", 20);
    if (status) q = q.eq("status", status);
    const rows = must(await q, "sequences") as SequenceRow[];
    const shown = rows.slice(0, limit);
    const enr = shown.length
      ? (must(
          await db.from("sequence_enrollments").select("sequence_id, status").in("sequence_id", shown.map((s) => s.id)).limit(10000),
          "enrollments"
        ) as Array<{ sequence_id: string; status: string }>)
      : [];
    const items = shown.map(({ steps, ...s }) => ({
      ...s,
      step_count: Array.isArray(steps) ? steps.length : 0,
      enrollments: groupCount(enr.filter((e) => e.sequence_id === s.id), (e) => e.status),
    }));
    const hasMore = rows.length > limit;
    return { items, has_more: hasMore, next_offset: hasMore ? offset + limit : null };
  },
});

export const sequenceGet = readTool({
  name: "sequence_get",
  title: "Get a sequence",
  description: "One sequence with its steps, enrollments by status and the most common enrollment errors.",
  properties: { sequence_id: { type: "string", description: "Sequence id (uuid)." } },
  required: ["sequence_id"],
  async run(args, ctx) {
    const db = dbOf(ctx);
    const id = uuid(args, "sequence_id");
    const seq = must(
      await db
        .from("sequences")
        .select("id, name, description, status, steps, exit_on_reply, max_pause_days, created_at, updated_at")
        .eq("id", id)
        .eq("workspace_id", ctx.workspaceId)
        .maybeSingle(),
      "sequence"
    ) as unknown as SequenceRow | never[];
    if (Array.isArray(seq)) throw new Error("Sequence not found in this workspace");
    const enr = must(
      await db.from("sequence_enrollments").select("status, current_step_index, last_error, exit_reason").eq("sequence_id", id).limit(10000),
      "enrollments"
    ) as Array<{ status: string; current_step_index: number; last_error: string | null; exit_reason: string | null }>;
    return {
      ...seq,
      enrollments_by_status: groupCount(enr, (e) => e.status),
      active_by_step: groupCount(enr.filter((e) => e.status === "active"), (e) => String(e.current_step_index)),
      exit_reasons: groupCount(enr.filter((e) => e.exit_reason), (e) => e.exit_reason),
      top_errors: Object.entries(
        groupCount(enr.filter((e) => e.last_error), (e) => maskText((e.last_error ?? "").slice(0, 120)) ?? "")
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([error, count]) => ({ error, count })),
    };
  },
});

export const SEQUENCE_TOOLS = [sequencesList, sequenceGet];
