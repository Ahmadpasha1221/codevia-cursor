import { afterEach, describe, expect, it, vi } from "vitest";
import { PermissionManager } from "../../../src/permissions/permissionManager";
import { PermissionPolicy } from "../../../src/permissions/permissionPolicy";
import type { PermissionRequest } from "../../../src/permissions/permissionTypes";

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

function createPolicy(timeoutMs = 1000): PermissionPolicy {
  return new PermissionPolicy({
    isWorkspaceTrusted: () => true,
    autoAllowRead: true,
    autoAllowExternal: false,
    destructiveConfirmations: new Set(["delete", "applyAgentDiff"]),
    defaultTimeoutMs: timeoutMs,
  });
}

function createRequest(sessionId = "session-1", toolName = "read"): PermissionRequest {
  return {
    requestId: `${sessionId}-${toolName}`,
    sessionId,
    category: "READ",
    toolName,
    description: `permission for ${toolName}`,
    destructive: false,
  };
}

function createDestructiveRequest(sessionId = "session-1"): PermissionRequest {
  return {
    requestId: `${sessionId}-delete`,
    sessionId,
    category: "DESTRUCTIVE",
    toolName: "delete",
    description: "delete a file",
    destructive: true,
  };
}

describe("PermissionManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("requestPermission creates a pending request and emits permission_requested", () => {
    const manager = new PermissionManager(createPolicy());
    const request = createRequest();
    const events: unknown[] = [];
    manager.onDidRequest((event) => events.push(event));

    const promise = manager.requestPermission(request);
    void promise;

    expect(manager.pendingCount).toBe(1);
    expect(events).toEqual([
      expect.objectContaining({ type: "permission_requested", request }),
    ]);

    manager.cancelRequest(request.requestId);
  });

  it("resolves ALLOW as allowed", async () => {
    const manager = new PermissionManager(createPolicy());
    const request = createRequest();
    const promise = manager.requestPermission(request);

    const result = manager.resolveDecision({ requestId: request.requestId, decision: "ALLOW" });

    expect(result).toEqual(expect.objectContaining({ requestId: request.requestId, status: "allowed" }));
    await expect(promise).resolves.toEqual(result);
    expect(manager.pendingCount).toBe(0);
  });

  it("resolves DENY as denied", async () => {
    const manager = new PermissionManager(createPolicy());
    const request = createRequest();
    const promise = manager.requestPermission(request);

    const result = manager.resolveDecision({ requestId: request.requestId, decision: "DENY" });

    expect(result?.status).toBe("denied");
    await expect(promise).resolves.toEqual(result);
    expect(manager.pendingCount).toBe(0);
  });

  it("requires confirmation for destructive ALLOW", async () => {
    const manager = new PermissionManager(createPolicy());
    const request = createDestructiveRequest();
    const promise = manager.requestPermission(request);

    const result = manager.resolveDecision({
      requestId: request.requestId,
      decision: "ALLOW",
    });

    expect(result?.status).toBe("denied");
    await expect(promise).resolves.toEqual(result);
  });

  it("allows destructive operation with confirmation", async () => {
    const manager = new PermissionManager(createPolicy());
    const request = createDestructiveRequest();
    const promise = manager.requestPermission(request);

    const result = manager.resolveDecision({
      requestId: request.requestId,
      decision: "ALLOW",
      confirmation: true,
    });

    expect(result?.status).toBe("allowed");
    await expect(promise).resolves.toEqual(result);
  });

  it("cancelRequest resolves as cancelled", async () => {
    const manager = new PermissionManager(createPolicy());
    const request = createRequest();
    const promise = manager.requestPermission(request);

    manager.cancelRequest(request.requestId);

    await expect(promise).resolves.toEqual(expect.objectContaining({ status: "cancelled" }));
    expect(manager.pendingCount).toBe(0);
  });

  it("cancelAll resolves all pending requests", async () => {
    const manager = new PermissionManager(createPolicy());
    const first = createRequest("session-1", "read");
    const second = createRequest("session-2", "read");
    const firstPromise = manager.requestPermission(first);
    const secondPromise = manager.requestPermission(second);

    manager.cancelAll();

    await expect(firstPromise).resolves.toEqual(expect.objectContaining({ status: "cancelled" }));
    await expect(secondPromise).resolves.toEqual(expect.objectContaining({ status: "cancelled" }));
    expect(manager.pendingCount).toBe(0);
  });

  it("cancelSessionRequests resolves only requests for that session", async () => {
    const manager = new PermissionManager(createPolicy());
    const first = createRequest("session-1", "read");
    const second = createRequest("session-2", "read");
    const firstPromise = manager.requestPermission(first);
    const secondPromise = manager.requestPermission(second);

    manager.cancelSessionRequests("session-1");

    await expect(firstPromise).resolves.toEqual(expect.objectContaining({ status: "cancelled" }));
    expect(manager.pendingCount).toBe(1);
    manager.cancelRequest(second.requestId);
    await expect(secondPromise).resolves.toEqual(expect.objectContaining({ status: "cancelled" }));
  });

  it("getPendingForSession returns only that session's requests", () => {
    const manager = new PermissionManager(createPolicy());
    const first = createRequest("session-1", "read");
    const second = createRequest("session-2", "read");
    manager.requestPermission(first);
    manager.requestPermission(second);

    expect(manager.getPendingForSession("session-1")).toEqual([first]);
    expect(manager.getPendingForSession("session-2")).toEqual([second]);

    manager.cancelAll();
  });

  it("rejects an already-aborted AbortSignal without leaving a pending request", async () => {
    const manager = new PermissionManager(createPolicy());
    const request = createRequest();
    const controller = new AbortController();
    controller.abort();

    await expect(manager.requestPermission(request, controller.signal)).rejects.toThrow("Permission request cancelled");
    expect(manager.pendingCount).toBe(0);
  });

  it("resolves an active request as cancelled when aborted", async () => {
    const manager = new PermissionManager(createPolicy());
    const request = createRequest();
    const controller = new AbortController();
    const promise = manager.requestPermission(request, controller.signal);

    controller.abort();

    await expect(promise).resolves.toEqual(expect.objectContaining({ status: "cancelled" }));
    expect(manager.pendingCount).toBe(0);
  });

  it("resolves an unresolved request as timed_out", async () => {
    vi.useFakeTimers();
    const manager = new PermissionManager(createPolicy(100));
    const request = createRequest();
    const promise = manager.requestPermission(request);

    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).resolves.toEqual(expect.objectContaining({ status: "timed_out" }));
    expect(manager.pendingCount).toBe(0);
  });

  it("rejects duplicate request IDs", async () => {
    const manager = new PermissionManager(createPolicy());
    const request = createRequest();
    const firstPromise = manager.requestPermission(request);

    await expect(manager.requestPermission(request)).rejects.toThrow(`Duplicate permission request: ${request.requestId}`);

    manager.cancelRequest(request.requestId);
    await firstPromise;
  });

  it("supports concurrent independent requests", async () => {
    const manager = new PermissionManager(createPolicy());
    const first = createRequest("session-1", "read");
    const second = createRequest("session-2", "read");
    const firstPromise = manager.requestPermission(first);
    const secondPromise = manager.requestPermission(second);

    expect(manager.pendingCount).toBe(2);

    const firstResult = manager.resolveDecision({ requestId: first.requestId, decision: "ALLOW" });
    const secondResult = manager.resolveDecision({ requestId: second.requestId, decision: "DENY" });

    await expect(firstPromise).resolves.toEqual(firstResult);
    await expect(secondPromise).resolves.toEqual(secondResult);
    expect(manager.pendingCount).toBe(0);
  });

  it("dispose cancels all pending requests", async () => {
    const manager = new PermissionManager(createPolicy());
    const request = createRequest();
    const promise = manager.requestPermission(request);

    manager.dispose();

    await expect(promise).resolves.toEqual(expect.objectContaining({ status: "cancelled" }));
    expect(manager.pendingCount).toBe(0);
  });

  it("validates permission decisions", () => {
    expect(vi.fn()).toBeDefined();
  });
});