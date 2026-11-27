/**
 * Sending settings stored in workspaces.settings (jsonb). Parsed defensively:
 * a missing or malformed value falls back to the default.
 */

export interface SendingSettings {
  /** Template sends need a recorded WhatsApp opt-in (or an earlier WhatsApp message). */
  requireWhatsAppConsent: boolean;
  /** Broadcasts and sequence steps only go out in this period. null = any hour. */
  quietHours: { start: string; end: string; timeZone: string } | null;
  /** Broadcasts to more recipients than this need a typed confirmation. */
  confirmThreshold: number;
  /** Emergency switch: false stops every broadcast and sequence send. */
  bulkSendingEnabled: boolean;
  /** Sent after SAIR/STOP; empty = no reply. */
  optOutReply: string;
}

export const DEFAULT_SENDING_SETTINGS: SendingSettings = {
  requireWhatsAppConsent: false,
  quietHours: { start: "08:00", end: "20:00", timeZone: "America/Fortaleza" },
  confirmThreshold: 50,
  bulkSendingEnabled: true,
  optOutReply:
    "Pronto, você não vai mais receber nossas mensagens automáticas. Se mudar de ideia, é só responder VOLTAR.",
};

const HM = /^([01]?\d|2[0-4]):[0-5]\d$/;

export function parseSendingSettings(raw: unknown): SendingSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SENDING_SETTINGS;

  let quietHours = d.quietHours;
  if (s.quiet_hours === null || s.quiet_hours === false) {
    quietHours = null;
  } else if (s.quiet_hours && typeof s.quiet_hours === "object") {
    const q = s.quiet_hours as Record<string, unknown>;
    const start = typeof q.start === "string" && HM.test(q.start) ? q.start : d.quietHours!.start;
    const end = typeof q.end === "string" && HM.test(q.end) ? q.end : d.quietHours!.end;
    const timeZone = typeof q.timeZone === "string" && q.timeZone ? q.timeZone : d.quietHours!.timeZone;
    quietHours = { start, end, timeZone };
  }

  const threshold = Number(s.confirm_threshold);

  return {
    requireWhatsAppConsent:
      typeof s.require_whatsapp_consent === "boolean" ? s.require_whatsapp_consent : d.requireWhatsAppConsent,
    quietHours,
    confirmThreshold: Number.isFinite(threshold) && threshold >= 1 ? Math.floor(threshold) : d.confirmThreshold,
    bulkSendingEnabled:
      typeof s.bulk_sending_enabled === "boolean" ? s.bulk_sending_enabled : d.bulkSendingEnabled,
    optOutReply: typeof s.opt_out_reply === "string" ? s.opt_out_reply : d.optOutReply,
  };
}

/** Back to the stored (snake_case) shape, merged over what is already stored. */
export function serializeSendingSettings(
  current: unknown,
  next: SendingSettings
): Record<string, unknown> {
  const base = (current && typeof current === "object" ? current : {}) as Record<string, unknown>;
  return {
    ...base,
    require_whatsapp_consent: next.requireWhatsAppConsent,
    quiet_hours: next.quietHours,
    confirm_threshold: next.confirmThreshold,
    bulk_sending_enabled: next.bulkSendingEnabled,
    opt_out_reply: next.optOutReply,
  };
}

export function isValidHm(value: string): boolean {
  return HM.test(value);
}
