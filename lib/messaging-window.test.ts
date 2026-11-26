import { describe, expect, it } from "vitest";
import { insideMessagingWindow, messagingWindowState } from "./messaging-window";

const NOW = new Date("2026-11-26T18:00:00Z").getTime();
const hoursAgo = (h: number) => new Date(NOW - h * 3600 * 1000).toISOString();

describe("insideMessagingWindow", () => {
  it("allows automated messages within 24 hours of the contact's last message", () => {
    expect(insideMessagingWindow("instagram", hoursAgo(23), NOW)).toBe(true);
    expect(insideMessagingWindow("instagram", hoursAgo(25), NOW)).toBe(false);
    expect(insideMessagingWindow("facebook", hoursAgo(30), NOW)).toBe(false);
  });

  it("does not block when the last message is unknown or the platform has no window", () => {
    expect(insideMessagingWindow("instagram", null, NOW)).toBe(true);
    expect(insideMessagingWindow("telegram", hoursAgo(100), NOW)).toBe(true);
  });
});

describe("messagingWindowState", () => {
  it("is open inside 24 hours, human-only up to 7 days, then closed", () => {
    expect(messagingWindowState("instagram", hoursAgo(2), NOW)).toMatchObject({ kind: "open" });
    expect(messagingWindowState("instagram", hoursAgo(48), NOW)).toMatchObject({ kind: "human" });
    expect(messagingWindowState("instagram", hoursAgo(24 * 8), NOW)).toEqual({ kind: "closed" });
    expect(messagingWindowState("whatsapp", hoursAgo(48), NOW)).toEqual({ kind: "none" });
  });
});
