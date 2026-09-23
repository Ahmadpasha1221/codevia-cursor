import { describe, expect, it, vi } from "vitest";
import { runInferenceAgentLoop } from "../../../../src/runtime/tools/inferenceAgentLoop";
import type { RuntimeEvent, RuntimeSendRequest, RuntimeToolCall } from "../../../../src/runtime/runtimeTypes";

describe("runInferenceAgentLoop", () => {
  it("executes native tool calls and returns structured results to the model", async () => {
    const events: RuntimeEvent[] = [];
    const history: Array<{ role: string; content: string }> = [];
    const writeCall: RuntimeToolCall = { id: "1", name: "write_file", input: { path: "a.py", content: "a" } };
    const readCall: RuntimeToolCall = { id: "2", name: "read_file", input: { path: "a.py" } };
    const followUp: string[] = [];
    const completeChat = vi.fn()
      .mockResolvedValueOnce({ content: "", nativeToolCalls: [writeCall, readCall] })
      .mockImplementationOnce(async (messages: Array<{ role: string; content: string }>) => {
        followUp.push(messages.map((message) => message.content).join("\n"));
        return { content: "Created a.py" };
      });
    const onToolCall = vi.fn(async (call: { name: string }) => ({
      allowed: true,
      result: call.name === "write_file"
        ? { success: true, tool: "write_file", path: "a.py" }
        : { success: true, tool: "read_file", content: "a" },
    }));

    await runInferenceAgentLoop(
      { sessionId: "s1", workspacePath: "/ws", prompt: "Create a.py", onToolCall },
      history as never,
      completeChat,
      (event) => {
        events.push(event);
      },
      { nativeTools: true },
    );

    expect(onToolCall).toHaveBeenCalledTimes(2);
    expect(followUp.join("\n")).toContain("\"success\":true");
    expect(events.filter((event) => event.type === "tool_call")).toHaveLength(2);
    expect(events.some((event) => event.type === "assistant_message" && event.message === "Created a.py")).toBe(true);
  });

  it("does not execute JSON text when native tools are available", async () => {
    const onToolCall = vi.fn(async () => ({ allowed: true, result: { success: true } }));
    await runInferenceAgentLoop(
      { sessionId: "s1", workspacePath: "/ws", prompt: "hi", onToolCall } satisfies RuntimeSendRequest,
      [],
      async () => ({ content: `{"name":"write_file","arguments":{"path":"simple.py","content":"x"}}` }),
      async () => undefined,
      { nativeTools: true },
    );
    expect(onToolCall).not.toHaveBeenCalled();
  });

  it("uses the isolated fallback parser only when native tools are unavailable", async () => {
    const onToolCall = vi.fn(async () => ({ allowed: true, result: { success: true, tool: "write_file", path: "simple.py" } }));
    const completeChat = vi.fn()
      .mockResolvedValueOnce({
        content: `{"name":"write_file","arguments":{"path":"simple.py","content":"print('Hello, World!')"}}`,
      })
      .mockResolvedValueOnce({ content: "Created simple.py" });

    await runInferenceAgentLoop(
      { sessionId: "s1", workspacePath: "/ws", prompt: "create simple.py", onToolCall },
      [],
      completeChat,
      async () => undefined,
      { nativeTools: false },
    );

    expect(onToolCall).toHaveBeenCalledTimes(1);
    const firstMessages = completeChat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(firstMessages[0]?.content).toContain("cannot use native tool calls");
    expect(firstMessages[0]?.content).not.toContain("<tool_call>");
  });

  it("stops when finish is called", async () => {
    const events: RuntimeEvent[] = [];
    const completeChat = vi.fn().mockResolvedValue({
      content: "",
      nativeToolCalls: [{ id: "f", name: "finish", input: { summary: "Created simple.py and verified it." } }],
    });
    await runInferenceAgentLoop(
      {
        sessionId: "s1",
        workspacePath: "/ws",
        prompt: "create simple.py",
        onToolCall: async () => ({ allowed: true, finished: true, result: { success: true, tool: "finish", summary: "Created simple.py and verified it." } }),
      },
      [],
      completeChat,
      (event) => {
        events.push(event);
      },
    );
    expect(completeChat).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === "assistant_message" && event.message === "Created simple.py and verified it.")).toBe(true);
  });

  it("puts the selected model in context without calling a workspace tool for that question", async () => {
    const onToolCall = vi.fn();
    const completeChat = vi.fn(async (messages: Array<{ content: string }>) => {
      expect(messages[0]?.content).toContain("qwen2.5:0.5b-instruct");
      return { content: "You are running qwen2.5:0.5b-instruct." };
    });
    const events: RuntimeEvent[] = [];
    await runInferenceAgentLoop(
      { sessionId: "s1", workspacePath: "/ws", prompt: "which model am I running?", modelId: "qwen2.5:0.5b-instruct", onToolCall },
      [],
      completeChat,
      (event) => {
        events.push(event);
      },
      { nativeTools: false },
    );
    expect(onToolCall).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "assistant_message" && event.message.includes("qwen2.5:0.5b-instruct"))).toBe(true);
  });

  it("retry drops the previous turn before a fresh inference", async () => {
    const history = [
      { role: "user" as const, content: "create simple.py" },
      { role: "assistant" as const, content: `{"name":"write_file","arguments":{"path":"simple.py","content":"stale"}}` },
    ];
    const completeChat = vi.fn()
      .mockResolvedValueOnce({
        content: `{"name":"write_file","arguments":{"path":"simple.py","content":"fresh"}}`,
      })
      .mockResolvedValueOnce({ content: "Created simple.py" });
    const onToolCall = vi.fn(async (call: { input: { content?: string } }) => ({
      allowed: true,
      result: { success: true, content: call.input.content },
    }));

    await runInferenceAgentLoop(
      { sessionId: "s1", workspacePath: "/ws", prompt: "create simple.py", retry: true, onToolCall },
      history,
      completeChat,
      async () => undefined,
      { nativeTools: false },
    );

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onToolCall.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      input: expect.objectContaining({ content: "fresh" }),
    }));
    expect(history.some((turn) => turn.content.includes("stale"))).toBe(false);
  });
});
