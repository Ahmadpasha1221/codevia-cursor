import { describe, expect, it } from "vitest";
import { toOpenAiMessages } from "../../../../src/runtime/openaiCompatible/openAiMessages";
import type { ChatTurn } from "../../../../src/runtime/tools/inferenceAgentLoop";

describe("toOpenAiMessages", () => {
  it("serializes tool turns with the exact tool_call_id from the assistant tool call", () => {
    const messages: ChatTurn[] = [
      { role: "system", content: "You are Spider." },
      { role: "user", content: "check what files are in my workspace" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: { name: "list_files", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_123", content: "{\"files\":[\"a.py\"]}" },
    ];

    const wire = toOpenAiMessages(messages);

    expect(wire).toEqual([
      { role: "system", content: "You are Spider." },
      { role: "user", content: "check what files are in my workspace" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: { name: "list_files", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_123", content: "{\"files\":[\"a.py\"]}" },
    ]);
    expect(wire[3]).toMatchObject({ role: "tool", tool_call_id: "call_123" });
  });

  it("maps each parallel tool result to its own tool_call_id", () => {
    const messages: ChatTurn[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "list_files", arguments: "{}" } },
          { id: "call_2", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a.py\"}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "{}" },
      { role: "tool", tool_call_id: "call_2", content: "contents" },
    ];

    const wire = toOpenAiMessages(messages);

    expect(wire[0]).toMatchObject({
      role: "assistant",
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "list_files" } },
        { id: "call_2", type: "function", function: { name: "read_file" } },
      ],
    });
    expect(wire[1]).toMatchObject({ role: "tool", tool_call_id: "call_1" });
    expect(wire[2]).toMatchObject({ role: "tool", tool_call_id: "call_2" });
  });

  it("throws explicitly instead of sending a tool message without tool_call_id", () => {
    const messages: ChatTurn[] = [
      { role: "tool", tool_call_id: "", content: "orphan result" },
    ];

    expect(() => toOpenAiMessages(messages)).toThrow(/tool_call_id/);
  });

  it("keeps plain assistant and user turns untouched", () => {
    const messages: ChatTurn[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello!" },
    ];

    expect(toOpenAiMessages(messages)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello!" },
    ]);
  });
});
