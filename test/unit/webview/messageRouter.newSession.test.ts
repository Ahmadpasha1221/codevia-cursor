import { describe, expect, it, vi } from "vitest";
import { MessageRouter } from "../../../src/webview/messageRouter";

function memorySecrets(): SecretStorage {
  let value: string | undefined;
  return {
    get: vi.fn(async () => value),
    store: vi.fn(async () => undefined),
    delete: vi.fn(async () => {
      value = undefined;
    }),
  };
}

describe("MessageRouter NEW_SESSION", () => {
  function makeRouter(managerOverrides: Record<string, unknown>) {
    return new MessageRouter(
      {} as never,
      ".",
      undefined,
      undefined,
      managerOverrides as never,
      memorySecrets(),
    );
  }

  it("reuses the active empty conversation instead of creating a new session", async () => {
    const createSession = vi.fn(() => ({ sessionId: "s2" }));
    const router = makeRouter({
      provider: "openrouter",
      activeSession: { sessionId: "s1" },
      loadTranscript: vi.fn(async () => []),
      createSession,
    });

    const first = await router.handleMessage({ type: "NEW_SESSION" });
    const second = await router.handleMessage({ type: "NEW_SESSION" });

    expect(createSession).not.toHaveBeenCalled();
    expect((first as { session: { sessionId: string } }).session.sessionId).toBe("s1");
    expect((second as { session: { sessionId: string } }).session.sessionId).toBe("s1");
  });

  it("creates a new session when the active conversation has messages", async () => {
    const createSession = vi.fn(() => ({ sessionId: "s2" }));
    const router = makeRouter({
      provider: "openrouter",
      activeSession: { sessionId: "s1" },
      loadTranscript: vi.fn(async () => [{ kind: "user", text: "hi", timestamp: Date.now() }]),
      createSession,
    });

    const result = await router.handleMessage({ type: "NEW_SESSION" });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect((result as { session: { sessionId: string } }).session.sessionId).toBe("s2");
  });

  it("creates a session when there is no active session", async () => {
    const createSession = vi.fn(() => ({ sessionId: "s2" }));
    const router = makeRouter({
      provider: "openrouter",
      activeSession: undefined,
      loadTranscript: vi.fn(async () => []),
      createSession,
    });

    await router.handleMessage({ type: "NEW_SESSION" });

    expect(createSession).toHaveBeenCalledTimes(1);
  });
});
