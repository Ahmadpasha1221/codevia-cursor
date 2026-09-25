import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { RuntimeManager } from "../../../src/runtime/runtimeManager";
import { WorkspaceToolExecutor } from "../../../src/runtime/tools/workspaceToolExecutor";
import { PermissionManager } from "../../../src/permissions/permissionManager";
import { createDefaultPermissionPolicy } from "../../../src/permissions/permissionPolicy";
import { TranscriptStore } from "../../../src/session/transcriptStore";
import type { AgentRuntime, RuntimeEventSink, RuntimeSendRequest } from "../../../src/runtime/runtimeTypes";

vi.mock("vscode", () => ({
  EventEmitter: class {
    private listeners: ((event: unknown) => void)[] = [];
    event: (listener: (event: unknown) => void) => void;
    constructor() {
      this.event = (listener: (event: unknown) => void) => {
        this.listeners.push(listener);
      };
    }
    fire(event: unknown): void {
      this.listeners.forEach((listener) => listener(event));
    }
    dispose(): void {
      this.listeners = [];
    }
  },
}));

function createStore() {
  return {
    loadSessions: () => [],
    loadActiveSessionId: () => undefined,
    saveSessions: vi.fn().mockResolvedValue(undefined),
    saveActiveSessionId: vi.fn().mockResolvedValue(undefined),
  };
}

class ScriptedRuntime implements AgentRuntime {
  readonly provider = "mock" as const;
  readonly family = "mock" as const;
  calls: RuntimeSendRequest[] = [];
  configure = vi.fn(async () => undefined);
  checkAvailability = vi.fn(async () => ({ available: true, status: "connected" as const }));
  discoverModels = vi.fn(async () => []);
  createSession = vi.fn(async (request: { sessionId: string }) => ({ providerSessionId: request.sessionId }));
  resumeSession = vi.fn(async (request: { providerSessionId: string }) => ({ providerSessionId: request.providerSessionId }));
  cancel = vi.fn(async () => undefined);
  dispose = vi.fn();

  constructor(private readonly script: (request: RuntimeSendRequest, emit: RuntimeEventSink) => Promise<void>) {}

  async sendMessage(request: RuntimeSendRequest, emit: RuntimeEventSink): Promise<void> {
    this.calls.push(request);
    await this.script(request, emit);
  }
}

describe("RuntimeManager transcript persistence", () => {
  it("records a full run so it can be restored after restart with zero tokens", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-tscript-"));
    const transcriptStore = new TranscriptStore({ fsPath: root } as never);
    const permissionManager = new PermissionManager(createDefaultPermissionPolicy({ isWorkspaceTrusted: () => true }));
    const runtime = new ScriptedRuntime(async (request, emit) => {
      await emit({ type: "assistant_message", sessionId: request.sessionId, message: "Working on it", timestamp: Date.now() });
      await emit({
        type: "tool_call",
        sessionId: request.sessionId,
        toolCall: { id: "t1", name: "read_file", input: { path: "src/a.ts" } },
        timestamp: Date.now(),
      });
      await emit({
        type: "tool_result",
        sessionId: request.sessionId,
        toolResult: { toolCallId: "t1", name: "read_file", error: "boom" },
        timestamp: Date.now(),
      });
      await emit({ type: "assistant_message", sessionId: request.sessionId, message: "All done", timestamp: Date.now() });
    });

    const manager = new RuntimeManager({
      sessionStore: createStore() as never,
      permissionManager,
      runtimes: [runtime],
      toolExecutor: new WorkspaceToolExecutor(),
      defaultWorkspacePath: root,
      transcriptStore,
    });
    await manager.setProvider({ provider: "mock" });
    const session = manager.createSession(root);

    await manager.startTask(session.sessionId, "Fix the flaky test");

    const restored = await manager.loadTranscript(session.sessionId);
    expect(restored[0]).toMatchObject({ kind: "user", text: "Fix the flaky test" });
    expect(restored.some((entry) => entry.kind === "assistant" && entry.text === "Working on it")).toBe(true);
    expect(restored.some((entry) => entry.kind === "tool" && entry.toolName === "read_file" && entry.path === "src/a.ts")).toBe(true);
    expect(restored.some((entry) => entry.kind === "tool" && entry.error === "boom")).toBe(true);
    expect(restored[restored.length - 1]).toMatchObject({ kind: "assistant", text: "All done" });
    await fs.rm(root, { recursive: true, force: true });
  });

  it("loadTranscript returns an empty list when no store is configured", async () => {
    const permissionManager = new PermissionManager(createDefaultPermissionPolicy({ isWorkspaceTrusted: () => true }));
    const runtime = new ScriptedRuntime(async () => undefined);
    const manager = new RuntimeManager({
      sessionStore: createStore() as never,
      permissionManager,
      runtimes: [runtime],
      toolExecutor: new WorkspaceToolExecutor(),
    });

    expect(await manager.loadTranscript("any-session")).toEqual([]);
  });

  it("deleteSession removes the transcript file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-tscript-"));
    const transcriptStore = new TranscriptStore({ fsPath: root } as never);
    const permissionManager = new PermissionManager(createDefaultPermissionPolicy({ isWorkspaceTrusted: () => true }));
    const runtime = new ScriptedRuntime(async (_request, emit) => {
      await emit({ type: "assistant_message", sessionId: "s", message: "hi", timestamp: Date.now() });
    });
    const manager = new RuntimeManager({
      sessionStore: createStore() as never,
      permissionManager,
      runtimes: [runtime],
      toolExecutor: new WorkspaceToolExecutor(),
      defaultWorkspacePath: root,
      transcriptStore,
    });
    await manager.setProvider({ provider: "mock" });
    const session = manager.createSession(root);
    await manager.startTask(session.sessionId, "hello");

    expect(await manager.loadTranscript(session.sessionId)).not.toEqual([]);
    await manager.deleteSession(session.sessionId);
    expect(await manager.loadTranscript(session.sessionId)).toEqual([]);
    await fs.rm(root, { recursive: true, force: true });
  });
});
