import { describe, expect, it } from "vitest";
import { MessageRouter } from "../../../src/webview/messageRouter";
import { AgentManager } from "../../../src/agent/agentManager";

describe("MessageRouter", () => {
  it("routes SEND_PROMPT to AgentManager", async () => {
    const agentManager = {
      startTask: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn().mockReturnValue({ sessionId: "session-1" }),
      cancelTask: vi.fn().mockResolvedValue(undefined),
    } as unknown as AgentManager;

    const router = new MessageRouter(agentManager);
    const result = await router.handleMessage({ type: "SEND_PROMPT", prompt: "Hello", sessionId: "session-1" });

    expect(result).toEqual({ success: true });
    expect(agentManager.startTask).toHaveBeenCalledWith("session-1", "Hello");
  });

  it("routes CANCEL_RUN to AgentManager", async () => {
    const agentManager = {
      startTask: vi.fn(),
      createSession: vi.fn(),
      cancelTask: vi.fn().mockResolvedValue(undefined),
    } as unknown as AgentManager;

    const router = new MessageRouter(agentManager);
    await router.handleMessage({ type: "CANCEL_RUN", sessionId: "session-1" });

    expect(agentManager.cancelTask).toHaveBeenCalledWith("session-1");
  });

  it("creates a session for NEW_SESSION", async () => {
    const agentManager = {
      startTask: vi.fn(),
      createSession: vi.fn().mockReturnValue({ sessionId: "session-2" }),
      cancelTask: vi.fn(),
    } as unknown as AgentManager;

    const router = new MessageRouter(agentManager);
    const result = await router.handleMessage({ type: "NEW_SESSION", workspacePath: "/workspace" });

    expect(result.success).toBe(true);
    expect(agentManager.createSession).toHaveBeenCalledWith("/workspace");
  });

  it("uses the default workspace for NEW_SESSION", async () => {
    const agentManager = {
      startTask: vi.fn(),
      createSession: vi.fn().mockReturnValue({ sessionId: "session-2" }),
      cancelTask: vi.fn(),
    } as unknown as AgentManager;

    const router = new MessageRouter(agentManager, "/default/workspace");
    await router.handleMessage({ type: "NEW_SESSION" });

    expect(agentManager.createSession).toHaveBeenCalledWith("/default/workspace");
  });

  it("selects an existing session", async () => {
    const agentManager = {
      startTask: vi.fn(),
      createSession: vi.fn(),
      cancelTask: vi.fn(),
      selectSession: vi.fn().mockReturnValue(true),
    } as unknown as AgentManager;

    const router = new MessageRouter(agentManager);
    const result = await router.handleMessage({ type: "SELECT_SESSION", sessionId: "session-1" });

    expect(result).toEqual({ success: true, selected: true });
    expect(agentManager.selectSession).toHaveBeenCalledWith("session-1");
  });

  it("lists sessions", async () => {
    const sessions = [{ sessionId: "session-1" }];
    const agentManager = {
      startTask: vi.fn(),
      createSession: vi.fn(),
      cancelTask: vi.fn(),
      listSessions: vi.fn().mockReturnValue(sessions),
    } as unknown as AgentManager;

    const router = new MessageRouter(agentManager);
    const result = await router.handleMessage({ type: "LIST_SESSIONS" });

    expect(result).toEqual({ success: true, sessions });
  });

  it("throws on invalid message shape", async () => {
    const agentManager = {
      startTask: vi.fn(),
      createSession: vi.fn(),
      cancelTask: vi.fn(),
    } as unknown as AgentManager;

    const router = new MessageRouter(agentManager);
    await expect(router.handleMessage(null)).rejects.toThrow("Invalid message shape");
  });

  it("throws on unknown message type", async () => {
    const agentManager = {
      startTask: vi.fn(),
      createSession: vi.fn(),
      cancelTask: vi.fn(),
    } as unknown as AgentManager;

    const router = new MessageRouter(agentManager);
    await expect(router.handleMessage({ type: "UNKNOWN" })).rejects.toThrow("Unknown message type");
  });
});
