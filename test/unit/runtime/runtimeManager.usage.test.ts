import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { RuntimeManager } from "../../../src/runtime/runtimeManager";
import { WorkspaceToolExecutor } from "../../../src/runtime/tools/workspaceToolExecutor";
import { PermissionManager } from "../../../src/permissions/permissionManager";
import { createDefaultPermissionPolicy } from "../../../src/permissions/permissionPolicy";
import type { AgentRuntime, RuntimeEvent, RuntimeEventSink, RuntimeSendRequest } from "../../../src/runtime/runtimeTypes";

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
  configure = vi.fn(async () => undefined);
  checkAvailability = vi.fn(async () => ({ available: true, status: "connected" as const }));
  discoverModels = vi.fn(async () => []);
  createSession = vi.fn(async (request: { sessionId: string }) => ({ providerSessionId: request.sessionId }));
  resumeSession = vi.fn(async (request: { providerSessionId: string }) => ({ providerSessionId: request.providerSessionId }));
  cancel = vi.fn(async () => undefined);
  dispose = vi.fn();

  constructor(private readonly script: (request: RuntimeSendRequest, emit: RuntimeEventSink) => Promise<void>) {}

  async sendMessage(request: RuntimeSendRequest, emit: RuntimeEventSink): Promise<void> {
    await this.script(request, emit);
  }
}

describe("RuntimeManager usage and streaming", () => {
  it("accumulates usage across completions and exposes it per session", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-usage-"));
    const runtime = new ScriptedRuntime(async (request) => {
      request.usageSink?.({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
      request.usageSink?.({ promptTokens: 20, completionTokens: 8, totalTokens: 28 });
    });
    const manager = new RuntimeManager({
      sessionStore: createStore() as never,
      permissionManager: new PermissionManager(createDefaultPermissionPolicy({ isWorkspaceTrusted: () => true })),
      runtimes: [runtime],
      toolExecutor: new WorkspaceToolExecutor(),
      defaultWorkspacePath: root,
    });
    await manager.setProvider({ provider: "mock" });
    const session = manager.createSession(root);
    await manager.startTask(session.sessionId, "hi");

    expect(manager.getUsage(session.sessionId)).toEqual({
      promptTokens: 30,
      completionTokens: 13,
      totalTokens: 43,
    });
    await fs.rm(root, { recursive: true, force: true });
  });

  it("forwards text_delta events from the streaming hook", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-delta-"));
    const runtime = new ScriptedRuntime(async (request) => {
      request.onStreamDelta?.("Hel");
      request.onStreamDelta?.("lo ");
      request.onStreamDelta?.("world");
    });
    const manager = new RuntimeManager({
      sessionStore: createStore() as never,
      permissionManager: new PermissionManager(createDefaultPermissionPolicy({ isWorkspaceTrusted: () => true })),
      runtimes: [runtime],
      toolExecutor: new WorkspaceToolExecutor(),
      defaultWorkspacePath: root,
    });
    await manager.setProvider({ provider: "mock" });
    const session = manager.createSession(root);

    const events: RuntimeEvent[] = [];
    manager.onDidPublishEvent((event) => events.push(event));
    await manager.startTask(session.sessionId, "hi");

    const deltas = events.filter((event) => event.type === "text_delta");
    expect(deltas.map((event) => (event.type === "text_delta" ? event.text : ""))).toEqual(["Hel", "lo ", "world"]);
    await fs.rm(root, { recursive: true, force: true });
  });

  function allowAllWrites(manager: RuntimeManager): void {
    manager.onDidPublishEvent((event) => {
      if (event.type === "permission_request") {
        manager.resolvePermission(event.request.requestId, "ALLOW");
      }
    });
  }

  it("captures a file_change event when write_file is allowed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-fc-"));
    const runtime = new ScriptedRuntime(async (request) => {
      await request.onToolCall?.({ id: "t1", name: "write_file", input: { path: "new.ts", content: "hello\nworld\n" } }, request.signal);
    });
    const manager = new RuntimeManager({
      sessionStore: createStore() as never,
      permissionManager: new PermissionManager(createDefaultPermissionPolicy({ isWorkspaceTrusted: () => true })),
      runtimes: [runtime],
      toolExecutor: new WorkspaceToolExecutor(),
      defaultWorkspacePath: root,
    });
    await manager.setProvider({ provider: "mock" });
    const session = manager.createSession(root);
    allowAllWrites(manager);

    const events: RuntimeEvent[] = [];
    manager.onDidPublishEvent((event) => events.push(event));
    await manager.startTask(session.sessionId, "write it");

    const changeEvents = events.filter((event) => event.type === "file_change");
    expect(changeEvents).toHaveLength(1);
    if (changeEvents[0].type === "file_change") {
      expect(changeEvents[0].change.path.replace(/\\/g, "/")).toContain("new.ts");
      expect(changeEvents[0].change.additions).toBe(2);
      expect(changeEvents[0].change.status).toBe("APPLIED");
    }
    expect(manager.listFileChanges(session.sessionId)).toHaveLength(1);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reject reverts the file on disk", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-rej-"));
    const runtime = new ScriptedRuntime(async (request) => {
      await request.onToolCall?.({ id: "t1", name: "write_file", input: { path: "doc.txt", content: "agent version\n" } }, request.signal);
    });
    const manager = new RuntimeManager({
      sessionStore: createStore() as never,
      permissionManager: new PermissionManager(createDefaultPermissionPolicy({ isWorkspaceTrusted: () => true })),
      runtimes: [runtime],
      toolExecutor: new WorkspaceToolExecutor(),
      defaultWorkspacePath: root,
    });
    await manager.setProvider({ provider: "mock" });
    const session = manager.createSession(root);
    allowAllWrites(manager);
    await manager.startTask(session.sessionId, "write doc");
    expect(await fs.readFile(path.join(root, "doc.txt"), "utf8")).toBe("agent version\n");

    const change = manager.listFileChanges(session.sessionId)[0];
    expect(change.beforeExists).toBe(false);
    await manager.resolveFileChange(change.changeId, "REJECT");

    // The file was created by the agent, so reject removes it entirely.
    await expect(fs.readFile(path.join(root, "doc.txt"), "utf8")).rejects.toThrow();
    const reverted = manager.listFileChanges(session.sessionId)[0];
    expect(reverted.status).toBe("REVERTED");
    await fs.rm(root, { recursive: true, force: true });
  });
});


