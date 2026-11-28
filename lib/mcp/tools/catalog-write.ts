
import { dbOf, must, str, writeTool } from "./helpers";

const FIELD_TYPES = ["text", "number", "boolean", "date", "url", "email", "phone", "cpf"];

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export const tagCreate = writeTool({
  name: "tag_create",
  title: "Create a tag",
  description: "Creates a tag. If a tag with that name already exists (any capitalization), returns it unchanged. Create the tag before using it in contact_update or in a flow.",
  idempotent: true,
  properties: {
    name: { type: "string", description: "Tag name (up to 60 characters)." },
    color: { type: "string", description: "Optional colour as #rrggbb." },
  },
  required: ["name"],
  async run(args, ctx) {
    const db = dbOf(ctx);
    const name = str(args, "name", 60);
    if (!name) throw new Error("name is required");
    const color = str(args, "color", 20);
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("color must look like #22aa44");
    const tags = must(await db.from("tags").select("id, name, color").eq("workspace_id", ctx.workspaceId).limit(2000), "tags") as Array<{ id: string; name: string; color: string | null }>;
    const found = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (found) return { created: false, id: found.id, name: found.name, color: found.color };
    const { data, error } = await db.from("tags").insert({ workspace_id: ctx.workspaceId, name, ...(color ? { color } : {}) }).select("id, name, color").single();
    if (error) throw new Error(error.message);
    return { created: true, ...(data as object) };
  },
});

export const fieldCreate = writeTool({
  name: "field_create",
  title: "Create a custom field",
  description: `Creates a custom field for contacts. type is one of: ${FIELD_TYPES.join(", ")}. phone and cpf are stored as digits and validated. The slug (used in flows) is made from the name unless given. If the slug already exists with the same type, returns it unchanged.`,
  idempotent: true,
  properties: {
    name: { type: "string", description: "Field name shown in the app." },
    slug: { type: "string", description: "Optional identifier (a-z, 0-9, _). Default: made from the name." },
    type: { type: "string", enum: FIELD_TYPES },
  },
  required: ["name", "type"],
  async run(args, ctx) {
    const db = dbOf(ctx);
    const name = str(args, "name", 60);
    const type = str(args, "type", 20);
    if (!name) throw new Error("name is required");
    if (!type || !FIELD_TYPES.includes(type)) throw new Error(`type must be one of: ${FIELD_TYPES.join(", ")}`);
    const slug = slugify(str(args, "slug", 40) ?? name);
    if (!slug) throw new Error("slug could not be made from the name; pass slug (a-z, 0-9, _)");
    const defs = must(await db.from("custom_field_definitions").select("id, name, slug, type").eq("workspace_id", ctx.workspaceId).limit(500), "fields") as Array<{ id: string; name: string; slug: string; type: string }>;
    const found = defs.find((d) => d.slug === slug);
    if (found) {
      if (found.type !== type) throw new Error(`A field "${slug}" already exists with type ${found.type}; changing the type is not allowed (it could corrupt saved values)`);
      return { created: false, ...found };
    }
    const { data, error } = await db.from("custom_field_definitions").insert({ workspace_id: ctx.workspaceId, name, slug, type }).select("id, name, slug, type").single();
    if (error) throw new Error(error.message);
    return { created: true, ...(data as object) };
  },
});

export const CATALOG_WRITE_TOOLS = [tagCreate, fieldCreate];
