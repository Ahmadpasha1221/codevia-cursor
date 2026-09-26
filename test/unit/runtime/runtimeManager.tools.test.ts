import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { RuntimeManager } from "../../../src/runtime/runtimeManager";
import { WorkspaceToolExecutor } from "../../../src/runtime/tools/workspaceToolExecutor";
import { PermissionManager } from "../../../src/permissions/permissionManager";
import { createDefaultPermissionPolicy } from "../../../src/permissions/permissionPolicy";
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
  const workspaceState = {
    get: vi.fn(() => []),
    update: vi.fn().mockResolvedValue(undefined),
  };
  return {
    loadSessions: () => [],
    loadActiveSessionId: () => undefined,
    saveSessions: vi.fn().mockResolvedValue(undefined),
    saveActiveSessionId: vi.fn().mockResolvedValue(undefined),
    workspaceState,
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

describe("RuntimeManager local tools", () => {
  it("allow executes write_file and deny prevents it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-rm-"));
    const permissionManager = new PermissionManager(createDefaultPermissionPolicy({ isWorkspaceTrusted: () => true }));
    const runtime = new ScriptedRuntime(async (request, emit) => {
      const allowed = await request.onToolCall?.(
        { id: "1", name: "write_file", input: { path: "ok.py", content: "ok" } },
        request.signal,
      );
      const denied = await request.onToolCall?.(
        { id: "2", name: "write_file", input: { path: "nope.py", content: "nope" } },
        request.signal,
      );
      await emit({
        type: "assistant_message",
        sessionId: request.sessionId,
        message: JSON.stringify({ allowed: allowed?.allowed, denied: denied?.allowed }),
        timestamp: Date.now(),
      });
    });

    const manager = new RuntimeManager({
      sessionStore: createStore() as never,
      permissionManager,
      runtimes: [runtime],
      toolExecutor: new WorkspaceToolExecutor(),
      defaultWorkspacePath: root,
    });
    await manager.setProvider({ provider: "mock" });
    const session = manager.createSession(root);

    const pending: string[] = [];
    manager.onDidPublishEvent((event) => {
      if (event.type === "permission_request") {
        pending.push(event.request.requestId);
        const decision = event.request.path === "ok.py" ? "ALLOW" : "DENY";
        manager.resolvePermission(event.request.requestId, decision);
      }
    });

    await manager.startTask(session.sessionId, "write files");

    expect(await fs.readFile(path.join(root, "ok.py"), "utf8")).toBe("ok");
    await expect(fs.readFile(path.join(root, "nope.py"), "utf8")).rejects.toThrow();
    expect(manager.getSession(session.sessionId)?.status).not.toBe("RUNNING");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("cancel stops a run and leaves the session idle enough to send again", async () => {
    const permissionManager = new PermissionManager(createDefaultPermissionPolicy({ isWorkspaceTrusted: () => true }));
    let attempts = 0;
    const runtime = new ScriptedRuntime(async (request, emit) => {
      attempts += 1;
      if (attempts === 1) {
        await new Promise<void>((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("not cancelled")), 5_000);
          request.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
          });
        });
      }
      await emit({
        type: "assistant_message",
        sessionId: request.sessionId,
        message: "second",
        timestamp: Date.now(),
      });
    });
    const manager = new RuntimeManager({
      sessionStore: createStore() as never,
      permissionManager,
      runtimes: [runtime],
      toolExecutor: new WorkspaceToolExecutor(),
    });
    await manager.setProvider({ provider: "mock" });
    const session = manager.createSession(".");
    const started = manager.startTask(session.sessionId, "hang");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await manager.cancelTask(session.sessionId);
    await started;
    expect(manager.getSession(session.sessionId)?.status).toBe("CANCELLED");
    await manager.startTask(session.sessionId, "again");
    expect(manager.getSession(session.sessionId)?.status).not.toBe("RUNNING");
  });
});
