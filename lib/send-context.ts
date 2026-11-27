/**
 * Loads what the send policy needs to know about contacts, in batches, and
 * records every decision in send_attempts. Server only (service role).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-templates";
import type { PolicyInput, SendKind } from "@/lib/send-policy";
import type { SendingSettings } from "@/lib/workspace-settings";
import { parseSendingSettings } from "@/lib/workspace-settings";

type SB = SupabaseClient<Database>;

/** Phone fields tried in this order before any other field of type phone. */
export const PREFERRED_PHONE_SLUGS = ["telefone_vaga", "telefone"];

export interface ConversationFacts {
  id: string;
  channelId: string;
  platform: string | null;
  lateConversationId: string | null;
  lastInboundAt: string | null;
  automationPaused: boolean;
}

export interface ContactFacts {
  contactId: string;
  displayName: string | null;
  subscribed: boolean;
  optInAt: string | null;
  /** Normalized WhatsApp phone (digits with country code) or null. */
  phone: string | null;
  phoneOptedOut: boolean;
  hasWhatsAppInbound: boolean;
  conversations: ConversationFacts[];
  /** {{contact_name}}, {{first_name}} and every custom field slug. */
  variables: Record<string, string>;
}

export interface ChannelFacts {
  id: string;
  platform: string;
  isActive: boolean;
  lateAccountId: string;
}

const CHUNK = 300;

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function loadWorkspaceSending(
  supabase: SB,
  workspaceId: string
): Promise<{ settings: SendingSettings; apiKey: string | null }> {
  const { data } = await supabase
    .from("workspaces")
    .select("settings, late_api_key_encrypted")
    .eq("id", workspaceId)
    .single();
  return {
    settings: parseSendingSettings(data?.settings),
    apiKey: data?.late_api_key_encrypted ?? null,
  };
}

export async function loadChannel(supabase: SB, channelId: string): Promise<ChannelFacts | null> {
  const { data } = await supabase
    .from("channels")
    .select("id, platform, is_active, late_account_id")
    .eq("id", channelId)
    .single();
  if (!data) return null;
  return {
    id: data.id,
    platform: data.platform,
    isActive: data.is_active,
    lateAccountId: data.late_account_id,
  };
}

/** Pick the WhatsApp phone from a contact's fields and WhatsApp identities. */
export function pickPhone(
  fields: Array<{ slug: string; type: string; value: string }>,
  whatsappSenderIds: string[]
): string | null {
  const bySlug = new Map(fields.map((f) => [f.slug, f]));
  for (const slug of PREFERRED_PHONE_SLUGS) {
    const phone = normalizeWhatsAppPhone(bySlug.get(slug)?.value);
    if (phone) return phone;
  }
  for (const f of fields) {
    if (f.type !== "phone") continue;
    const phone = normalizeWhatsAppPhone(f.value);
    if (phone) return phone;
  }
  for (const id of whatsappSenderIds) {
    const phone = normalizeWhatsAppPhone(id.startsWith("+") ? id : `+${id}`);
    if (phone) return phone;
  }
  return null;
}

export async function loadContactFacts(
  supabase: SB,
  workspaceId: string,
  contactIds: string[]
): Promise<Map<string, ContactFacts>> {
  const result = new Map<string, ContactFacts>();
  const unique = Array.from(new Set(contactIds));

  for (const ids of chunks(unique)) {
    const [contactsRes, convRes, fieldsRes, identitiesRes] = await Promise.all([
      supabase
        .from("contacts")
        .select("id, display_name, is_subscribed, opt_in_whatsapp_at")
        .eq("workspace_id", workspaceId)
        .in("id", ids),
      supabase
        .from("conversations")
        .select("id, contact_id, channel_id, platform, late_conversation_id, last_inbound_at, is_automation_paused")
        .in("contact_id", ids),
      supabase
        .from("contact_custom_fields")
        .select("contact_id, value, custom_field_definitions(slug, type)")
        .in("contact_id", ids),
      supabase
        .from("contact_channels")
        .select("contact_id, platform_sender_id, channels(platform)")
        .in("contact_id", ids),
    ]);
    if (contactsRes.error) throw new Error(`could not load contacts: ${contactsRes.error.message}`);
    if (convRes.error) throw new Error(`could not load conversations: ${convRes.error.message}`);
    if (fieldsRes.error) throw new Error(`could not load contact fields: ${fieldsRes.error.message}`);
    if (identitiesRes.error) throw new Error(`could not load contact channels: ${identitiesRes.error.message}`);

    const convByContact = new Map<string, ConversationFacts[]>();
    for (const c of convRes.data ?? []) {
      const list = convByContact.get(c.contact_id) ?? [];
      list.push({
        id: c.id,
        channelId: c.channel_id,
        platform: c.platform,
        lateConversationId: c.late_conversation_id,
        lastInboundAt: c.last_inbound_at,
        automationPaused: !!c.is_automation_paused,
      });
      convByContact.set(c.contact_id, list);
    }

    const fieldsByContact = new Map<string, Array<{ slug: string; type: string; value: string }>>();
    for (const f of (fieldsRes.data ?? []) as Array<{
      contact_id: string;
      value: string;
      custom_field_definitions: { slug: string; type: string } | null;
    }>) {
      if (!f.custom_field_definitions || !f.value) continue;
      const list = fieldsByContact.get(f.contact_id) ?? [];
      list.push({ ...f.custom_field_definitions, value: f.value });
      fieldsByContact.set(f.contact_id, list);
    }

    const waIdsByContact = new Map<string, string[]>();
    for (const cc of (identitiesRes.data ?? []) as Array<{
      contact_id: string;
      platform_sender_id: string;
      channels: { platform: string } | null;
    }>) {
      if (cc.channels?.platform !== "whatsapp") continue;
      const list = waIdsByContact.get(cc.contact_id) ?? [];
      list.push(cc.platform_sender_id);
      waIdsByContact.set(cc.contact_id, list);
    }

    for (const c of contactsRes.data ?? []) {
      const fields = fieldsByContact.get(c.id) ?? [];
      const conversations = convByContact.get(c.id) ?? [];
      const variables: Record<string, string> = {};
      for (const f of fields) variables[f.slug] = f.value;
      if (c.display_name) {
        variables.contact_name = c.display_name;
        variables.first_name = c.display_name.trim().split(/\s+/)[0] ?? "";
      }
      result.set(c.id, {
        contactId: c.id,
        displayName: c.display_name,
        subscribed: c.is_subscribed,
        optInAt: c.opt_in_whatsapp_at,
        phone: pickPhone(fields, waIdsByContact.get(c.id) ?? []),
        phoneOptedOut: false,
        hasWhatsAppInbound: conversations.some((v) => v.platform === "whatsapp" && !!v.lastInboundAt),
        conversations,
        variables,
      });
    }
  }

  // Phone opt-outs, in one pass over the distinct phones.
  const phones = Array.from(new Set(Array.from(result.values()).map((f) => f.phone).filter((p): p is string => !!p)));
  const optedOut = new Set<string>();
  for (const list of chunks(phones)) {
    const { data, error } = await supabase
      .from("phone_opt_outs")
      .select("phone")
      .eq("workspace_id", workspaceId)
      .in("phone", list);
    if (error) throw new Error(`could not load phone opt-outs: ${error.message}`);
    for (const row of data ?? []) optedOut.add(row.phone);
  }
  for (const facts of result.values()) {
    if (facts.phone && optedOut.has(facts.phone)) facts.phoneOptedOut = true;
  }

  return result;
}

/** Build the policy input for one contact on one channel. */
export function policyInputFor(
  facts: ContactFacts,
  channel: ChannelFacts,
  kind: SendKind,
  settings: SendingSettings,
  opts: { now?: number; templateSet?: boolean; quietHours?: boolean } = {}
): PolicyInput {
  const conv = facts.conversations.find((c) => c.channelId === channel.id) ?? null;
  return {
    now: opts.now ?? Date.now(),
    kind,
    platform: channel.platform,
    channelActive: channel.isActive,
    bulkSendingEnabled: settings.bulkSendingEnabled,
    contactSubscribed: facts.subscribed,
    automationPaused: kind === "freeform" ? !!conv?.automationPaused : false,
    hasConversation: !!conv?.lateConversationId,
    lastInboundAt: conv?.lastInboundAt ?? null,
    templateSet: opts.templateSet,
    phone: facts.phone,
    phoneOptedOut: facts.phoneOptedOut,
    requireConsent: settings.requireWhatsAppConsent,
    optInAt: facts.optInAt,
    hasWhatsAppInbound: facts.hasWhatsAppInbound,
    quietHours: opts.quietHours === false ? null : settings.quietHours,
  };
}

/** {{contact_name}}, {{first_name}}, {{<field slug>}}; unknown tokens become empty. */
export function fillPlaceholders(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => variables[key] ?? "");
}

export async function recordAttempt(
  supabase: SB,
  row: {
    workspaceId: string;
    source: "broadcast" | "sequence" | "test";
    sourceId?: string | null;
    contactId?: string | null;
    channelId?: string | null;
    kind?: SendKind | null;
    decision: "sent" | "skipped" | "failed" | "waiting";
    reason?: string | null;
    platformMessageId?: string | null;
    error?: string | null;
  }
) {
  const { error } = await supabase.from("send_attempts").insert({
    workspace_id: row.workspaceId,
    source: row.source,
    source_id: row.sourceId ?? null,
    contact_id: row.contactId ?? null,
    channel_id: row.channelId ?? null,
    kind: row.kind ?? null,
    decision: row.decision,
    reason: row.reason ?? null,
    platform_message_id: row.platformMessageId ?? null,
    error: row.error ? row.error.slice(0, 500) : null,
  });
  // Auditing must never block a send.
  if (error) console.error("send_attempts insert failed:", error.message);
}

