import { validateFieldValue } from "@/lib/field-validation";
import { maskFieldValue } from "../mask";
import { dbOf, must, objArg, str, strList, uuid, writeTool } from "./helpers";

const MAX_FIELDS = 20;

export const contactUpdate = writeTool({
  name: "contact_update",
  title: "Update a contact",
  description:
    "Adds or removes tags and sets custom field values on one contact. Tags and fields must already exist (see tags_list, fields_list, tag_create, field_create). Values are checked by field type (phone and CPF are stored as digits). Everything is validated before anything is saved. Does not send messages and does not change the subscription.",
  idempotent: true,
  properties: {
    contact_id: { type: "string", description: "Contact id (uuid)." },
    add_tags: { type: "array", items: { type: "string" }, description: "Tag names to add." },
    remove_tags: { type: "array", items: { type: "string" }, description: "Tag names to remove." },
    set_fields: { type: "object", additionalProperties: { type: "string" }, description: "Field slug → new value." },
  },
  required: ["contact_id"],
  async run(args, ctx) {
    const db = dbOf(ctx);
    const contactId = uuid(args, "contact_id");
    const { data: contact, error: cErr } = await db.from("contacts").select("id").eq("id", contactId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!contact) throw new Error("Contact not found in this workspace");

    const add = strList(args, "add_tags", 20, 60);
    const remove = strList(args, "remove_tags", 20, 60);
    const fieldsIn = objArg(args, "set_fields") ?? {};
    const slugs = Object.keys(fieldsIn);
    if (slugs.length > MAX_FIELDS) throw new Error(`set_fields can have at most ${MAX_FIELDS} fields`);
    if (add.length + remove.length + slugs.length === 0) throw new Error("Nothing to change: pass add_tags, remove_tags or set_fields");

    // ── Validate everything first ──
    const tags = must(await db.from("tags").select("id, name").eq("workspace_id", ctx.workspaceId).limit(2000), "tags") as Array<{ id: string; name: string }>;
    const tagId = (name: string) => tags.find((t) => t.name.toLowerCase() === name.toLowerCase())?.id;
    const missingTags = [...add, ...remove].filter((n) => !tagId(n));
    if (missingTags.length) throw new Error(`Tags not found: ${missingTags.join(", ")}. Create them with tag_create first.`);

    const defs = must(await db.from("custom_field_definitions").select("id, slug, type").eq("workspace_id", ctx.workspaceId).limit(500), "fields") as Array<{ id: string; slug: string; type: string }>;
    const toSave: Array<{ def: { id: string; slug: string; type: string }; value: string }> = [];
    for (const slug of slugs) {
      const def = defs.find((d) => d.slug === slug);
      if (!def) throw new Error(`Field "${slug}" does not exist. Create it with field_create first.`);
      const raw = fieldsIn[slug];
      if (typeof raw !== "string") throw new Error(`Field "${slug}": the value must be text`);
      const check = validateFieldValue(def.type, raw);
      if (!check.ok) throw new Error(`Field "${slug}" (${def.type}): ${check.reason === "empty" ? "the value is empty" : "the value is not valid for this type"}`);
      toSave.push({ def, value: check.value });
    }

    // ── Write ──
    const existingTags = must(await db.from("contact_tags").select("tag_id").eq("contact_id", contactId), "contact tags") as Array<{ tag_id: string }>;
    const has = new Set(existingTags.map((t) => t.tag_id));
    const toAdd = [...new Set(add.map((n) => tagId(n)!))].filter((id) => !has.has(id));
    if (toAdd.length) {
      const { error } = await db.from("contact_tags").insert(toAdd.map((tag_id) => ({ contact_id: contactId, tag_id })));
      if (error) throw new Error(error.message);
    }
    for (const n of remove) {
      const { error } = await db.from("contact_tags").delete().eq("contact_id", contactId).eq("tag_id", tagId(n)!);
      if (error) throw new Error(error.message);
    }
    const existingValues = must(await db.from("contact_custom_fields").select("id, field_id").eq("contact_id", contactId), "fields") as Array<{ id: string; field_id: string }>;
    for (const { def, value } of toSave) {
      const row = existingValues.find((v) => v.field_id === def.id);
      const stamp = new Date().toISOString();
      const res = row
        ? await db.from("contact_custom_fields").update({ value, updated_at: stamp }).eq("id", row.id)
        : await db.from("contact_custom_fields").insert({ contact_id: contactId, field_id: def.id, value });
      if (res.error) throw new Error(res.error.message);
    }

    return {
      contact_id: contactId,
      tags_added: add.filter((n) => toAdd.includes(tagId(n)!)),
      tags_removed: remove,
      fields_set: Object.fromEntries(toSave.map(({ def, value }) => [def.slug, maskFieldValue(def.type, def.slug, value)])),
      note: "Personal data is shown masked.",
    };
  },
});

export const contactNoteAdd = writeTool({
  name: "contact_note_add",
  title: "Add an internal note",
  description: "Adds an internal note to a conversation (only your team sees it; nothing is sent to the contact). Needs a signed-in user, so it does not work with API keys.",
  properties: {
    conversation_id: { type: "string", description: "Conversation id (uuid), from conversations_list." },
    content: { type: "string", description: "Note text (up to 2000 characters)." },
  },
  required: ["conversation_id", "content"],
  async run(args, ctx) {
    if (!ctx.userId) throw new Error("Notes belong to a signed-in person: connect with your account (OAuth) to add notes; API keys cannot.");
    const db = dbOf(ctx);
    const id = uuid(args, "conversation_id");
    const content = str(args, "content", 2000);
    if (!content) throw new Error("content is required");
    const { data: conv, error: cErr } = await db.from("conversations").select("id").eq("id", id).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!conv) throw new Error("Conversation not found in this workspace");
    const { data, error } = await db.from("conversation_notes").insert({ conversation_id: id, workspace_id: ctx.workspaceId, user_id: ctx.userId, content }).select("id, created_at").single();
    if (error) throw new Error(error.message);
    return { ...(data as object), note: "Internal only: nothing was sent to the contact." };
  },
});

export const CONTACT_WRITE_TOOLS = [contactUpdate, contactNoteAdd];
