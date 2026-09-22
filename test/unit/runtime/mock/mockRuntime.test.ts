import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockRuntime } from "../../../../src/runtime/mock/mockRuntime";
import type {
  RuntimeEvent,
  RuntimeEventSink,
  RuntimeSendRequest,
  RuntimeToolCall,
  RuntimeToolCallResponse,
  MockRuntimeConfig,
} from "../../../../src/runtime/runtimeTypes";

function createMockEmit(): { emit: RuntimeEventSink; events: RuntimeEvent[] } {
  const events: RuntimeEvent[] = [];
  const emit: RuntimeEventSink = (event) => {
    events.push(event);
  };
  return { emit, events };
}

function createSendRequest(overrides: Partial<RuntimeSendRequest> = {}): RuntimeSendRequest {
  return {
    sessionId: "test-session",
    workspacePath: "/test",
    prompt: "Test prompt",
    ...overrides,
  };
}

describe("MockRuntime", () => {
  let runtime: MockRuntime;

  beforeEach(() => {
    runtime = new MockRuntime();
  });

  describe("configure", () => {
    it("should accept and store configuration", async () => {
      const config: MockRuntimeConfig = {
        provider: "mock",
        scenario: "streaming",
        delayMs: 100,
      };
      await runtime.configure(config);
    });

    it("should use defaults when not provided", async () => {
      await runtime.configure({ provider: "mock" });
    });
  });

  describe("checkAvailability", () => {
    it("should return available for default scenario", async () => {
      const result = await runtime.checkAvailability();
      expect(result).toEqual({ available: true, status: "connected" });
    });

    it("should return unavailable for provider-unavailable scenario", async () => {
      await runtime.configure({ provider: "mock", scenario: "provider-unavailable" });
      const result = await runtime.checkAvailability();
      expect(result).toEqual({
        available: false,
        status: "error",
        message: "Mock provider unavailable (simulated)",
      });
    });

    it("should respect abort signal", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(runtime.checkAvailability(controller.signal)).rejects.toThrow("cancelled");
    });
  });

  describe("discoverModels", () => {
    it("should return deterministic mock models for default scenario", async () => {
      const models = await runtime.discoverModels();
      expect(models).toHaveLength(2);
      expect(models[0]).toEqual({
        id: "mock-model-1",
        name: "Mock Model 1",
        provider: "mock",
        contextWindow: 4096,
        capabilities: {
          streaming: true,
          toolCalling: true,
          structuredOutput: true,
          codeEditing: true,
          reasoning: false,
        },
      });
      expect(models[1]).toEqual({
        id: "mock-model-2",
        name: "Mock Model 2",
        provider: "mock",
        contextWindow: 8192,
        capabilities: {
          streaming: true,
          toolCalling: true,
          structuredOutput: true,
          codeEditing: true,
          reasoning: true,
        },
      });
    });

    it("should return empty array for model-unavailable scenario", async () => {
      await runtime.configure({ provider: "mock", scenario: "model-unavailable" });
      const models = await runtime.discoverModels();
      expect(models).toEqual([]);
    });

    it("should return same models on repeated calls (deterministic)", async () => {
      const models1 = await runtime.discoverModels();
      const models2 = await runtime.discoverModels();
      expect(models1).toEqual(models2);
    });

    it("should respect abort signal", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(runtime.discoverModels(controller.signal)).rejects.toThrow("cancelled");
    });
  });

  describe("createSession", () => {
    it("should create session and return providerSessionId", async () => {
      const result = await runtime.createSession({
        sessionId: "sess-1",
        workspacePath: "/ws",
        modelId: "mock-model-1",
      });
      expect(result.providerSessionId).toBeDefined();
      expect(typeof result.providerSessionId).toBe("string");
    });

    it("should create session without modelId", async () => {
      const result = await runtime.createSession({
        sessionId: "sess-2",
        workspacePath: "/ws",
      });
      expect(result.providerSessionId).toBeDefined();
    });
  });

  describe("resumeSession", () => {
    it("should resume session and return providerSessionId", async () => {
      const result = await runtime.resumeSession({
        sessionId: "sess-3",
        providerSessionId: "provider-123",
        workspacePath: "/ws",
        modelId: "mock-model-1",
      });
      expect(result.providerSessionId).toBe("provider-123");
    });
  });

  describe("sendMessage - default scenario", () => {
    it("should emit assistant_message and completed events", async () => {
      await runtime.createSession({ sessionId: "sess-default", workspacePath: "/ws" });
      const { emit, events } = createMockEmit();

      await runtime.sendMessage(createSendRequest({ sessionId: "sess-default" }), emit);

      const assistantEvents = events.filter((e) => e.type === "assistant_message");
      expect(assistantEvents).toHaveLength(1);
      expect(assistantEvents[0].message).toContain("Mock response to: Test prompt");

      const completedEvents = events.filter((e) => e.type === "completed");
      expect(completedEvents).toHaveLength(1);
    });

    it("should emit status RUNNING", async () => {
      await runtime.createSession({ sessionId: "sess-status", workspacePath: "/ws" });
      const { emit, events } = createMockEmit();

      await runtime.sendMessage(createSendRequest({ sessionId: "sess-status" }), emit);

      const statusEvents = events.filter((e) => e.type === "status");
      expect(statusEvents.some((e) => e.status === "RUNNING")).toBe(true);
    });
  });

  describe("sendMessage - streaming scenario", () => {
    beforeEach(async () => {
      await runtime.configure({ provider: "mock", scenario: "streaming", delayMs: 5 });
      await runtime.createSession({ sessionId: "sess-stream", workspacePath: "/ws" });
    });

    it("should emit multiple text_delta events", async () => {
      const { emit, events } = createMockEmit();

      await runtime.sendMessage(createSendRequest({ sessionId: "sess-stream" }), emit);

      const deltaEvents = events.filter((e) => e.type === "text_delta");
      expect(deltaEvents.length).toBeGreaterThan(0);

      const fullText = deltaEvents.map((e) => e.text).join("");
      expect(fullText).toContain("streaming response");
    });

    it("should emit final assistant_message with complete text", async () => {
      const { emit, events } = createMockEmit();

      await runtime.sendMessage(createSendRequest({ sessionId: "sess-stream" }), emit);

      const assistantEvents = events.filter((e) => e.type === "assistant_message");
      expect(assistantEvents).toHaveLength(1);
      expect(assistantEvents[0].message).toContain("streaming response");
      expect(assistantEvents[0].message).toContain("text deltas are emitted");
    });

    it("should emit completed after streaming", async () => {
      const { emit, events } = createMockEmit();

      await runtime.sendMessage(createSendRequest({ sessionId: "sess-stream" }), emit);

      const completedEvents = events.filter((e) => e.type === "completed");
      expect(completedEvents).toHaveLength(1);
    });
  });

  describe("sendMessage - tool-calls scenario", () => {
    beforeEach(async () => {
      await runtime.configure({ provider: "mock", scenario: "tool-calls", delayMs: 5 });
      await runtime.createSession({ sessionId: "sess-tools", workspacePath: "/ws" });
    });

    it("should emit tool_call event", async () => {
      const { emit, events } = createMockEmit();
      const toolCallResponses: RuntimeToolCallResponse[] = [{ allowed: true }];

      await runtime.sendMessage(
        createSendRequest({
          sessionId: "sess-tools",
          onToolCall: vi.fn().mockImplementation(async (_call: RuntimeToolCall) => toolCallResponses.shift()!),
        }),
        emit,
      );

      const toolCallEvents = events.filter((e) => e.type === "tool_call");
      expect(toolCallEvents).toHaveLength(1);
      expect(toolCallEvents[0].toolCall.name).toBe("read_file");
    });

    it("should emit tool_result event after onToolCall", async () => {
      const { emit, events } = createMockEmit();

      await runtime.sendMessage(
        createSendRequest({
          sessionId: "sess-tools",
          onToolCall: vi.fn().mockResolvedValue({ allowed: true }),
        }),
        emit,
      );

      const toolResultEvents = events.filter((e) => e.type === "tool_result");
      expect(toolResultEvents).toHaveLength(1);
      expect(toolResultEvents[0].toolResult.result).toBe("File content here");
    });

    it("should emit tool_result with error when denied", async () => {
      const { emit, events } = createMockEmit();

      await runtime.sendMessage(
        createSendRequest({
          sessionId: "sess-tools",
          onToolCall: vi.fn().mockResolvedValue({ allowed: false, error: "Denied" }),
        }),
        emit,
      );

      const toolResultEvents = events.filter((e) => e.type === "tool_result");
      expect(toolResultEvents[0].toolResult.error).toBe("Denied");
    });
  });

  describe("sendMessage - error scenario", () => {
    beforeEach(async () => {
      await runtime.configure({ provider: "mock", scenario: "error", delayMs: 5 });
      await runtime.createSession({ sessionId: "sess-error", workspacePath: "/ws" });
    });

    it("should throw RuntimeError with unknown code", async () => {
      const { emit } = createMockEmit();

      await expect(runtime.sendMessage(createSendRequest({ sessionId: "sess-error" }), emit)).rejects.toThrow(
        "Simulated error from mock runtime",
      );
    });

    it("should emit error event", async () => {
      const { emit, events } = createMockEmit();

      try {
        await runtime.sendMessage(createSendRequest({ sessionId: "sess-error" }), emit);
      } catch {
        // expected
      }

      const errorEvents = events.filter((e) => e.type === "error");
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].error.code).toBe("unknown");
      expect(errorEvents[0].error.retryable).toBe(true);
    });
  });

  describe("sendMessage - cancellation scenario", () => {
    beforeEach(async () => {
      await runtime.configure({ provider: "mock", scenario: "cancellation", delayMs: 5 });
      await runtime.createSession({ sessionId: "sess-cancel", workspacePath: "/ws" });
    });

    it("should support abort signal cancellation", async () => {
      const controller = new AbortController();
      const { emit } = createMockEmit();

      setTimeout(() => controller.abort(), 10);

      await expect(
        runtime.sendMessage(createSendRequest({ sessionId: "sess-cancel", signal: controller.signal }), emit),
      ).rejects.toThrow("cancelled");
    });

    it("should not hang on cancellation", async () => {
      const controller = new AbortController();
      const { emit } = createMockEmit();

      const promise = runtime.sendMessage(createSendRequest({ sessionId: "sess-cancel", signal: controller.signal }), emit);
      controller.abort();

      await expect(promise).rejects.toThrow("cancelled");
    });
  });

  describe("sendMessage - long-running scenario", () => {
    beforeEach(async () => {
      await runtime.configure({ provider: "mock", scenario: "long-running", delayMs: 10 });
      await runtime.createSession({ sessionId: "sess-long", workspacePath: "/ws" });
    });

    it("should emit thinking events during execution", async () => {
      const { emit, events } = createMockEmit();

      await runtime.sendMessage(createSendRequest({ sessionId: "sess-long" }), emit);

      const thinkingEvents = events.filter((e) => e.type === "thinking");
      expect(thinkingEvents.length).toBeGreaterThanOrEqual(5);
    });

    it("should complete successfully", async () => {
      const { emit, events } = createMockEmit();

      await runtime.sendMessage(createSendRequest({ sessionId: "sess-long" }), emit);

      const completedEvents = events.filter((e) => e.type === "completed");
      expect(completedEvents).toHaveLength(1);
    });
  });

  describe("sendMessage - permission scenario", () => {
    beforeEach(async () => {
      await runtime.configure({ provider: "mock", scenario: "permission", delayMs: 5 });
      await runtime.createSession({ sessionId: "sess-perm", workspacePath: "/ws" });
    });

    it("should emit permission_request event", async () => {
      const { emit, events } = createMockEmit();

      await runtime.sendMessage(createSendRequest({ sessionId: "sess-perm" }), emit);

      const permEvents = events.filter((e) => e.type === "permission_request");
      expect(permEvents).toHaveLength(1);
      expect(permEvents[0].request.toolName).toBe("write_file");
    });
  });

  describe("sendMessage - provider-unavailable scenario", () => {
    beforeEach(async () => {
      await runtime.configure({ provider: "mock", scenario: "provider-unavailable", delayMs: 5 });
      await runtime.createSession({ sessionId: "sess-prov-unavail", workspacePath: "/ws" });
    });

    it("should throw provider_unavailable error", async () => {
      const { emit } = createMockEmit();

      await expect(runtime.sendMessage(createSendRequest({ sessionId: "sess-prov-unavail" }), emit)).rejects.toThrow(
        "Provider unavailable",
      );
    });

    it("should emit error event with provider_unavailable code", async () => {
      const { emit, events } = createMockEmit();

      try {
        await runtime.sendMessage(createSendRequest({ sessionId: "sess-prov-unavail" }), emit);
      } catch {
        // expected
      }

      const errorEvents = events.filter((e) => e.type === "error");
      expect(errorEvents[0].error.code).toBe("provider_unavailable");
    });
  });

  describe("sendMessage - model-unavailable scenario", () => {
    beforeEach(async () => {
      await runtime.configure({ provider: "mock", scenario: "model-unavailable", delayMs: 5 });
      await runtime.createSession({ sessionId: "sess-model-unavail", workspacePath: "/ws" });
    });

    it("should throw model_unavailable error", async () => {
      const { emit } = createMockEmit();

      await expect(runtime.sendMessage(createSendRequest({ sessionId: "sess-model-unavail" }), emit)).rejects.toThrow(
        "Model unavailable",
      );
    });

    it("should emit error event with model_unavailable code", async () => {
      const { emit, events } = createMockEmit();

      try {
        await runtime.sendMessage(createSendRequest({ sessionId: "sess-model-unavail" }), emit);
      } catch {
        // expected
      }

      const errorEvents = events.filter((e) => e.type === "error");
      expect(errorEvents[0].error.code).toBe("model_unavailable");
    });
  });

  describe("cancel", () => {
    it("should cancel session without hanging", async () => {
      await runtime.createSession({ sessionId: "sess-cancel-direct", workspacePath: "/ws" });

      await runtime.cancel({ sessionId: "sess-cancel-direct" });
    });

    it("should handle cancel for non-existent session gracefully", async () => {
      await expect(runtime.cancel({ sessionId: "non-existent" })).resolves.not.toThrow();
    });

    it("should respect abort signal", async () => {
      await runtime.createSession({ sessionId: "sess-cancel-signal", workspacePath: "/ws" });
      const controller = new AbortController();
      controller.abort();

      await expect(runtime.cancel({ sessionId: "sess-cancel-signal", signal: controller.signal })).resolves.not.toThrow();
    });
  });

  describe("dispose", () => {
    it("should clear all sessions", async () => {
      await runtime.createSession({ sessionId: "sess-dispose", workspacePath: "/ws" });
      runtime.dispose();
    });
  });
});