import { dbOf, limitArg, must, offsetArg, paging, readTool } from "./helpers";

export const tagsList = readTool({
  name: "tags_list",
  title: "List tags",
  description: "Tags of the workspace with how many contacts have each.",
  properties: { ...paging },
  async run(args, ctx) {
    const db = dbOf(ctx);
    const limit = limitArg(args);
    const offset = offsetArg(args);
    const tags = must(
      await db
        .from("tags")
        .select("id, name, color, created_at")
        .eq("workspace_id", ctx.workspaceId)
        .order("name")
        .range(offset, offset + limit),
      "tags"
    ) as Array<{ id: string; name: string; color: string | null; created_at: string }>;
    const shown = tags.slice(0, limit);
    const counts = await Promise.all(
      shown.map(async (t) => {
        const { count } = await db.from("contact_tags").select("contact_id", { count: "exact", head: true }).eq("tag_id", t.id);
        return count ?? 0;
      })
    );
    const items = shown.map((t, i) => ({ ...t, contacts: counts[i] }));
    const hasMore = tags.length > limit;
    return { items, has_more: hasMore, next_offset: hasMore ? offset + limit : null };
  },
});

export const fieldsList = readTool({
  name: "fields_list",
  title: "List custom fields",
  description: "Custom fields (name, slug, type) that contacts can have. Types include text, number, phone, cpf, email and link.",
  async run(_args, ctx) {
    const rows = must(
      await dbOf(ctx).from("custom_field_definitions").select("id, name, slug, type, created_at").eq("workspace_id", ctx.workspaceId).order("name"),
      "fields"
    );
    return { items: rows };
  },
});

export const CATALOG_TOOLS = [tagsList, fieldsList];
