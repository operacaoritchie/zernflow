import { NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace";
import {
  ZernioApiError,
  countPlaceholders,
  createTemplate,
  listTemplates,
  normalizeTemplateName,
  type TemplateCategory,
} from "@/lib/whatsapp-templates";

const CATEGORIES: TemplateCategory[] = ["MARKETING", "UTILITY", "AUTHENTICATION"];

/** Resolve a WhatsApp channel of the current workspace plus the workspace's Zernio key. */
async function resolveChannel(channelId: string | null) {
  const { workspace, supabase } = await getWorkspace();
  if (!workspace.late_api_key_encrypted) {
    return { error: NextResponse.json({ error: "zernio_key_missing" }, { status: 400 }) };
  }
  let query = supabase
    .from("channels")
    .select("id, platform, late_account_id, display_name, username")
    .eq("workspace_id", workspace.id)
    .eq("platform", "whatsapp")
    .eq("is_active", true);
  if (channelId) query = query.eq("id", channelId);
  const { data: channels } = await query.order("created_at", { ascending: true });
  const channel = channels?.[0];
  if (!channel) {
    return { error: NextResponse.json({ error: "whatsapp_channel_missing" }, { status: 404 }) };
  }
  return { channel, apiKey: workspace.late_api_key_encrypted };
}

function zernioError(err: unknown) {
  const status = err instanceof ZernioApiError ? err.status : 502;
  const message = err instanceof Error ? err.message : "Zernio API error";
  return NextResponse.json({ error: message }, { status: status >= 400 && status < 600 ? status : 502 });
}

/**
 * GET /api/v1/whatsapp/templates?channelId=...&status=APPROVED
 * Lists the templates of a WhatsApp channel, read live from Meta through Zernio.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const resolved = await resolveChannel(url.searchParams.get("channelId"));
  if (resolved.error) return resolved.error;
  try {
    const templates = await listTemplates(resolved.apiKey, resolved.channel.late_account_id, {
      status: url.searchParams.get("status") ?? undefined,
    });
    return NextResponse.json({ channelId: resolved.channel.id, templates });
  } catch (err) {
    return zernioError(err);
  }
}

/**
 * POST /api/v1/whatsapp/templates
 * Body: { channelId, name, category, language, body, bodyExamples[], header?, headerExamples?, footer? }
 * Submits a template to Meta for review.
 */
export async function POST(request: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = normalizeTemplateName(String(payload.name ?? ""));
  const category = String(payload.category ?? "").toUpperCase() as TemplateCategory;
  const language = String(payload.language ?? "").trim();
  const body = String(payload.body ?? "").trim();
  const header = String(payload.header ?? "").trim();
  const footer = String(payload.footer ?? "").trim();
  const asStrings = (v: unknown) =>
    Array.isArray(v) ? v.map((x) => String(x ?? "").trim()) : [];
  const bodyExamples = asStrings(payload.bodyExamples);
  const headerExamples = asStrings(payload.headerExamples);

  if (!name) return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  if (!CATEGORIES.includes(category)) return NextResponse.json({ error: "invalid_category" }, { status: 400 });
  if (!language) return NextResponse.json({ error: "invalid_language" }, { status: 400 });
  if (!body || body.length > 1024) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  if (header.length > 60) return NextResponse.json({ error: "invalid_header" }, { status: 400 });
  if (footer.length > 60) return NextResponse.json({ error: "invalid_footer" }, { status: 400 });
  if (bodyExamples.length !== countPlaceholders(body) || bodyExamples.some((e) => !e)) {
    return NextResponse.json({ error: "examples_required" }, { status: 400 });
  }
  if (headerExamples.length !== countPlaceholders(header) || headerExamples.some((e) => !e)) {
    return NextResponse.json({ error: "examples_required" }, { status: 400 });
  }

  const resolved = await resolveChannel(payload.channelId ? String(payload.channelId) : null);
  if (resolved.error) return resolved.error;

  try {
    const template = await createTemplate(resolved.apiKey, {
      accountId: resolved.channel.late_account_id,
      name,
      category,
      language,
      body,
      bodyExamples,
      header: header || undefined,
      headerExamples,
      footer: footer || undefined,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    return zernioError(err);
  }
}
