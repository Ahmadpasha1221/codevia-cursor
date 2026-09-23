import { describe, expect, it } from "vitest";
import { parseToolCallsFromText } from "../../../../src/runtime/tools/parseToolCalls";

describe("parseToolCallsFromText", () => {
  it("parses raw JSON tool calls from small models", () => {
    const calls = parseToolCallsFromText(
      `{"name":"write_file","arguments":{"path":"simple.py","content":"print('Hello, World!')"}}`,
    );
    expect(calls).toEqual([
      expect.objectContaining({
        name: "write_file",
        input: { path: "simple.py", content: "print('Hello, World!')" },
      }),
    ]);
  });

  it("parses fenced JSON tool calls", () => {
    const calls = parseToolCallsFromText(
      "```json\n{\"name\":\"write_file\",\"arguments\":{\"path\":\"simple.py\",\"content\":\"x\"}}\n```",
    );
    expect(calls[0]?.name).toBe("write_file");
  });
});
