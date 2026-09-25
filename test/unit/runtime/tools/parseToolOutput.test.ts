import { describe, expect, it } from "vitest";
import { parseToolOutputFromText } from "../../../../src/runtime/tools/parseToolCalls";

describe("parseToolOutputFromText", () => {
  it("classifies a valid tool call", () => {
    const output = parseToolOutputFromText('{"name":"write_file","arguments":{"path":"test.txt","content":"Hi"}}');
    expect(output.calls).toHaveLength(1);
    expect(output.calls[0]).toMatchObject({ name: "write_file", input: { path: "test.txt", content: "Hi" } });
    expect(output.invalid).toHaveLength(0);
  });

  it("classifies hallucinated tool names as invalid, not calls", () => {
    for (const name of ["chat", "question", "execute", "create_file", "shell"]) {
      const output = parseToolOutputFromText(`{"name":"${name}","arguments":{}}`);
      expect(output.calls).toHaveLength(0);
      expect(output.invalid).toHaveLength(1);
      expect(output.invalid[0].name).toBe(name);
    }
  });

  it("does not treat ordinary JSON as a tool", () => {
    const output = parseToolOutputFromText('{"type":"chat","text":"hello"}');
    expect(output.calls).toHaveLength(0);
    expect(output.invalid).toHaveLength(0);
  });

  it("returns nothing for plain assistant text", () => {
    const output = parseToolOutputFromText("Hello! How can I help you today?");
    expect(output.calls).toHaveLength(0);
    expect(output.invalid).toHaveLength(0);
  });

  it("prefers structured blocks: a valid fenced call is used and stray JSON is ignored", () => {
    const text = '```json\n{"name":"read_file","arguments":{"path":"a.py"}}\n```\nthen {"name":"execute","arguments":{}}';
    const output = parseToolOutputFromText(text);
    expect(output.calls.map((call) => call.name)).toEqual(["read_file"]);
    expect(output.calls).toHaveLength(1);
  });

  it("classifies an invalid tool that appears alone in a fenced block", () => {
    const output = parseToolOutputFromText('```json\n{"name":"execute","arguments":{}}\n```');
    expect(output.calls).toHaveLength(0);
    expect(output.invalid.map((mention) => mention.name)).toEqual(["execute"]);
  });

  it("handles native-style tool call objects", () => {
    const output = parseToolOutputFromText('{"type":"chat","message":{"role":"assistant","content":"x"}}');
    expect(output.calls).toHaveLength(0);
  });
});
