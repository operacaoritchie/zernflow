import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { loadBroadcastForUser } from "@/lib/broadcast-api";
import { broadcastKind, broadcastText, checkBroadcastSetup, parseTemplate } from "@/lib/broadcasts";
import { checkEligibility, classifySendError } from "@/lib/send-policy";
import { fillPlaceholders, loadContactFacts, policyInputFor, recordAttempt } from "@/lib/send-context";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-templates";
import { sendFreeform, sendTemplateMessage, ZernioSendError } from "@/lib/zernio-send";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/broadcasts/:broadcastId/test
 * Body: { target: "@username" | phone | name }
 *
 * Sends this broadcast to one contact, through the same rules as the real
 * send (except quiet hours). For Instagram the tester must have written to
 * the account in the last 24 hours. Owner/admin only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ broadcastId: string }> }
) {
  const { broadcastId } = await params;
  const auth = await loadBroadcastForUser(broadcastId, { requireSender: true });
  if (!auth.ok) return auth.response;
  const { broadcast, service } = auth;

  let target = "";
  try {
    target = String((await request.json()).target ?? "").trim();
  } catch {
    target = "";
  }
  if (!target) return NextResponse.json({ error: "target_required" }, { status: 400 });

  const setup = await checkBroadcastSetup(service, broadcast);
  if ("problem" in setup) return NextResponse.json({ error: setup.problem }, { status: 400 });
  const { channel, settings, apiKey } = setup;

  const contactId = await findContact(service, broadcast.workspace_id, target);
  if (!contactId) return NextResponse.json({ error: "contact_not_found" }, { status: 404 });

  const template = parseTemplate(broadcast.template);
  const kind = broadcastKind(channel, template);
  const facts = (await loadContactFacts(service, broadcast.workspace_id, [contactId])).get(contactId);
  if (!facts) return NextResponse.json({ error: "contact_not_found" }, { status: 404 });

  const decision = checkEligibility(
    policyInputFor(facts, channel, kind, settings, {
      templateSet: kind === "template" ? !!template : undefined,
      quietHours: false,
    })
  );
  if (decision.action === "skip") {
    return NextResponse.json({ error: "not_eligible", reason: decision.reason, contact: facts.displayName }, { status: 400 });
  }

  try {
    let messageId: string | null;
    if (kind === "template") {
      ({ messageId } = await sendTemplateMessage(apiKey, {
        accountId: channel.lateAccountId,
        phone: facts.phone!,
        templateName: template!.templateName,
        templateLanguage: template!.templateLanguage,
        templateParams: template!.params.map((p) => fillPlaceholders(p, facts.variables).trim()),
        idempotencyKey: randomUUID(),
      }));
    } else {
      const conv = facts.conversations.find((c) => c.channelId === channel.id)!;
      ({ messageId } = await sendFreeform(apiKey, {
        accountId: channel.lateAccountId,
        conversationId: conv.lateConversationId!,
        text: fillPlaceholders(broadcastText(broadcast), facts.variables),
        idempotencyKey: randomUUID(),
      }));
    }
    await recordAttempt(service, {
      workspaceId: broadcast.workspace_id,
      source: "test",
      sourceId: broadcast.id,
      contactId,
      channelId: channel.id,
      kind,
      decision: "sent",
      platformMessageId: messageId,
    });
    return NextResponse.json({ ok: true, contact: facts.displayName });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const info = classifySendError(err instanceof ZernioSendError ? err.status : null, message);
    await recordAttempt(service, {
      workspaceId: broadcast.workspace_id,
      source: "test",
      sourceId: broadcast.id,
      contactId,
      channelId: channel.id,
      kind,
      decision: "failed",
      reason: info.reason,
      error: message,
    });
    return NextResponse.json({ error: "send_failed", reason: info.reason, detail: message.slice(0, 300) }, { status: 502 });
  }
}

async function findContact(
  service: SupabaseClient<Database>,
  workspaceId: string,
  target: string
): Promise<string | null> {
  const username = target.replace(/^@/, "");

  // 1. Instagram / platform username
  const { data: byUsername } = await service
    .from("contact_channels")
    .select("contact_id, contacts!inner(workspace_id)")
    .eq("contacts.workspace_id", workspaceId)
    .ilike("platform_username", username)
    .limit(1);
  if (byUsername?.length) return byUsername[0].contact_id;

  // 2. Phone: saved in a phone field, or the WhatsApp sender id
  const phone = normalizeWhatsAppPhone(target);
  if (phone) {
    const { data: byField } = await service
      .from("contact_custom_fields")
      .select("contact_id, value, contacts!inner(workspace_id)")
      .eq("contacts.workspace_id", workspaceId)
      .like("value", `%${phone.slice(-8)}%`)
      .limit(20);
    const match = (byField ?? []).find((f) => normalizeWhatsAppPhone(f.value) === phone);
    if (match) return match.contact_id;

    const { data: bySender } = await service
      .from("contact_channels")
      .select("contact_id, contacts!inner(workspace_id)")
      .eq("contacts.workspace_id", workspaceId)
      .in("platform_sender_id", [phone, `+${phone}`])
      .limit(1);
    if (bySender?.length) return bySender[0].contact_id;
  }

  // 3. Name
  const { data: byName } = await service
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("display_name", target)
    .limit(1);
  return byName?.[0]?.id ?? null;
}
