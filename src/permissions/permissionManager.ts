import * as vscode from "vscode";
import { PermissionPolicy } from "./permissionPolicy";
import {
  PermissionCategory,
  PermissionDecision,
  PermissionDecisionMessage,
  PermissionEvent,
  PermissionRequest,
  PermissionResolution,
  PendingPermissionRequest,
} from "./permissionTypes";

export class PermissionManager implements vscode.Disposable {
  private readonly pending = new Map<string, PendingPermissionRequest>();
  private readonly emitter = new vscode.EventEmitter<PermissionEvent>();

  readonly onDidRequest = this.emitter.event;

  constructor(public readonly policy: PermissionPolicy) {}

  classify(toolName: string | undefined, command: string | undefined, path: string | undefined): PermissionCategory {
    return this.policy.classify(toolName, command, path);
  }

  isDestructive(toolName: string, command: string, path: string | undefined): boolean {
    return this.policy.isDestructive(toolName, command, path);
  }

  describe(request: PermissionRequest): string {
    return this.policy.describe(request);
  }

  shouldAutoAllow(request: PermissionRequest): boolean {
    return this.policy.shouldAutoAllow(request);
  }

  isBlockedByTrust(request: PermissionRequest): boolean {
    return this.policy.isBlockedByTrust(request);
  }

  getDefaultTimeoutMs(request: PermissionRequest): number {
    return this.policy.getDefaultTimeoutMs(request);
  }

  buildRequest(
    sessionId: string,
    toolName: string | undefined,
    command: string | undefined,
    path: string | undefined,
    description?: string,
  ): PermissionRequest {
    return {
      requestId: crypto.randomUUID(),
      sessionId,
      category: this.classify(toolName, command, path),
      toolName,
      command,
      path,
      description: description ?? this.describe({ category: this.classify(toolName, command, path), toolName, command, path, destructive: this.isDestructive((toolName ?? "").toLowerCase(), (command ?? "").toLowerCase(), path) } as PermissionRequest),
      destructive: this.isDestructive((toolName ?? "").toLowerCase(), (command ?? "").toLowerCase(), path),
    };
  }

  requestPermission(request: PermissionRequest, signal?: AbortSignal): Promise<PermissionResolution> {
    if (this.pending.has(request.requestId)) {
      return Promise.reject(new Error(`Duplicate permission request: ${request.requestId}`));
    }

    const timeoutMs = this.policy.getDefaultTimeoutMs(request);
    const timeout = setTimeout(() => this.resolve(request.requestId, "timed_out"), timeoutMs);

    return new Promise<PermissionResolution>((resolve, reject) => {
      if (signal?.aborted) {
        clearTimeout(timeout);
        reject(new Error("Permission request cancelled"));
        return;
      }

      const pending: PendingPermissionRequest = {
        request,
        resolve,
        timeout,
      };
      this.pending.set(request.requestId, pending);
      this.emitter.fire({ type: "permission_requested", request });

      signal?.addEventListener(
        "abort",
        () => {
          this.resolve(request.requestId, "cancelled");
        },
        { once: true },
      );
    });
  }

  resolveDecision(message: PermissionDecisionMessage): PermissionResolution | undefined {
    const pending = this.pending.get(message.requestId);
    if (!pending) {
      return undefined;
    }

    if (pending.request.destructive && message.decision === "ALLOW" && message.confirmation !== true) {
      return this.resolve(message.requestId, "denied");
    }

    const status: "allowed" | "denied" = message.decision === "ALLOW" ? "allowed" : "denied";
    return this.resolve(message.requestId, status);
  }

  cancelRequest(requestId: string): void {
    this.resolve(requestId, "cancelled");
  }

  cancelAll(): void {
    for (const requestId of Array.from(this.pending.keys())) {
      this.resolve(requestId, "cancelled");
    }
  }

  /**
   * Cancels every pending permission request for the given session. Used
   * when a run finishes, fails, or is cancelled so no stale promises or
   * timers survive.
   */
  cancelSessionRequests(sessionId: string): void {
    for (const [requestId, pending] of Array.from(this.pending.entries())) {
      if (pending.request.sessionId === sessionId) {
        this.resolve(requestId, "cancelled");
      }
    }
  }

  /**
   * Returns a snapshot of pending requests for a session, useful for audit.
   */
  getPendingForSession(sessionId: string): readonly PermissionRequest[] {
    const result: PermissionRequest[] = [];
    for (const pending of this.pending.values()) {
      if (pending.request.sessionId === sessionId) {
        result.push(pending.request);
      }
    }
    return result;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  dispose(): void {
    this.cancelAll();
    this.emitter.dispose();
  }

  private resolve(requestId: string, status: "allowed" | "denied" | "cancelled" | "timed_out"): PermissionResolution {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return { requestId, status, timestamp: Date.now() };
    }

    clearTimeout(pending.timeout);
    this.pending.delete(requestId);

    const resolution: PermissionResolution = {
      requestId,
      status,
      timestamp: Date.now(),
    };

    pending.resolve(resolution);
    this.emitter.fire({ type: "permission_resolved", resolution });
    return resolution;
  }
}

export function isPermissionDecision(value: unknown): value is PermissionDecision {
  return value === "ALLOW" || value === "DENY";
}

export function isPermissionDecisionMessage(value: unknown): value is PermissionDecisionMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.requestId === "string" && isPermissionDecision(record.decision);
}