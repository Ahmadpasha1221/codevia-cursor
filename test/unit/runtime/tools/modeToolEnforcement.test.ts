import { describe, expect, it, vi } from "vitest";
import { runInferenceAgentLoop, type ChatCompletion, type CompleteChat } from "../../../../src/runtime/tools/inferenceAgentLoop";
import { availableToolNames } from "../../../../src/runtime/tools/toolAvailability";
import { buildFallbackToolContract, getRegisteredTool } from "../../../../src/runtime/tools/toolRegistry";
import { ToolRouter } from "../../../../src/runtime/tools/toolRouter";
import { WorkspaceToolExecutor } from "../../../../src/runtime/tools/workspaceToolExecutor";
import type { CodeviaSession } from "../../../../src/runtime/runtimeTypes";

function makeSession(workspacePath: string): CodeviaSession {
  return {
    sessionId: "s1",
    provider: "ollama",
    workspacePath,
    status: "READY",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("mode-based tool enforcement", () => {
  it("keeps the fallback contract in ask mode free of write tools", () => {
    const contract = buildFallbackToolContract(availableToolNames("ask"));
    expect(contract).toContain("read_file");
    expect(contract).toContain("search_files");
    expect(contract).not.toContain("write_file");
    expect(contract).not.toContain("run_command");
    // Example JSON is drawn from the available set, not always write_file.
    expect(contract).toContain('{"name":"list_files","arguments":{}}');
  });

  it("keeps the full contract in agent mode", () => {
    const contract = buildFallbackToolContract(availableToolNames("agent"));
    expect(contract).toContain("write_file");
    expect(contract).toContain("run_command");
    expect(contract).toContain("finish");
  });

  it("recovers when a restricted mode tries a write tool, instead of executing it", async () => {
    const completions: ChatCompletion[] = [
      { content: '{"name":"write_file","arguments":{"path":"x.py","content":"1"}}' },
      { content: '{"name":"finish","arguments":{"summary":"answered"}}' },
    ];
    let call = 0;
    const completeChat: CompleteChat = async () => completions[Math.min(call++, completions.length - 1)];
    const events: Array<{ type: string; message?: string }> = [];
    const onToolCall = vi.fn(async (toolCall: { name: string }) => ({
      allowed: true,
      result: { success: true, ...(toolCall.name === "finish" ? { summary: "answered" } : {}) },
      finished: toolCall.name === "finish",
    }));

    await runInferenceAgentLoop(
      { sessionId: "s1", workspacePath: ".", prompt: "create x.py", onToolCall },
      [],
      completeChat,
      async (event) => {
        events.push(event as { type: string; message?: string });
      },
      { nativeTools: false, mode: "ask" },
    );

    // write_file is never routed in ask mode; the model recovered with finish.
    const routed = onToolCall.mock.calls.map((call) => (call[0] as { name: string }).name);
    expect(routed).toEqual(["finish"]);
    const thinking = events.filter((event) => event.type === "thinking").map((event) => (event as { message?: string }).message ?? "");
    expect(thinking.some((message) => message.includes("Unknown tool"))).toBe(true);
    const assistant = events.filter((event) => event.type === "assistant_message").map((event) => (event as { message?: string }).message ?? "");
    expect(assistant).toEqual(["answered"]);
  });

  it("router blocks a registry-known tool that is outside the current mode set", async () => {
    const session = makeSession(".");
    const router = new ToolRouter(new WorkspaceToolExecutor());
    const response = await router.route(
      { id: "1", name: "write_file", input: { path: "x.py", content: "1" } },
      { session },
      async () => ({ allowed: true }),
      { mode: "ask" },
    );
    expect(response.allowed).toBe(false);
    expect(response.error).toContain("not available");
    expect(response.error).toContain("read_file");
  });

  it("router reports unknown tools with the available list so the model can retry", async () => {
    const session = makeSession(".");
    const router = new ToolRouter(new WorkspaceToolExecutor());
    const response = await router.route(
      { id: "2", name: "create_file", input: {} },
      { session },
      async () => ({ allowed: true }),
    );
    expect(response.allowed).toBe(false);
    expect(response.error).toContain("Unknown tool: create_file");
    expect(response.error).toContain("write_file");
    expect(getRegisteredTool("create_file")).toBeUndefined();
  });
});
