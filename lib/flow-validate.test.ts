import { describe, expect, it } from "vitest";
import { keywordConflicts, prepareGraph, triggerKeywords, validateFlow } from "./flow-validate";

const good = () => ({
  nodes: [
    { id: "t", type: "trigger", data: { triggerType: "keyword", keywords: [{ value: "CURSO", matchType: "contains" }] }, position: { x: 0, y: 0 } },
    { id: "m", type: "sendMessage", data: { messages: [{ text: "Oi! Qual seu nome?" }] }, position: { x: 1, y: 0 } },
    { id: "w", type: "smartDelay", data: { timeout: 1, timeoutUnit: "hours" }, position: { x: 2, y: 0 } },
    { id: "s", type: "setCustomField", data: { fieldSlug: "nome", value: "{{message}}" }, position: { x: 3, y: 0 } },
  ],
  edges: [
    { id: "1", source: "t", target: "m" }, { id: "2", source: "m", target: "w" }, { id: "3", source: "w", target: "s" },
  ],
});
const codes = (r: ReturnType<typeof validateFlow>) => [...r.errors, ...r.warnings].map((i) => i.code);

describe("validateFlow", () => {
  it("accepts a well-formed flow", () => {
    const g = good();
    const r = validateFlow(g.nodes, g.edges, { fieldTypes: new Map([["nome", "text"]]) });
    expect(r.valid).toBe(true);
    expect(r.structural).toBe(false);
    expect(r.warnings).toEqual([]);
  });
  it("accepts the editor shape (action nodes)", () => {
    const g = good();
    g.nodes[3] = { id: "s", type: "action", data: { actionType: "setCustomField", fieldSlug: "nome", value: "x" }, position: { x: 3, y: 0 } } as never;
    expect(validateFlow(g.nodes, g.edges).valid).toBe(true);
  });
  it("flags structural problems", () => {
    expect(validateFlow("x", []).structural).toBe(true);
    const g = good();
    expect(validateFlow(g.nodes, [...g.edges, { id: "9", source: "m", target: "ghost" }]).structural).toBe(true);
    expect(validateFlow([...g.nodes, { id: "t", type: "trigger" }], g.edges).structural).toBe(true);
    expect(validateFlow([...g.nodes, { id: "z", type: "banana" }], g.edges).structural).toBe(true);
  });
  it("requires a connected trigger", () => {
    const g = good();
    expect(codes(validateFlow(g.nodes.slice(1), []))).toContain("no_trigger");
    expect(codes(validateFlow(g.nodes, []))).toContain("trigger_no_next");
  });
  it("checks outputs per node type", () => {
    const g = good();
    // a plain message has no named outputs
    const r = validateFlow(g.nodes, [...g.edges, { id: "4", source: "m", target: "s", sourceHandle: "invalid" }]);
    expect(codes(r)).toContain("invalid_handle");
  });
  it("allows the invalid and timeout outputs where they exist", () => {
    const g = good();
    g.nodes.push({ id: "e", type: "sendMessage", data: { messages: [{ text: "Tente de novo" }] }, position: { x: 4, y: 0 } });
    const r = validateFlow(g.nodes, [...g.edges, { id: "4", source: "s", target: "e", sourceHandle: "invalid" }, { id: "5", source: "w", target: "e", sourceHandle: "timeout" }]);
    expect(codes(r)).not.toContain("invalid_handle");
  });
  it("catches a loop with no wait but allows one with a wait", () => {
    const g = good();
    const loop = [...g.edges, { id: "4", source: "s", target: "m" }];
    expect(codes(validateFlow(g.nodes, loop))).not.toContain("loop_without_wait"); // m→w→s→m has a smartDelay
    const nodes = [
      { id: "t", type: "trigger", data: { triggerType: "welcome" }, position: { x: 0, y: 0 } },
      { id: "a", type: "sendMessage", data: { messages: [{ text: "a" }] }, position: { x: 0, y: 0 } },
      { id: "b", type: "sendMessage", data: { messages: [{ text: "b" }] }, position: { x: 0, y: 0 } },
    ];
    const r = validateFlow(nodes, [{ source: "t", target: "a" }, { source: "a", target: "b" }, { source: "b", target: "a" }]);
    expect(codes(r)).toContain("loop_without_wait");
  });
  it("checks references only when the workspace facts are given", () => {
    const g = good();
    expect(codes(validateFlow(g.nodes, g.edges))).not.toContain("field_not_found");
    expect(codes(validateFlow(g.nodes, g.edges, { fieldTypes: new Map() }))).toContain("field_not_found");
    const tag = [...g.nodes, { id: "x", type: "addTag", data: { tagName: "Novo" }, position: { x: 0, y: 0 } }];
    const r = validateFlow(tag, [...g.edges, { id: "8", source: "s", target: "x" }], { tagNames: new Set(), fieldTypes: new Map([["nome", "text"]]) });
    expect(r.warnings.map((w) => w.code)).toContain("tag_not_found");
    expect(r.valid).toBe(true);
  });
  it("warns about orphans, empty keywords and missing positions", () => {
    const g = good();
    const nodes = [...g.nodes, { id: "o", type: "sendMessage", data: { messages: [{ text: "x" }] } }];
    const r = validateFlow(nodes, g.edges);
    expect(codes(r)).toContain("orphan_node");
    expect(codes(r)).toContain("no_position");
    const empty = [{ ...g.nodes[0], data: { triggerType: "keyword", keywords: [] } }, ...g.nodes.slice(1)];
    expect(codes(validateFlow(empty, g.edges))).toContain("trigger_no_keywords");
  });
  it("validates node content", () => {
    const nodes = [
      { id: "t", type: "trigger", data: { triggerType: "keyword", keywords: ["x"] }, position: { x: 0, y: 0 } },
      { id: "m", type: "sendMessage", data: { messages: [] }, position: { x: 0, y: 0 } },
      { id: "d", type: "delay", data: { duration: 0, unit: "weeks" }, position: { x: 0, y: 0 } },
      { id: "h", type: "httpRequest", data: { url: "ftp://x" }, position: { x: 0, y: 0 } },
      { id: "c", type: "condition", data: { conditions: [] }, position: { x: 0, y: 0 } },
    ];
    const edges = [{ source: "t", target: "m" }, { source: "m", target: "d" }, { source: "d", target: "h" }, { source: "h", target: "c" }];
    const c = codes(validateFlow(nodes, edges));
    for (const k of ["message_empty", "delay_invalid", "http_bad_url", "condition_empty"]) expect(c).toContain(k);
  });
});

describe("keywords and graph preparation", () => {
  it("finds keywords other flows already answer", () => {
    const mine = triggerKeywords(good().nodes);
    expect(mine).toEqual([{ triggerType: "keyword", keyword: "curso" }]);
    const conflicts = keywordConflicts(mine, [
      { flowName: "CURSO · captura", triggerType: "keyword", keyword: "curso" },
      { flowName: "Outro", triggerType: "comment_keyword", keyword: "curso" },
    ]);
    expect(conflicts.map((c) => c.flowName)).toEqual(["CURSO · captura"]);
  });
  it("lays out nodes and names edges without touching the input", () => {
    const nodes = [{ id: "t", type: "trigger" }, { id: "a", type: "sendMessage", data: { messages: [{ text: "x" }] } }, { id: "b", type: "sendMessage", position: { x: 5, y: 6 } }];
    const edges = [{ source: "t", target: "a" }, { source: "t", target: "b", sourceHandle: "x" }];
    const p = prepareGraph(nodes, edges);
    expect(p.nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(p.nodes[1].position).toEqual({ x: 320, y: 0 });
    expect(p.nodes[2].position).toEqual({ x: 5, y: 6 });
    expect(p.nodes[0].data).toEqual({});
    expect(p.edges.map((e) => e.id)).toEqual(["e_t_out_a", "e_t_x_b"]);
    expect((nodes[0] as Record<string, unknown>).position).toBe(undefined);
  });
});
