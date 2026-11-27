import { describe, expect, it } from "vitest";
import {
  checkEligibility,
  classifySendError,
  decideSend,
  insideWindow,
  localMinutes,
  nextAllowedTime,
  type PolicyInput,
} from "./send-policy";

// 2026-11-26 15:00 in Fortaleza (UTC-3) = 18:00 UTC
const NOW = Date.UTC(2026, 10, 26, 18, 0, 0);
const HOUR = 60 * 60 * 1000;

function input(over: Partial<PolicyInput> = {}): PolicyInput {
  return {
    now: NOW,
    kind: "freeform",
    platform: "instagram",
    channelActive: true,
    bulkSendingEnabled: true,
    contactSubscribed: true,
    automationPaused: false,
    hasConversation: true,
    lastInboundAt: new Date(NOW - 2 * HOUR).toISOString(),
    templateSet: true,
    phone: null,
    phoneOptedOut: false,
    requireConsent: false,
    optInAt: null,
    hasWhatsAppInbound: false,
    quietHours: null,
    ...over,
  };
}

describe("insideWindow", () => {
  it("is open just inside 24h and closed just outside", () => {
    expect(insideWindow("instagram", new Date(NOW - 23 * HOUR - 59 * 60_000).toISOString(), NOW)).toBe(true);
    expect(insideWindow("instagram", new Date(NOW - 24 * HOUR - 60_000).toISOString(), NOW)).toBe(false);
  });
  it("treats an unknown last message as closed", () => {
    expect(insideWindow("instagram", null, NOW)).toBe(false);
    expect(insideWindow("whatsapp", "not a date", NOW)).toBe(false);
  });
  it("applies to WhatsApp too", () => {
    expect(insideWindow("whatsapp", new Date(NOW - 30 * HOUR).toISOString(), NOW)).toBe(false);
  });
  it("does not limit platforms without a window", () => {
    expect(insideWindow("telegram", null, NOW)).toBe(true);
  });
});

describe("checkEligibility — free-form", () => {
  it("sends inside the window", () => {
    expect(checkEligibility(input())).toEqual({ action: "send" });
  });
  it("skips outside the window", () => {
    expect(checkEligibility(input({ lastInboundAt: new Date(NOW - 25 * HOUR).toISOString() }))).toEqual({
      action: "skip",
      reason: "window_closed",
    });
  });
  it("skips without a conversation", () => {
    expect(checkEligibility(input({ hasConversation: false }))).toMatchObject({ reason: "no_conversation" });
  });
  it("never sends to an unsubscribed contact", () => {
    expect(checkEligibility(input({ contactSubscribed: false }))).toMatchObject({ reason: "unsubscribed" });
  });
  it("respects human takeover, inactive channel and the emergency switch", () => {
    expect(checkEligibility(input({ automationPaused: true }))).toMatchObject({ reason: "human_takeover" });
    expect(checkEligibility(input({ channelActive: false }))).toMatchObject({ reason: "channel_inactive" });
    expect(checkEligibility(input({ bulkSendingEnabled: false }))).toMatchObject({ reason: "bulk_disabled" });
  });
});

describe("checkEligibility — WhatsApp template", () => {
  const tpl = (over: Partial<PolicyInput> = {}) =>
    input({ kind: "template", platform: "whatsapp", hasConversation: false, lastInboundAt: null, phone: "5585999990000", ...over });

  it("sends a template outside the window", () => {
    expect(checkEligibility(tpl())).toEqual({ action: "send" });
  });
  it("needs a phone", () => {
    expect(checkEligibility(tpl({ phone: null }))).toMatchObject({ reason: "no_phone" });
  });
  it("blocks an opted-out phone", () => {
    expect(checkEligibility(tpl({ phoneOptedOut: true }))).toMatchObject({ reason: "phone_opted_out" });
  });
  it("needs a template", () => {
    expect(checkEligibility(tpl({ templateSet: false }))).toMatchObject({ reason: "template_not_set" });
  });
  it("ignores consent when the workspace does not require it", () => {
    expect(checkEligibility(tpl({ requireConsent: false, optInAt: null }))).toEqual({ action: "send" });
  });
  it("requires opt-in or an earlier WhatsApp message when consent is required", () => {
    expect(checkEligibility(tpl({ requireConsent: true }))).toMatchObject({ reason: "no_consent" });
    expect(checkEligibility(tpl({ requireConsent: true, optInAt: "2026-11-20T10:00:00Z" }))).toEqual({ action: "send" });
    expect(checkEligibility(tpl({ requireConsent: true, hasWhatsAppInbound: true }))).toEqual({ action: "send" });
  });
  it("still never sends to an unsubscribed contact", () => {
    expect(checkEligibility(tpl({ contactSubscribed: false }))).toMatchObject({ reason: "unsubscribed" });
  });
});

describe("quiet hours", () => {
  const quiet = { start: "08:00", end: "20:00", timeZone: "America/Fortaleza" };

  it("reads local time in the time zone", () => {
    expect(localMinutes(NOW, "America/Fortaleza")).toBe(15 * 60);
  });
  it("allows sending inside the period", () => {
    expect(nextAllowedTime(NOW, quiet)).toBeNull();
  });
  it("waits until 08:00 the next day after 20:00", () => {
    const night = Date.UTC(2026, 10, 26, 23 + 0, 30); // 20:30 local
    const until = nextAllowedTime(night, quiet)!;
    expect(until.toISOString()).toBe("2026-11-27T11:00:00.000Z"); // 08:00 local
  });
  it("waits until 08:00 the same day in the early morning", () => {
    const early = Date.UTC(2026, 10, 27, 9, 15); // 06:15 local
    expect(nextAllowedTime(early, quiet)!.toISOString()).toBe("2026-11-27T11:00:00.000Z");
  });
  it("supports periods that cross midnight", () => {
    const overnight = { start: "22:00", end: "06:00", timeZone: "America/Fortaleza" };
    expect(nextAllowedTime(Date.UTC(2026, 10, 27, 2, 0), overnight)).toBeNull(); // 23:00 local
    expect(nextAllowedTime(NOW, overnight)!.toISOString()).toBe("2026-11-27T01:00:00.000Z"); // 22:00 local
  });
  it("ignores an invalid setting", () => {
    expect(nextAllowedTime(NOW, { start: "x", end: "20:00", timeZone: "America/Fortaleza" })).toBeNull();
    expect(nextAllowedTime(NOW, { start: "08:00", end: "20:00", timeZone: "Nowhere/City" })).toBeNull();
  });
  it("decideSend waits only after eligibility passes", () => {
    const night = Date.UTC(2026, 10, 26, 23, 30);
    const base = input({ now: night, lastInboundAt: new Date(night - HOUR).toISOString(), quietHours: quiet });
    expect(decideSend(base)).toMatchObject({ action: "wait", reason: "quiet_hours" });
    expect(decideSend({ ...base, contactSubscribed: false })).toMatchObject({ action: "skip", reason: "unsubscribed" });
  });
});

describe("classifySendError", () => {
  it("retries rate limits, server errors and network failures", () => {
    expect(classifySendError(429, "Too many requests").temporary).toBe(true);
    expect(classifySendError(502, "Bad gateway").temporary).toBe(true);
    expect(classifySendError(null, "fetch failed").temporary).toBe(true);
  });
  it("does not retry other client errors", () => {
    expect(classifySendError(400, "Invalid template").temporary).toBe(false);
  });
  it("maps Meta re-engagement errors to window_closed", () => {
    expect(classifySendError(400, "(#131047) Re-engagement message")).toMatchObject({
      temporary: false,
      reason: "window_closed",
    });
    expect(classifySendError(400, "This message is sent outside of allowed window.").reason).toBe("window_closed");
  });
});
