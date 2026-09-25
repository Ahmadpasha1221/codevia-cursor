import { describe, expect, it, vi } from "vitest";
import { MessageRouter } from "../../../src/webview/messageRouter";
import { AgentManager } from "../../../src/agent/agentManager";
import { RuntimeManager } from "../../../src/runtime/runtimeManager";

describe("MessageRouter transcript routing", () => {
  it("serves GET_TRANSCRIPT from RuntimeManager for managed runtimes", async () => {
    const entries = [{ kind: "user" as const, text: "hello", timestamp: 1 }];
    const runtimeManager = {
      provider: "ollama",
      usesManagedRuntimeHint: true,
      loadTranscript: vi.fn().mockResolvedValue(entries),
    } as unknown as RuntimeManager;
    const agentManager = { loadTranscript: vi.fn() } as unknown as AgentManager;
    const router = new MessageRouter(agentManager, ".", undefined, undefined, runtimeManager);

    const result = await router.handleMessage({ type: "GET_TRANSCRIPT", sessionId: "session-1" });

    expect(result).toEqual({ type: "TRANSCRIPT", sessionId: "session-1", entries });
    expect(runtimeManager.loadTranscript).toHaveBeenCalledWith("session-1");
    expect(agentManager.loadTranscript).not.toHaveBeenCalled();
  });

  it("falls back to AgentManager for the Cursor runtime", async () => {
    const entries = [{ kind: "assistant" as const, text: "hi", timestamp: 1 }];
    const runtimeManager = {
      provider: "cursor",
      loadTranscript: vi.fn(),
    } as unknown as RuntimeManager;
    const agentManager = { loadTranscript: vi.fn().mockResolvedValue(entries) } as unknown as AgentManager;
    const router = new MessageRouter(agentManager, ".", undefined, undefined, runtimeManager);

    const result = await router.handleMessage({ type: "GET_TRANSCRIPT", sessionId: "session-1" });

    expect(result).toEqual({ type: "TRANSCRIPT", sessionId: "session-1", entries });
    expect(agentManager.loadTranscript).toHaveBeenCalledWith("session-1");
  });

  it("rejects GET_TRANSCRIPT without a sessionId", async () => {
    const router = new MessageRouter({} as unknown as AgentManager);

    await expect(router.handleMessage({ type: "GET_TRANSCRIPT" })).rejects.toThrow("Invalid GET_TRANSCRIPT message");
  });
});
