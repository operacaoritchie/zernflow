/**
 * Opt-out / opt-back-in. A contact who says SAIR is unsubscribed AND every
 * phone known for them is blocked, so the same person reached through another
 * contact (Instagram profile vs. WhatsApp number) is blocked too.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { loadContactFacts } from "@/lib/send-context";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-templates";

type SB = SupabaseClient<Database>;

async function phonesOf(supabase: SB, workspaceId: string, contactId: string): Promise<string[]> {
  const phones = new Set<string>();
  const facts = (await loadContactFacts(supabase, workspaceId, [contactId])).get(contactId);
  if (facts?.phone) phones.add(facts.phone);

  // Every phone-typed field, not only the preferred one.
  const { data } = await supabase
    .from("contact_custom_fields")
    .select("value, custom_field_definitions(type)")
    .eq("contact_id", contactId);
  for (const f of (data ?? []) as Array<{ value: string; custom_field_definitions: { type: string } | null }>) {
    if (f.custom_field_definitions?.type !== "phone") continue;
    const p = normalizeWhatsAppPhone(f.value);
    if (p) phones.add(p);
  }
  return Array.from(phones);
}

export async function optOutContact(supabase: SB, workspaceId: string, contactId: string, reason: string) {
  await supabase
    .from("contacts")
    .update({ is_subscribed: false, opt_out_at: new Date().toISOString(), opt_out_reason: reason })
    .eq("id", contactId);

  const phones = await phonesOf(supabase, workspaceId, contactId);
  if (phones.length) {
    await supabase
      .from("phone_opt_outs")
      .upsert(
        phones.map((phone) => ({ workspace_id: workspaceId, phone, reason })),
        { onConflict: "workspace_id,phone", ignoreDuplicates: true }
      );
  }

  // Running sequences stop now instead of at their next step.
  await supabase
    .from("sequence_enrollments")
    .update({ status: "exited", exit_reason: "unsubscribed", next_step_at: null })
    .eq("contact_id", contactId)
    .in("status", ["active", "paused_window"]);
}

export async function optInContact(supabase: SB, workspaceId: string, contactId: string) {
  await supabase
    .from("contacts")
    .update({ is_subscribed: true, opt_out_at: null, opt_out_reason: null })
    .eq("id", contactId);

  const phones = await phonesOf(supabase, workspaceId, contactId);
  if (phones.length) {
    await supabase.from("phone_opt_outs").delete().eq("workspace_id", workspaceId).in("phone", phones);
  }
}
