import { describe, expect, it } from "vitest";
import { runInferenceAgentLoop, MAX_INVALID_TOOL_RETRIES, type ChatCompletion, type ChatTurn, type CompleteChat } from "../../../../src/runtime/tools/inferenceAgentLoop";
import type { RuntimeEvent, RuntimeSendRequest } from "../../../../src/runtime/runtimeTypes";

function makeRequest(overrides: Partial<RuntimeSendRequest> = {}): RuntimeSendRequest {
  return {
    sessionId: "s1",
    workspacePath: ".",
    prompt: "do something",
    signal: new AbortController().signal,
    onToolCall: async () => ({ allowed: true, result: { success: true } }),
    ...overrides,
  };
}

function runWithEmitter(
  request: RuntimeSendRequest,
  history: ChatTurn[],
  completeChat: CompleteChat,
): Promise<{ events: RuntimeEvent[] }> {
  const events: RuntimeEvent[] = [];
  const emit = async (event: RuntimeEvent): Promise<void> => {
    events.push(event);
  };
  return runInferenceAgentLoop(request, history, completeChat, emit, { nativeTools: false }).then(() => ({ events }));
}

describe("inference agent loop invalid-tool recovery", () => {
  it("recovers when the model hallucinates a tool name, then calls a valid tool", async () => {
    const completions: ChatCompletion[] = [
      { content: '{"name":"execute","arguments":{}}' },
      { content: '{"name":"write_file","arguments":{"path":"test.txt","content":"Hello"}}' },
      { content: '{"name":"finish","arguments":{"summary":"Created test.txt"}}' },
    ];
    let call = 0;
    const completeChat: CompleteChat = async () => completions[Math.min(call++, completions.length - 1)];

    const toolCalls: string[] = [];
    const request = makeRequest({
      onToolCall: async (toolCall) => {
        toolCalls.push(toolCall.name);
        return { allowed: true, result: { success: true, ...(toolCall.name === "finish" ? { summary: "Created test.txt" } : {}) }, finished: toolCall.name === "finish" };
      },
    });

    const { events } = await runWithEmitter(request, [], completeChat);

    expect(toolCalls).toEqual(["write_file", "finish"]);
    const thinking = events.filter((event) => event.type === "thinking").map((event) => (event.type === "thinking" ? event.message : ""));
    expect(thinking.some((message) => message.includes("Unknown tool"))).toBe(true);
    expect(thinking.some((message) => message.includes("Creating test.txt"))).toBe(true);
    const assistant = events.filter((event) => event.type === "assistant_message").map((event) => (event.type === "assistant_message" ? event.message : ""));
    expect(assistant).toEqual(["Created test.txt"]);
    expect(assistant.join("\n")).not.toContain('"name"');
  });

  it("stops with a useful message after exceeding the invalid-tool retry budget", async () => {
    const completeChat: CompleteChat = async () => ({ content: '{"name":"chat","arguments":{}}' });

    const toolCalls: string[] = [];
    const request = makeRequest({
      onToolCall: async (toolCall) => {
        toolCalls.push(toolCall.name);
        return { allowed: true };
      },
    });

    const { events } = await runWithEmitter(request, [], completeChat);

    expect(toolCalls).toHaveLength(0);
    const assistant = events.filter((event) => event.type === "assistant_message").map((event) => (event.type === "assistant_message" ? event.message : ""));
    expect(assistant).toHaveLength(1);
    expect(assistant[0]).toContain("not available");
    expect(assistant[0]).not.toContain("{");
  });

  it("respects MAX_INVALID_TOOL_RETRIES bounds", async () => {
    expect(MAX_INVALID_TOOL_RETRIES).toBeGreaterThan(0);
    expect(MAX_INVALID_TOOL_RETRIES).toBeLessThanOrEqual(3);
  });

  it("treats plain conversation as a direct response with no tools", async () => {
    const completeChat: CompleteChat = async () => ({ content: "Hello! How can I help?" });
    const request = makeRequest();
    const { events } = await runWithEmitter(request, [], completeChat);

    const assistant = events.filter((event) => event.type === "assistant_message");
    expect(assistant).toHaveLength(1);
    expect((assistant[0] as { message: string }).message).toBe("Hello! How can I help?");
  });

  it("emits safe progress messages for each lifecycle step", async () => {
    const completions: ChatCompletion[] = [
      { content: '{"name":"read_file","arguments":{"path":"hello.py"}}' },
      { content: '{"name":"finish","arguments":{"summary":"done"}}' },
    ];
    let call = 0;
    const completeChat: CompleteChat = async () => completions[Math.min(call++, completions.length - 1)];
    const request = makeRequest({
      onToolCall: async () => ({ allowed: true, result: { success: true, content: "print('hi')" } }),
    });

    const { events } = await runWithEmitter(request, [], completeChat);
    const thinking = events.filter((event) => event.type === "thinking").map((event) => (event.type === "thinking" ? event.message : ""));
    expect(thinking).toContain("Reading hello.py…");
    expect(thinking).toContain("Checking the result…");
    expect(thinking).toContain("Finishing…");
  });
});
