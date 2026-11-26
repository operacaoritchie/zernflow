"use server";

import { revalidatePath } from "next/cache";
import { getT } from "@/lib/i18n/server";
import { getWorkspace } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types/database";
import {
  isValidHm,
  parseSendingSettings,
  serializeSendingSettings,
  type SendingSettings,
} from "@/lib/workspace-settings";

export async function updateSendingSettings(next: SendingSettings) {
  const t = await getT("errors");
  const { workspace, role } = await getWorkspace();
  if (role !== "owner" && role !== "admin") return { error: t("noPermission") };

  if (next.quietHours) {
    const { start, end, timeZone } = next.quietHours;
    if (!isValidHm(start) || !isValidHm(end) || start === end) return { error: t("invalidQuietHours") };
    try {
      new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
    } catch {
      return { error: t("invalidQuietHours") };
    }
  }

  const clean: SendingSettings = {
    requireWhatsAppConsent: !!next.requireWhatsAppConsent,
    quietHours: next.quietHours,
    confirmThreshold: Math.max(1, Math.min(100000, Math.floor(Number(next.confirmThreshold) || 50))),
    bulkSendingEnabled: !!next.bulkSendingEnabled,
    optOutReply: String(next.optOutReply ?? "").slice(0, 640),
  };

  // workspaces has no member UPDATE policy for this column path; the role
  // check above is the guard, the write goes through the service role.
  const service = await createServiceClient();
  const { data: current } = await service.from("workspaces").select("settings").eq("id", workspace.id).single();
  const { error } = await service
    .from("workspaces")
    .update({ settings: serializeSendingSettings(current?.settings, clean) as unknown as Json })
    .eq("id", workspace.id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/settings");
  return { ok: true, settings: parseSendingSettings(serializeSendingSettings(current?.settings, clean)) };
}
