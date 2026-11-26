import { describe, expect, it } from "vitest";
import { toEditorNode, toEngineNode } from "./normalize-nodes";

describe("toEngineNode", () => {
  it("turns a builder Smart Delay into an engine smartDelay node", () => {
    const node = {
      id: "n1",
      type: "action",
      position: { x: 0, y: 0 },
      data: { actionType: "smartDelay", timeout: 24, timeoutUnit: "hours" },
    };
    expect(toEngineNode(node)).toMatchObject({
      id: "n1",
      type: "smartDelay",
      data: { timeout: 24, timeoutUnit: "hours" },
    });
  });

  it("turns a builder Set Custom Field into setCustomField", () => {
    const node = {
      id: "n2",
      type: "action",
      data: { actionType: "setCustomField", fieldSlug: "nome_vaga", value: "{{message}}" },
    };
    expect(toEngineNode(node).type).toBe("setCustomField");
  });

  it("fills data.action for builder tag nodes", () => {
    expect(toEngineNode({ type: "action", data: { actionType: "addTag", tagName: "x" } }).data)
      .toMatchObject({ action: "add" });
    expect(toEngineNode({ type: "action", data: { actionType: "removeTag", tagName: "x" } }).data)
      .toMatchObject({ action: "remove" });
  });

  it("keeps engine-shaped and non-action nodes unchanged", () => {
    const wait = { type: "smartDelay", data: { timeout: 1 } };
    const msg = { type: "sendMessage", data: { messages: [] } };
    expect(toEngineNode(wait)).toBe(wait);
    expect(toEngineNode(msg)).toBe(msg);
  });

  it("leaves an action node with an unknown actionType alone", () => {
    const odd = { type: "action", data: { actionType: "nope" } };
    expect(toEngineNode(odd)).toBe(odd);
  });
});

describe("toEditorNode", () => {
  it("turns an engine smartDelay node into the builder action shape", () => {
    expect(toEditorNode({ id: "w", type: "smartDelay", data: { label: "Espera" } })).toMatchObject({
      type: "action",
      data: { label: "Espera", actionType: "smartDelay" },
    });
  });

  it("round-trips back to the engine shape", () => {
    const original = { id: "f", type: "setCustomField", data: { fieldSlug: "a", value: "b" } };
    expect(toEngineNode(toEditorNode(original))).toMatchObject(original);
  });

  it("keeps non-action nodes unchanged", () => {
    const trig = { type: "trigger", data: {} };
    expect(toEditorNode(trig)).toBe(trig);
  });
});
