import { describe, expect, it } from "vitest";
import {
  between, buildFunnel, dailySeries, dayKey, delta, groupOrigins, isRealNewContact, leadTimes,
  mergeFeed, orderedFieldSlugs, parsePeriod, percent, periodWindow, windowStats,
} from "./metrics";

const NOW = new Date("2026-11-28T15:00:00Z"); // 12:00 in Brasília

describe("period", () => {
  it("defaults to 7 days and accepts only known values", () => {
    expect(parsePeriod(undefined)).toBe("7d");
    expect(parsePeriod("lixo")).toBe("7d");
    expect(parsePeriod(["today"])).toBe("today");
    expect(parsePeriod("30d")).toBe("30d");
  });
  it("today starts at Brasília midnight and the previous period has the same length", () => {
    const w = periodWindow("today", NOW);
    expect(w.from.toISOString()).toBe("2026-11-28T03:00:00.000Z");
    expect(w.prevFrom.toISOString()).toBe("2026-11-27T15:00:00.000Z");
    expect(w.prevTo.toISOString()).toBe("2026-11-28T03:00:00.000Z");
    expect(w.days).toBe(1);
  });
  it("7d covers seven Brazilian days including today", () => {
    expect(periodWindow("7d", NOW).from.toISOString()).toBe("2026-11-22T03:00:00.000Z");
  });
  it("between is half-open", () => {
    expect(between("2026-11-28T03:00:00Z", new Date("2026-11-28T03:00:00Z"), NOW)).toBe(true);
    expect(between("2026-11-28T15:00:00Z", new Date("2026-11-28T03:00:00Z"), NOW)).toBe(false);
    expect(between(null, new Date(0), NOW)).toBe(false);
  });
  it("dayKey uses Brasília time", () => {
    expect(dayKey("2026-11-28T01:30:00Z")).toBe("2026-11-27");
    expect(dayKey("2026-11-28T03:00:00Z")).toBe("2026-11-28");
  });
});

describe("people and leads", () => {
  it("tells synced old conversations from people who really arrived", () => {
    expect(isRealNewContact({ created_at: "2026-11-26T12:00:00Z", last_interaction_at: "2026-11-20T10:00:00Z" })).toBe(false);
    expect(isRealNewContact({ created_at: "2026-11-26T12:00:00Z", last_interaction_at: "2026-11-26T12:00:00Z" })).toBe(true);
    expect(isRealNewContact({ created_at: "2026-11-26T12:00:30Z", last_interaction_at: "2026-11-26T12:00:00Z" })).toBe(true);
    expect(isRealNewContact({ created_at: "2026-11-26T12:00:00Z", last_interaction_at: null })).toBe(true);
  });
  it("keeps the earliest time a phone was saved per contact", () => {
    const m = leadTimes([
      { contact_id: "a", updated_at: "2026-11-28T10:00:00Z" },
      { contact_id: "a", updated_at: "2026-11-27T10:00:00Z" },
      { contact_id: "b", updated_at: "2026-11-26T10:00:00Z" },
    ]);
    expect(m.get("a")).toBe("2026-11-27T10:00:00Z");
    expect(m.size).toBe(2);
  });
  it("delta and percent", () => {
    expect(delta(10, 5)).toEqual({ pct: 100, direction: "up" });
    expect(delta(3, 4)).toEqual({ pct: -25, direction: "down" });
    expect(delta(0, 0)).toEqual({ pct: null, direction: "flat" });
    expect(delta(4, 0)).toEqual({ pct: null, direction: "up" });
    expect(delta(5, 5)).toEqual({ pct: 0, direction: "flat" });
    expect(percent(9, 20)).toBe(45);
    expect(percent(1, 0)).toBeNull();
  });
});

describe("series", () => {
  it("buckets by Brazilian day, oldest first, ignoring days outside the range", () => {
    const s = dailySeries(["2026-11-28T10:00:00Z", "2026-11-27T10:00:00Z"], ["2026-11-28T11:00:00Z", "2026-11-01T10:00:00Z"], NOW, 3);
    expect(s.map((p) => p.day)).toEqual(["2026-11-26", "2026-11-27", "2026-11-28"]);
    expect(s.map((p) => p.leads)).toEqual([0, 1, 1]);
    expect(s.map((p) => p.people)).toEqual([0, 0, 1]);
  });
});

describe("funnel", () => {
  const entrants = new Set(["a", "b", "c", "d", "e"]);
  it("counts who reached each stage, who waits and who dropped", () => {
    const f = buildFunnel({
      entrants,
      activeEntrants: new Set(["c", "d"]),
      entryLabel: "Entraram",
      stages: [
        { label: "Nome", contactsWithValue: new Set(["a", "b", "d", "zzz"]) },
        { label: "Telefone", contactsWithValue: new Set(["a"]) },
      ],
    });
    expect(f.map((s) => s.reached)).toEqual([5, 3, 1]);
    expect(f.map((s) => s.pctOfEntrants)).toEqual([100, 60, 20]);
    // c waits right after entering; d waits after giving the name
    expect(f.map((s) => s.waiting)).toEqual([1, 1, 0]);
    // entered 5, 3 gave a name, 1 waits at entry -> 1 dropped; name 3, phone 1, 1 waits -> 1 dropped
    expect(f.map((s) => s.dropped)).toEqual([1, 1, 0]);
  });
  it("handles an empty cohort", () => {
    const f = buildFunnel({ entrants: new Set(), activeEntrants: new Set(), entryLabel: "x", stages: [] });
    expect(f).toEqual([{ label: "x", reached: 0, pctOfEntrants: null, waiting: 0, dropped: 0 }]);
  });
});

describe("origins", () => {
  it("groups comments by post and counts each lead once", () => {
    const rows = groupOrigins(
      [
        { contact_id: "a", metadata: { postId: "p1", isLive: true, dmSent: true } },
        { contact_id: "a", metadata: { postId: "p1", isLive: true, dmSent: false } },
        { contact_id: "b", metadata: { postId: "p1", dmSent: true } },
        { contact_id: "c", metadata: { postId: "p2", dmSent: true } },
        { contact_id: "d", metadata: null },
      ],
      new Set(["a", "c"])
    );
    expect(rows).toEqual([
      { postId: "p1", isLive: true, comments: 3, dms: 2, leads: 1 },
      { postId: "p2", isLive: false, comments: 1, dms: 1, leads: 1 },
    ]);
  });
});

describe("24h window", () => {
  it("counts open windows and those closing soon, per platform", () => {
    const s = windowStats(
      [
        { platform: "instagram", last_inbound_at: "2026-11-28T14:00:00Z" },
        { platform: "instagram", last_inbound_at: "2026-11-27T20:00:00Z" }, // 19h ago: closes in 5h
        { platform: "whatsapp", last_inbound_at: "2026-11-27T14:00:00Z" }, // 25h ago: closed
        { platform: "instagram", last_inbound_at: null },
      ],
      NOW
    );
    expect(s).toEqual({ open: 2, closingSoon: 1, byPlatform: { instagram: 2 } });
  });
});

describe("feed", () => {
  it("sorts newest first and caps the list", () => {
    const f = mergeFeed(
      [
        { kind: "lead", at: "2026-11-28T10:00:00Z", contactName: "A" },
        { kind: "message_failed", at: "2026-11-28T12:00:00Z", contactName: null },
        { kind: "new_person", at: "2026-11-28T11:00:00Z", contactName: "B" },
      ],
      2
    );
    expect(f.map((i) => i.kind)).toEqual(["message_failed", "new_person"]);
  });
});

describe("flow stages", () => {
  const nodes = [
    { id: "t", type: "trigger" },
    { id: "m", type: "sendMessage" },
    { id: "n", type: "setCustomField", data: { fieldSlug: "nome_vaga" } },
    { id: "p", type: "action", data: { actionType: "setCustomField", fieldSlug: "telefone_vaga" } },
    { id: "r", type: "setCustomField", data: { fieldSlug: "telefone_vaga" } },
    { id: "orphan", type: "setCustomField", data: { fieldSlug: "cpf" } },
  ];
  const edges = [
    { source: "t", target: "m" },
    { source: "m", target: "n" },
    { source: "n", target: "p" },
    { source: "p", target: "r" },
  ];
  it("lists asked fields in the order people meet them, once each, ignoring unreachable nodes", () => {
    expect(orderedFieldSlugs(nodes, edges)).toEqual(["nome_vaga", "telefone_vaga"]);
  });
  it("copes with missing or malformed graphs", () => {
    expect(orderedFieldSlugs(null, null)).toEqual([]);
    expect(orderedFieldSlugs([{ id: "a", type: "sendMessage" }], [])).toEqual([]);
  });
});
