import { describe, expect, it } from "vitest";
import { runInferenceAgentLoop, type ChatCompletion, type ChatTurn, type CompleteChat } from "../../../../src/runtime/tools/inferenceAgentLoop";
import { stripToolCallMarkup } from "../../../../src/runtime/tools/localToolDefinitions";
import { createStreamGate } from "../../../../src/runtime/ollama/ollamaRuntime";
import type { RuntimeEvent, RuntimeSendRequest } from "../../../../src/runtime/runtimeTypes";

function makeRequest(onToolCall: RuntimeSendRequest["onToolCall"]): RuntimeSendRequest {
  return {
    sessionId: "s1",
    workspacePath: ".",
    prompt: "do it",
    signal: new AbortController().signal,
    onToolCall,
  };
}

async function run(
  request: RuntimeSendRequest,
  history: ChatTurn[],
  completeChat: CompleteChat,
): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  await runInferenceAgentLoop(request, history, completeChat, async (event) => {
    events.push(event);
  }, { nativeTools: false });
  return events;
}

describe("phase 1: thinking/tool-event safety", () => {
  it("never emits raw tool JSON in thinking or assistant events", async () => {
    const completions: ChatCompletion[] = [
      { content: '{"name":"write_file","arguments":{"path":"README.md","content":"test"}}' },
      { content: '{"name":"finish","arguments":{"summary":"README.md was created successfully."}}' },
    ];
    let call = 0;
    const completeChat: CompleteChat = async () => completions[Math.min(call++, completions.length - 1)];
    const request = makeRequest(async (toolCall) => ({
      allowed: true,
      result: { success: true, ...(toolCall.name === "finish" ? { summary: "README.md was created successfully." } : {}) },
      finished: toolCall.name === "finish",
    }));

    const events = await run(request, [], completeChat);

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('"name":"write_file","arguments"');
    expect(serialized).not.toContain('{"name":"finish"');
    const thinking = events.filter((event) => event.type === "thinking").map((event) => (event.type === "thinking" ? event.message : ""));
    expect(thinking.some((message) => message.includes("Creating README.md…"))).toBe(true);
    expect(thinking.every((message) => !message.trimStart().startsWith("{"))).toBe(true);
  });

  it("emits Finishing… and nothing after the finish result", async () => {
    const completions: ChatCompletion[] = [
      { content: '{"name":"finish","arguments":{"summary":"Done well."}}' },
    ];
    let calls = 0;
    const completeChat: CompleteChat = async () => {
      calls += 1;
      return completions[0];
    };
    const request = makeRequest(async () => ({
      allowed: true,
      result: { success: true, summary: "Done well." },
      finished: true,
    }));

    const events = await run(request, [], completeChat);

    const thinking = events.filter((event) => event.type === "thinking").map((event) => (event.type === "thinking" ? event.message : ""));
    expect(thinking).toContain("Finishing…");
    expect(thinking).not.toContain("Checking the result…");
    const finishIndex = thinking.indexOf("Finishing…");
    expect(thinking.slice(finishIndex + 1)).toEqual([]);
    expect(calls).toBe(1);
    const assistant = events.filter((event) => event.type === "assistant_message");
    expect(assistant).toHaveLength(1);
    expect((assistant[0] as { message: string }).message).toBe("Done well.");
  });

  it("suppresses duplicate consecutive thinking messages", async () => {
    // The model repeats the same invalid tool twice: the recovery status is
    // identical back-to-back and must be emitted only once.
    const completions: ChatCompletion[] = [
      { content: '{"name":"chat","arguments":{}}' },
      { content: '{"name":"chat","arguments":{}}' },
      { content: '{"name":"finish","arguments":{"summary":"done"}}' },
    ];
    let call = 0;
    const completeChat: CompleteChat = async () => completions[Math.min(call++, completions.length - 1)];
    const request = makeRequest(async (toolCall) => ({
      allowed: true,
      result: { success: true, summary: "done" },
      finished: toolCall.name === "finish",
    }));

    const events = await run(request, [], completeChat);

    const thinking = events.filter((event) => event.type === "thinking").map((event) => (event.type === "thinking" ? event.message : ""));
    const unknownCount = thinking.filter((message) => message === 'Unknown tool "chat". Choosing from the available tools…').length;
    expect(unknownCount).toBe(1);
  });

  it("does not mark completion after a failed tool", async () => {
    const completions: ChatCompletion[] = [
      { content: '{"name":"read_file","arguments":{"path":"missing.py"}}' },
      { content: "The file could not be read because it does not exist." },
    ];
    let call = 0;
    const completeChat: CompleteChat = async () => completions[Math.min(call++, completions.length - 1)];
    const request = makeRequest(async () => ({ allowed: true, error: "Path does not exist: missing.py" }));

    const events = await run(request, [], completeChat);

    const assistant = events.filter((event) => event.type === "assistant_message").map((event) => (event.type === "assistant_message" ? event.message : ""));
    expect(assistant[0]).toContain("could not be read");
    const toolResults = events.filter((event) => event.type === "tool_result");
    expect(toolResults.some((event) => event.type === "tool_result" && event.toolResult.error !== undefined)).toBe(true);
  });

  it("stripToolCallMarkup removes finish JSON, tool_call tags, and partial objects", () => {
    expect(stripToolCallMarkup('{"name":"finish","arguments":{"summary":"x"}}')).toBe("");
    expect(stripToolCallMarkup('<tool_call>{"name":"finish","arguments":{}}</tool_call>')).toBe("");
    expect(stripToolCallMarkup('```json\n{"name":"write_file","arguments":{"path":"a"}}\n```')).toBe("");
    expect(stripToolCallMarkup('Working on it… {"name":"fin')).toBe("Working on it…");
    expect(stripToolCallMarkup("Plain answer")).toBe("Plain answer");
  });
});

describe("phase 1: streaming gate", () => {
  it("releases safe text immediately", () => {
    const released: string[] = [];
    const gate = createStreamGate((text) => released.push(text));
    gate.push("Hello ");
    gate.push("world");
    gate.close();
    expect(released.join("")).toBe("Hello world");
  });

  it("never releases a tool object delivered across multiple chunks", () => {
    const released: string[] = [];
    const gate = createStreamGate((text) => released.push(text));
    gate.push('{"name":"fin');
    gate.push('ish","arguments":');
    gate.push('{"summary":"done"}}');
    gate.close();
    expect(released.join("")).toBe("");
  });

  it("releases text before and after a protocol fragment without leaking it", () => {
    const released: string[] = [];
    const gate = createStreamGate((text) => released.push(text));
    gate.push("Sure thing. ");
    gate.push('{"name":"finish","arg');
    gate.push('uments":{"summary":"x"}}');
    gate.push(" All done!");
    gate.close();
    expect(released.join("")).toBe("Sure thing.  All done!");
  });

  it("holds back an unterminated fragment at stream end", () => {
    const released: string[] = [];
    const gate = createStreamGate((text) => released.push(text));
    gate.push('Working… {"name":"fin');
    gate.close();
    expect(released.join("")).toBe("Working… ");
  });
});
