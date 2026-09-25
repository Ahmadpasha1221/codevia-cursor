import * as vscode from "vscode";
import { CursorClient } from "../auth/cursorClient";
import { SessionStore } from "../session/sessionStore";
import { AgentSession } from "./agentSession";
import { AgentEvent } from "./agentEvents";
import { PermissionManager } from "../permissions/permissionManager";
import type { TranscriptEntry, TranscriptStore } from "../session/transcriptStore";
import type { Run } from "@cursor/sdk";
import { CursorAuthError } from "../auth/cursorAuthError";
import {
  extractTextContent,
  extractToolCallInfo,
  isAssistantMessage,
  isThinkingMessage,
  isToolCallMessage,
} from "./cursorRunMessage";

export class AgentManager {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly activeRuns = new Map<string, { agentId: string; run: unknown }>();
  private readonly emitter = new vscode.EventEmitter<AgentEvent>();
  private activeSessionId?: string;
  private persistenceQueue: Promise<void> = Promise.resolve();

  readonly onDidPublishEvent = this.emitter.event;

  constructor(
    private readonly cursorClient: CursorClient,
    private readonly sessionStore: SessionStore,
    private readonly permissionManager: PermissionManager,
    private readonly transcriptStore?: TranscriptStore,
  ) {}

  async loadTranscript(sessionId: string): Promise<TranscriptEntry[]> {
    return this.transcriptStore?.load(sessionId) ?? [];
  }

  async restoreSessions(): Promise<void> {
    const loaded = this.sessionStore.loadSessions();
    const now = Date.now();

    this.sessions.clear();
    this.activeSessionId = undefined;

    for (const session of loaded) {
      if (session.provider !== "cursor") {
        continue;
      }
      if (this.isNonTerminal(session.status)) {
        session.status = "DISCONNECTED";
        session.updatedAt = new Date(now);
      }
      this.sessions.set(session.sessionId, session);
    }

    const persistedActiveSessionId = this.sessionStore.loadActiveSessionId();
    this.activeSessionId = persistedActiveSessionId && this.sessions.has(persistedActiveSessionId)
      ? persistedActiveSessionId
      : this.getMostRecentSessionId();

    await Promise.all([
      this.sessionStore.saveSessions(Array.from(this.sessions.values())),
      this.sessionStore.saveActiveSessionId(this.activeSessionId),
    ]);

    for (const session of this.sessions.values()) {
      if (session.status === "DISCONNECTED") {
        this.publishEvent({ type: "agent_disconnected", sessionId: session.sessionId, timestamp: now });
      }
    }
  }

  createSession(workspacePath: string): AgentSession {
    const session: AgentSession = {
      sessionId: crypto.randomUUID(),
      provider: "cursor",
      workspacePath,
      status: "IDLE",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(session.sessionId, session);
    this.activeSessionId = session.sessionId;
    this.enqueuePersistence();
    return session;
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  get activeSession(): AgentSession | undefined {
    if (this.activeSessionId) {
      return this.sessions.get(this.activeSessionId);
    }
    return undefined;
  }

  listSessions(): AgentSession[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );
  }

  selectSession(sessionId: string): boolean {
    if (!this.sessions.has(sessionId)) {
      return false;
    }
    this.activeSessionId = sessionId;
    this.enqueuePersistence();
    return true;
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.activeRuns.delete(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = undefined;
    }
    try {
      await this.transcriptStore?.delete(sessionId);
    } catch {
      // Transcript cleanup is best-effort.
    }
    this.enqueuePersistence();
  }

  async startTask(
    sessionId: string,
    prompt: string,
    cancellationToken?: vscode.CancellationToken,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (!this.cursorClient.hasApiKey()) {
      throw new CursorAuthError("Connect a Cursor API key before sending a prompt.", 401);
    }

    if (session.status === "RUNNING" || session.status === "STARTING") {
      throw new Error(`Session is already running: ${sessionId}`);
    }

    if (cancellationToken?.isCancellationRequested) {
      this.updateSession(sessionId, { status: "CANCELLED" });
      this.publishEvent({ type: "agent_cancelled", sessionId, timestamp: Date.now() });
      return;
    }

    this.updateSession(sessionId, { status: "STARTING", currentTask: prompt });
    void this.recordTranscript(sessionId, { kind: "user", text: prompt, timestamp: Date.now() });
    this.publishEvent({ type: "agent_started", sessionId, timestamp: Date.now() });

    let agentId: string;
    try {
      const disallowedTools = this.permissionManager.policy.getDisallowedToolNames();
      const agent = await this.cursorClient.createAgent({
        name: `session-${sessionId}`,
        workspacePath: session.workspacePath,
        disallowedTools: disallowedTools.length > 0 ? disallowedTools : undefined,
      });
      agentId = agent.agentId;
      this.updateSession(sessionId, { agentId, status: "READY" });
    } catch (error) {
      this.updateSession(sessionId, { status: "FAILED", error: { message: String(error), category: "agent_create" } });
      throw error;
    }

    this.updateSession(sessionId, { status: "RUNNING", currentTask: prompt });
    this.publishEvent({ type: "agent_started", sessionId, timestamp: Date.now() });

    if (cancellationToken?.isCancellationRequested) {
      await this.cancelTask(sessionId);
      return;
    }

    try {
      const run = await this.cursorClient.sendMessage(agentId, prompt);
      this.activeRuns.set(sessionId, { agentId, run });
      this.updateSession(sessionId, { runId: run.id, status: "RUNNING" });

      const cancelled = await this.consumeRunMessages(sessionId, run, cancellationToken);
      if (cancelled) {
        if (session.status !== "CANCELLED") {
          this.updateSession(sessionId, { status: "CANCELLED" });
          this.publishEvent({ type: "agent_cancelled", sessionId, timestamp: Date.now() });
        }
        return;
      }

      const result = await this.cursorClient.waitRun(run);
      if (result.status === "finished") {
        this.updateSession(sessionId, { status: "COMPLETED" });
        this.publishEvent({ type: "agent_completed", sessionId, timestamp: Date.now() });
      } else if (result.status === "cancelled") {
        this.updateSession(sessionId, { status: "CANCELLED" });
        this.publishEvent({ type: "agent_cancelled", sessionId, timestamp: Date.now() });
      } else {
        this.updateSession(sessionId, { status: "FAILED", error: { message: result.status, category: "run_status" } });
        this.publishEvent({ type: "agent_error", sessionId, error: result.status, category: "run_status", timestamp: Date.now() });
      }
    } catch (error) {
      this.updateSession(sessionId, { status: "FAILED", error: { message: String(error), category: "run" } });
      this.publishEvent({ type: "agent_error", sessionId, error: String(error), category: "run", timestamp: Date.now() });
      throw error;
    } finally {
      this.activeRuns.delete(sessionId);
      this.permissionManager.cancelSessionRequests(sessionId);
    }
  }

  /**
   * Consumes the Cursor SDK run stream and enforces permission policy on
   * observed tool calls. The SDK does not support pausing or approving
   * individual tool calls mid-run, so enforcement is observation-based:
   * auto-allowed operations continue, and denied/cancelled/timed-out
   * operations cause the whole run to be cancelled.
   */
  private async recordTranscript(sessionId: string, entry: TranscriptEntry): Promise<void> {
    try {
      await this.transcriptStore?.append(sessionId, entry);
    } catch {
      // Transcript persistence must never break an agent run.
    }
  }

  private async consumeRunMessages(
    sessionId: string,
    run: Run,
    cancellationToken?: vscode.CancellationToken,
  ): Promise<boolean> {
    let cancelled = false;

    for await (const message of this.cursorClient.streamRunMessages(run)) {
      if (cancellationToken?.isCancellationRequested) {
        await this.cancelTask(sessionId);
        cancelled = true;
        return cancelled;
      }

      if (isAssistantMessage(message)) {
        const text = extractTextContent(message);
        if (text) {
          void this.recordTranscript(sessionId, { kind: "assistant", text, timestamp: Date.now() });
          this.publishEvent({ type: "assistant_message", sessionId, message: text, timestamp: Date.now() });
        }
        continue;
      }

      if (isThinkingMessage(message)) {
        const text = extractTextContent(message);
        if (text) {
          void this.recordTranscript(sessionId, { kind: "thinking", text, timestamp: Date.now() });
          this.publishEvent({ type: "agent_thinking", sessionId, message: text, timestamp: Date.now() });
        }
        continue;
      }

      if (!isToolCallMessage(message)) {
        continue;
      }

      const toolCall = (message.message as { status?: string }).status;
      if (toolCall !== "running") {
        this.publishEvent({
          type: "tool_finished",
          sessionId,
          toolName: extractToolCallInfo(message)?.toolName ?? "unknown",
          timestamp: Date.now(),
        });
        continue;
      }

      const info = extractToolCallInfo(message);
      if (!info) {
        continue;
      }

      void this.recordTranscript(sessionId, {
        kind: "tool",
        text: `Using ${info.toolName}`,
        timestamp: Date.now(),
        toolName: info.toolName,
        ...(info.command ? { command: info.command } : {}),
        ...(info.path ? { path: info.path } : {}),
      });

      const request = this.permissionManager.buildRequest(
        sessionId,
        info.toolName,
        info.command,
        info.path,
      );

      this.publishEvent({
        type: "tool_started",
        sessionId,
        toolName: info.toolName,
        timestamp: Date.now(),
      });

      if (this.permissionManager.isBlockedByTrust(request)) {
        this.publishEvent({
          type: "agent_permission",
          sessionId,
          request,
        });
        await this.cancelRunSafely(sessionId, run);
        cancelled = true;
        return cancelled;
      }

      if (this.permissionManager.shouldAutoAllow(request)) {
        this.publishEvent({
          type: "agent_permission",
          sessionId,
          request,
        });
        continue;
      }

      this.publishEvent({
        type: "agent_permission",
        sessionId,
        request,
      });

      try {
        const resolution = await this.permissionManager.requestPermission(request);
        if (resolution.status !== "allowed") {
          await this.cancelRunSafely(sessionId, run);
          cancelled = true;
          return cancelled;
        }
      } catch {
        await this.cancelRunSafely(sessionId, run);
        cancelled = true;
        return cancelled;
      }
    }

    return cancelled;
  }

  private async cancelRunSafely(
    sessionId: string,
    run: Run,
  ): Promise<void> {
    try {
      await this.cursorClient.cancelRun(run);
    } catch {
      // Cancellation errors are non-fatal; the run will be cleaned up on wait.
    }
    this.permissionManager.cancelSessionRequests(sessionId);
  }

  async cancelTask(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.status === "RUNNING" || session.status === "STARTING") {
      this.updateSession(sessionId, { status: "CANCELLING" });
      this.permissionManager.cancelSessionRequests(sessionId);
      const activeRun = this.activeRuns.get(sessionId);
      if (activeRun) {
        try {
          await this.cursorClient.cancelRun(activeRun.run as Parameters<CursorClient["cancelRun"]>[0]);
        } catch {
          // Cancellation is best-effort; pending permissions and session state are still cleaned up.
        }
      }
      this.updateSession(sessionId, { status: "CANCELLED" });
      this.publishEvent({ type: "agent_cancelled", sessionId, timestamp: Date.now() });
    }
  }

  dispose(): void {
    for (const sessionId of Array.from(this.activeRuns.keys())) {
      this.cancelTask(sessionId).catch(() => { });
    }
    this.emitter.dispose();
  }

  private isNonTerminal(status: AgentSession["status"]): boolean {
    return ["IDLE", "STARTING", "READY", "RUNNING", "CANCELLING"].includes(status);
  }

  private getMostRecentSessionId(): string | undefined {
    const sessions = this.listSessions();
    return sessions[0]?.sessionId;
  }

  private updateSession(sessionId: string, patch: Partial<AgentSession>): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    Object.assign(session, patch, { updatedAt: new Date() });
    this.enqueuePersistence();
  }

  private enqueuePersistence(): void {
    this.persistenceQueue = this.persistenceQueue
      .then(() => this.saveSessions())
      .catch(() => undefined);
  }

  private async saveSessions(): Promise<void> {
    try {
      await Promise.all([
        this.sessionStore.saveSessions(Array.from(this.sessions.values())),
        this.sessionStore.saveActiveSessionId(this.activeSessionId),
      ]);
    } catch {
      return;
    }
  }

  private publishEvent(event: AgentEvent): void {
    this.emitter.fire(event);
  }
}
