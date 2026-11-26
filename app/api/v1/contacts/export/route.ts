import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import {
  buildExport,
  DEFAULT_LEAD_TAG,
  EXPORT_FORMATS,
  EXPORT_PRESETS,
  type ExportContact,
  type ExportFormat,
  type ExportPreset,
} from "@/lib/contacts-export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE = 1000;
const MAX_ROWS = 100_000;

interface RawContact {
  id: string;
  display_name: string | null;
  email: string | null;
  is_subscribed: boolean;
  created_at: string;
  last_interaction_at: string | null;
  contact_tags: { tags: { name: string } | null }[] | null;
  contact_channels:
    | {
        platform_sender_id: string;
        platform_username: string | null;
        channels: { platform: string } | null;
      }[]
    | null;
  contact_custom_fields:
    | { value: string; custom_field_definitions: { slug: string; type: string } | null }[]
    | null;
}

function toExportContact(c: RawContact): ExportContact {
  return {
    id: c.id,
    display_name: c.display_name,
    email: c.email,
    is_subscribed: c.is_subscribed,
    created_at: c.created_at,
    last_interaction_at: c.last_interaction_at,
    tags: (c.contact_tags ?? []).map((t) => t.tags?.name).filter((n): n is string => !!n),
    channels: (c.contact_channels ?? []).map((ch) => ({
      platform: ch.channels?.platform ?? "",
      sender_id: ch.platform_sender_id,
      username: ch.platform_username,
    })),
    fields: (c.contact_custom_fields ?? [])
      .filter((f) => f.custom_field_definitions)
      .map((f) => ({
        slug: f.custom_field_definitions!.slug,
        type: f.custom_field_definitions!.type,
        value: f.value,
      })),
  };
}

/**
 * GET /api/v1/contacts/export?format=full|ig_audience|meta_customers
 *   &preset=all|instagram|leads&tag=<tag name>&search=<text>&cpf=1&leadTag=<tag>
 *
 * Bulk export of the current workspace's contacts as a CSV download.
 * Owners and admins only; every export is recorded in export_logs.
 */
export async function GET(request: NextRequest) {
  const { user, workspace, role, supabase } = await getWorkspace();

  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "Only owners and admins can export contacts" }, { status: 403 });
  }

  const p = request.nextUrl.searchParams;
  const format = (p.get("format") ?? "full") as ExportFormat;
  const preset = (p.get("preset") ?? "all") as ExportPreset;
  if (!EXPORT_FORMATS.includes(format) || !EXPORT_PRESETS.includes(preset)) {
    return NextResponse.json({ error: "Invalid format or preset" }, { status: 400 });
  }
  const tag = p.get("tag") || null;
  const search = p.get("search") || null;
  const leadTag = p.get("leadTag") || DEFAULT_LEAD_TAG;
  const includeCpf = p.get("cpf") === "1" && format === "full";

  const contacts: ExportContact[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from("contacts")
      .select(
        "id, display_name, email, is_subscribed, created_at, last_interaction_at, " +
          "contact_tags(tags(name)), " +
          "contact_channels(platform_sender_id, platform_username, channels(platform)), " +
          "contact_custom_fields(value, custom_field_definitions(slug, type))"
      )
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as unknown as RawContact[];
    contacts.push(...rows.map(toExportContact));
    if (rows.length < PAGE) break;
  }

  const file = buildExport(contacts, { format, preset, tag, search, leadTag, includeCpf });

  try {
    const service = await createServiceClient();
    await service.from("export_logs").insert({
      workspace_id: workspace.id,
      user_id: user.id,
      format,
      preset,
      filters: { tag, search, leadTag, includeCpf },
      row_count: file.count,
    });
  } catch (err) {
    console.error("export log failed", err);
  }

  return new NextResponse(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
      "X-Export-Count": String(file.count),
    },
  });
}
