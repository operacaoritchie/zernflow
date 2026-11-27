/**
 * The send policy ("porteiro"): one place that decides whether a broadcast or
 * sequence message may go out to a contact right now, and why not if it may
 * not. Pure functions only, so every rule is unit-tested.
 *
 * Rules (Meta / WhatsApp, see claude/07-plano-transmissoes-e-sequencias.md):
 * - Free-form messages on Instagram, Facebook and WhatsApp only inside the
 *   24-hour window since the contact's last message. Unknown last message
 *   counts as closed.
 * - Outside the window only an approved WhatsApp template, sent to a phone.
 * - Opted-out contacts and opted-out phone numbers never get anything.
 * - Automations never use the HUMAN_AGENT tag (that is for the inbox only).
 * - Quiet hours postpone, they never drop a message.
 */

export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Platforms whose free-form messages are limited to the 24-hour window. */
export const WINDOW_PLATFORMS = new Set(["instagram", "facebook", "whatsapp"]);

export type SendKind = "freeform" | "template";

export type SkipReason =
  | "unsubscribed" // contact said SAIR/STOP
  | "phone_opted_out" // the phone number said SAIR/STOP (any contact)
  | "window_closed" // free-form outside the 24-hour window
  | "no_conversation" // no conversation on the channel to send into
  | "no_phone" // template needs a valid phone
  | "no_consent" // workspace requires WhatsApp opt-in and there is none
  | "template_not_set" // template send without a template
  | "channel_inactive"
  | "human_takeover" // a person took over the conversation
  | "bulk_disabled"; // emergency switch is off

export interface QuietHours {
  /** "HH:MM", start of the allowed sending period */
  start: string;
  /** "HH:MM", end of the allowed sending period (exclusive) */
  end: string;
  timeZone: string;
}

export interface PolicyInput {
  now: number;
  kind: SendKind;
  /** Platform of the channel the message goes out on. */
  platform: string | null;
  channelActive: boolean;
  bulkSendingEnabled: boolean;
  contactSubscribed: boolean;
  automationPaused: boolean;
  // free-form
  hasConversation: boolean;
  lastInboundAt: string | null;
  // template
  templateSet?: boolean;
  phone: string | null;
  phoneOptedOut: boolean;
  requireConsent: boolean;
  optInAt: string | null;
  /** The contact (or the phone) already wrote to the business on WhatsApp. */
  hasWhatsAppInbound: boolean;
  /** null = send at any hour */
  quietHours: QuietHours | null;
}

export type Decision =
  | { action: "send" }
  | { action: "skip"; reason: SkipReason }
  | { action: "wait"; reason: "quiet_hours"; until: Date };

export function insideWindow(
  platform: string | null,
  lastInboundAt: string | null,
  now: number
): boolean {
  if (!platform || !WINDOW_PLATFORMS.has(platform)) return true;
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  if (Number.isNaN(t)) return false;
  return now - t <= MESSAGING_WINDOW_MS && now >= t - 60_000;
}

/** Eligibility only: who may receive this, ignoring the clock (quiet hours). */
export function checkEligibility(input: PolicyInput): Decision {
  if (!input.bulkSendingEnabled) return { action: "skip", reason: "bulk_disabled" };
  if (!input.channelActive) return { action: "skip", reason: "channel_inactive" };
  if (!input.contactSubscribed) return { action: "skip", reason: "unsubscribed" };
  if (input.automationPaused) return { action: "skip", reason: "human_takeover" };

  if (input.kind === "freeform") {
    if (!input.hasConversation) return { action: "skip", reason: "no_conversation" };
    if (!insideWindow(input.platform, input.lastInboundAt, input.now)) {
      return { action: "skip", reason: "window_closed" };
    }
    return { action: "send" };
  }

  // template (WhatsApp)
  if (input.templateSet === false) return { action: "skip", reason: "template_not_set" };
  if (!input.phone) return { action: "skip", reason: "no_phone" };
  if (input.phoneOptedOut) return { action: "skip", reason: "phone_opted_out" };
  if (input.requireConsent && !input.optInAt && !input.hasWhatsAppInbound) {
    return { action: "skip", reason: "no_consent" };
  }
  return { action: "send" };
}

/** Full decision: eligibility first, then the clock. */
export function decideSend(input: PolicyInput): Decision {
  const eligibility = checkEligibility(input);
  if (eligibility.action !== "send") return eligibility;
  if (input.quietHours) {
    const until = nextAllowedTime(input.now, input.quietHours);
    if (until) return { action: "wait", reason: "quiet_hours", until };
  }
  return { action: "send" };
}

function parseHm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes since local midnight in a time zone. */
export function localMinutes(now: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/**
 * When sending is not allowed now, the next moment it is (start of the allowed
 * period); null when sending is allowed now or the setting is invalid.
 * Supports periods that cross midnight (e.g. 22:00 to 06:00).
 */
export function nextAllowedTime(now: number, quiet: QuietHours): Date | null {
  const start = parseHm(quiet.start);
  const end = parseHm(quiet.end);
  if (start === null || end === null || start === end) return null;

  let local: number;
  try {
    local = localMinutes(now, quiet.timeZone);
  } catch {
    return null;
  }

  const allowed = start < end ? local >= start && local < end : local >= start || local < end;
  if (allowed) return null;

  let wait = start - local;
  if (wait <= 0) wait += 24 * 60;
  // Land at the start of the minute (seconds of "now" would push past it).
  const base = now - (now % 60_000);
  return new Date(base + wait * 60_000);
}

/** Temporary errors are retried; permanent ones are not. */
export interface SendErrorInfo {
  temporary: boolean;
  /** Mapped skip reason when the platform said the window is closed etc. */
  reason: SkipReason | null;
  message: string;
}

/**
 * Classify a send error from its HTTP status and message.
 * 429 / 5xx / network → temporary. Meta's re-engagement errors → window_closed.
 */
export function classifySendError(status: number | null, message: string): SendErrorInfo {
  const text = (message || "").toLowerCase();
  if (
    text.includes("131047") ||
    text.includes("re-engagement") ||
    text.includes("allowed window") ||
    text.includes("24 hour") ||
    text.includes("24-hour") ||
    text.includes("messaging window")
  ) {
    return { temporary: false, reason: "window_closed", message };
  }
  if (status === null || status === 0) return { temporary: true, reason: null, message };
  if (status === 429 || status === 408 || status >= 500) {
    return { temporary: true, reason: null, message };
  }
  return { temporary: false, reason: null, message };
}

/** Short Portuguese/English-neutral labels are in the UI; this is for logs. */
export const SKIP_REASONS: SkipReason[] = [
  "unsubscribed",
  "phone_opted_out",
  "window_closed",
  "no_conversation",
  "no_phone",
  "no_consent",
  "template_not_set",
  "channel_inactive",
  "human_takeover",
  "bulk_disabled",
];
