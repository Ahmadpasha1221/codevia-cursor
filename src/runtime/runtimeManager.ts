import * as vscode from "vscode";
import type { PermissionManager } from "../permissions/permissionManager";
import type { SessionStore } from "../session/sessionStore";
import type { Logger } from "../utils/logger";
import {
  AgentRuntime,
  CodeviaSession,
  ResolvedRuntimeConfig,
  RuntimeError,
  RuntimeEvent,
  RuntimeModel,
  RuntimeProviderConfig,
  RuntimeSessionStatus,
  RuntimeToolCall,
  RuntimeToolCallResponse,
  RuntimeToolExecutor,
} from "./runtimeTypes";

export interface RuntimeManagerOptions {
  readonly sessionStore: SessionStore;
  readonly permissionManager: PermissionManager;
  readonly runtimes: readonly AgentRuntime[];
  readonly logger?: Pick<Logger, "info" | "warn" | "error">;
  readonly toolExecutor?: RuntimeToolExecutor;
  readonly defaultWorkspacePath?: string;
}

interface ActiveRun {
  readonly controller: AbortController;
  providerSessionId?: string;
}

export class RuntimeManager implements vscode.Disposable {
  private readonly runtimes = new Map<AgentRuntime["provider"], AgentRuntime>();
  private readonly sessions = new Map<string, CodeviaSession>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly emitter = new vscode.EventEmitter<RuntimeEvent>();
  private readonly persistenceQueue: Promise<void>;
  private activeProvider?: RuntimeProviderConfig["provider"];
  private activeConfig?: RuntimeProviderConfig;
  private activeSessionId?: string;

  readonly onDidPublishEvent = this.emitter.event;

  constructor(private readonly options: RuntimeManagerOptions) {
    this.persistenceQueue = Promise.resolve();
    for (const runtime of options.runtimes) {
      this.runtimes.set(runtime.provider, runtime);
    }
  }

  get activeSession(): CodeviaSession | undefined {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined;
  }

  get provider(): RuntimeProviderConfig["provider"] | undefined {
    return this.activeProvider;
  }

  registerRuntime(runtime: AgentRuntime): void {
    this.runtimes.set(runtime.provider, runtime);
    if (!this.activeProvider) {
      this.activeProvider = runtime.provider;
    }
  }

  async setProvider(config: RuntimeProviderConfig): Promise<void> {
    const runtime = this.getRequiredRuntime(config.provider);
    await runtime.configure(config);
    this.activeProvider = config.provider;
    this.activeConfig = config;
    this.options.logger?.info("Runtime provider selected", {
      operation: "setProvider",
      sessionId: this.activeSessionId,
    });
    this.publishEvent({
      type: "status",
      sessionId: this.activeSessionId ?? "runtime",
      status: "IDLE",
      timestamp: Date.now(),
    });
  }

  getProviderConfig(): ResolvedRuntimeConfig | undefined {
    if (!this.activeConfig) {
      return undefined;
    }

    const config = this.activeConfig;
    if (config.provider === "openai-compatible") {
      return {
        provider: config.provider,
        baseUrl: config.baseUrl,
        modelId: config.modelId,
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      };
    }
    if (config.provider === "ollama") {
      return { provider: config.provider, baseUrl: config.baseUrl, modelId: config.modelId };
    }
    if (config.provider === "mock") {
      return {
        provider: config.provider,
        scenario: config.scenario,
        delayMs: config.delayMs,
      };
    }
    return { provider: config.provider, modelId: config.modelId };
  }

  async checkAvailability(signal?: AbortSignal): Promise<ReturnType<AgentRuntime["checkAvailability"]>> {
    const runtime = this.getCurrentRuntime();
    try {
      const availability = await runtime.checkAvailability(signal);
      this.options.logger?.info("Runtime availability checked", {
        operation: "checkAvailability",
        sessionId: this.activeSessionId,
      });
      return availability;
    } catch (error) {
      const runtimeError = this.toRuntimeError(error, "availability");
      this.options.logger?.warn("Runtime availability check failed", {
        operation: "checkAvailability",
        sessionId: this.activeSessionId,
      });
      throw runtimeError;
    }
  }

  async discoverModels(signal?: AbortSignal): Promise<RuntimeModel[]> {
    const runtime = this.getCurrentRuntime();
    try {
      const models = await runtime.discoverModels(signal);
      this.options.logger?.info("Runtime models discovered", {
        operation: "discoverModels",
        sessionId: this.activeSessionId,
      });
      return models;
    } catch (error) {
      throw this.toRuntimeError(error, "discoverModels");
    }
  }

  createSession(workspacePath = this.options.defaultWorkspacePath ?? "."): CodeviaSession {
    const provider = this.activeProvider ?? this.runtimes.keys().next().value;
    if (!provider) {
      throw new RuntimeError("invalid_configuration", "No runtime provider is configured.");
    }

    const now = new Date();
    const modelId = this.activeConfig && "modelId" in this.activeConfig ? this.activeConfig.modelId : undefined;
    const session: CodeviaSession = {
      sessionId: crypto.randomUUID(),
      provider,
      ...(modelId ? { modelId } : {}),
      workspacePath,
      status: "IDLE",
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(session.sessionId, session);
    this.activeSessionId = session.sessionId;
    this.enqueuePersistence();
    this.options.logger?.info("Codevia session created", {
      operation: "createSession",
      sessionId: session.sessionId,
    });
    return session;
  }

  getSession(sessionId: string): CodeviaSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): CodeviaSession[] {
    return Array.from(this.sessions.values()).sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
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
    await this.cancelTask(sessionId);
    this.sessions.delete(sessionId);
    this.activeRuns.delete(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = this.getMostRecentSessionId();
    }
    this.options.permissionManager.cancelSessionRequests(sessionId);
    this.enqueuePersistence();
  }

  async restoreSessions(): Promise<void> {
    const loaded = this.options.sessionStore.loadSessions();
    const now = Date.now();
    this.sessions.clear();
    this.activeSessionId = undefined;

    for (const session of loaded) {
      const restored: CodeviaSession = {
        ...session,
        status: this.isNonTerminal(session.status) ? "DISCONNECTED" : session.status,
        updatedAt: this.isNonTerminal(session.status) ? new Date(now) : session.updatedAt,
        ...(this.isNonTerminal(session.status) ? { runId: undefined } : {}),
      };
      this.sessions.set(restored.sessionId, restored);
    }

    const persistedActiveSessionId = this.options.sessionStore.loadActiveSessionId();
    this.activeSessionId = persistedActiveSessionId && this.sessions.has(persistedActiveSessionId)
      ? persistedActiveSessionId
      : this.getMostRecentSessionId();

    await Promise.all([
      this.options.sessionStore.saveSessions(Array.from(this.sessions.values())),
      this.options.sessionStore.saveActiveSessionId(this.activeSessionId),
    ]);

    for (const session of this.sessions.values()) {
      if (session.status === "DISCONNECTED") {
        this.publishEvent({ type: "status", sessionId: session.sessionId, status: "DISCONNECTED", timestamp: now });
      }
    }
  }

  async startTask(
    sessionId: string,
    prompt: string,
    cancellationToken?: vscode.CancellationToken,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new RuntimeError("session_not_found", `Session not found: ${sessionId}`);
    }
    if (session.status === "RUNNING" || session.status === "STARTING") {
      throw new RuntimeError("invalid_configuration", `Session is already running: ${sessionId}`);
    }

    const runtime = this.getRequiredRuntime(session.provider);
    const controller = new AbortController();
    const cancellationSubscription = cancellationToken?.onCancellationRequested(() => {
      controller.abort();
    });
    this.activeRuns.set(sessionId, {
      controller,
      providerSessionId: session.providerSessionId ?? session.agentId,
    });

    this.updateSession(sessionId, { status: "STARTING", currentTask: prompt, error: undefined });
    this.publishEvent({ type: "status", sessionId, status: "STARTING", timestamp: Date.now() });

    try {
      const providerSessionId = await this.ensureProviderSession(session, runtime, controller.signal);
      this.updateSession(sessionId, {
        providerSessionId,
        agentId: providerSessionId,
        status: "READY",
      });
      this.publishEvent({ type: "status", sessionId, status: "READY", timestamp: Date.now() });

      if (controller.signal.aborted) {
        await this.cancelTask(sessionId);
        return;
      }

      await runtime.sendMessage(
        {
          sessionId,
          providerSessionId,
          workspacePath: session.workspacePath,
          modelId: session.modelId ?? this.getModelId(session.provider),
          prompt,
          signal: controller.signal,
          onToolCall: (call, signal) => this.handleToolCall(session, call, runtime, signal),
        },
        (event) => this.handleRuntimeEvent(sessionId, event),
      );

      if (!controller.signal.aborted && session.status === "READY") {
        this.updateSession(sessionId, { status: "COMPLETED" });
        this.publishEvent({ type: "completed", sessionId, timestamp: Date.now() });
      }
    } catch (error) {
      const runtimeError = this.toRuntimeError(error, "run");
      if (runtimeError.code !== "cancelled") {
        this.updateSession(sessionId, {
          status: "FAILED",
          error: { message: runtimeError.message, category: runtimeError.code },
        });
        this.publishEvent({ type: "error", sessionId, error: runtimeError, timestamp: Date.now() });
      }
      throw runtimeError;
    } finally {
      cancellationSubscription?.dispose();
      this.activeRuns.delete(sessionId);
      this.options.permissionManager.cancelSessionRequests(sessionId);
    }
  }

  async cancelTask(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const activeRun = this.activeRuns.get(sessionId);
    if (!session || !activeRun) {
      return;
    }

    this.updateSession(sessionId, { status: "CANCELLING" });
    this.options.permissionManager.cancelSessionRequests(sessionId);
    activeRun.controller.abort();
    const runtime = this.getRequiredRuntime(session.provider);
    await runtime.cancel({
      sessionId,
      providerSessionId: activeRun.providerSessionId,
      runId: session.runId,
      signal: activeRun.controller.signal,
    });
    this.updateSession(sessionId, { status: "CANCELLED" });
    this.publishEvent({ type: "cancelled", sessionId, timestamp: Date.now() });
  }

  dispose(): void {
    for (const sessionId of Array.from(this.activeRuns.keys())) {
      void this.cancelTask(sessionId).catch(() => undefined);
    }
    for (const runtime of this.runtimes.values()) {
      runtime.dispose();
    }
    this.emitter.dispose();
  }

  private async ensureProviderSession(
    session: CodeviaSession,
    runtime: AgentRuntime,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const existingId = session.providerSessionId ?? session.agentId;
    if (!existingId) {
      const created = await runtime.createSession({
        sessionId: session.sessionId,
        workspacePath: session.workspacePath,
        modelId: session.modelId ?? this.getModelId(session.provider),
      });
      return created.providerSessionId;
    }

    try {
      const resumed = await runtime.resumeSession({
        sessionId: session.sessionId,
        providerSessionId: existingId,
        workspacePath: session.workspacePath,
        modelId: session.modelId ?? this.getModelId(session.provider),
      });
      return resumed.providerSessionId ?? existingId;
    } catch (error) {
      const runtimeError = this.toRuntimeError(error, "resume");
      if (runtimeError.code !== "agent_not_found" || signal.aborted) {
        throw runtimeError;
      }
      this.options.logger?.warn("Provider session was not found; creating a replacement", {
        operation: "resumeSession",
        sessionId: session.sessionId,
      });
      this.updateSession(session.sessionId, { providerSessionId: undefined, agentId: undefined });
      const created = await runtime.createSession({
        sessionId: session.sessionId,
        workspacePath: session.workspacePath,
        modelId: session.modelId ?? this.getModelId(session.provider),
      });
      return created.providerSessionId;
    }
  }

  private async handleToolCall(
    session: CodeviaSession,
    call: RuntimeToolCall,
    runtime: AgentRuntime,
    signal?: AbortSignal,
  ): Promise<RuntimeToolCallResponse> {
    if (runtime.family === "inference" && !this.hasToolCallingCapability(session.modelId)) {
      return {
        allowed: false,
        error: "This provider/model does not advertise tool calling.",
      };
    }

    const input = isRecord(call.input) ? call.input : {};
    const command = typeof input.command === "string" ? input.command : undefined;
    const path = typeof input.file_path === "string"
      ? input.file_path
      : typeof input.path === "string"
        ? input.path
        : undefined;
    const request = this.options.permissionManager.buildRequest(
      session.sessionId,
      call.name,
      command,
      path,
    );

    this.publishEvent({ type: "permission_request", sessionId: session.sessionId, request, timestamp: Date.now() });

    if (this.options.permissionManager.isBlockedByTrust(request)) {
      return { allowed: false, error: "The workspace trust policy blocked this tool." };
    }
    if (this.options.permissionManager.shouldAutoAllow(request)) {
      return { allowed: true };
    }

    const resolution = await this.options.permissionManager.requestPermission(request, signal);
    if (resolution.status !== "allowed") {
      return { allowed: false, error: `Permission ${resolution.status}.` };
    }

    if (this.options.toolExecutor) {
      try {
        return { allowed: true, result: await this.options.toolExecutor.execute(call, { session, signal }) };
      } catch (error) {
        return {
          allowed: true,
          error: error instanceof Error ? error.message : "Tool execution failed.",
        };
      }
    }
    return { allowed: true };
  }

  private hasToolCallingCapability(_modelId?: string): boolean {
    return false;
  }

  private handleRuntimeEvent(sessionId: string, event: RuntimeEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (event.type === "status") {
      const status = this.normalizeRuntimeStatus(event.status);
      this.updateSession(sessionId, { status });
    } else if (event.type === "completed") {
      this.updateSession(sessionId, { status: "COMPLETED" });
    } else if (event.type === "cancelled") {
      this.updateSession(sessionId, { status: "CANCELLED" });
    } else if (event.type === "error") {
      this.updateSession(sessionId, {
        status: "FAILED",
        error: { message: event.error.message, category: event.error.code },
      });
    }

    this.publishEvent(event);
  }

  private normalizeRuntimeStatus(status: RuntimeSessionStatus): RuntimeSessionStatus {
    return status;
  }

  private getCurrentRuntime(): AgentRuntime {
    const provider = this.activeProvider ?? this.runtimes.keys().next().value;
    if (!provider) {
      throw new RuntimeError("invalid_configuration", "No runtime provider is configured.");
    }
    return this.getRequiredRuntime(provider);
  }

  private getRequiredRuntime(provider: RuntimeProviderConfig["provider"]): AgentRuntime {
    const runtime = this.runtimes.get(provider);
    if (!runtime) {
      throw new RuntimeError("invalid_configuration", `Runtime provider is not registered: ${provider}`);
    }
    return runtime;
  }

  private getModelId(provider: RuntimeProviderConfig["provider"]): string | undefined {
    if (this.activeConfig?.provider !== provider) {
      return undefined;
    }
    return "modelId" in this.activeConfig ? this.activeConfig.modelId : undefined;
  }

  private toRuntimeError(error: unknown, operation: string): RuntimeError {
    if (error instanceof RuntimeError) {
      return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    if (/not found|agent.*not.*found|unknown agent/i.test(normalized)) {
      return new RuntimeError("agent_not_found", "The provider agent no longer exists. A new provider session will be created.", {
        retryable: true,
        cause: error,
      });
    }
    if (/no (cursor )?api key|unauthor|401|403|invalid api key/i.test(normalized)) {
      return new RuntimeError("authentication_failed", "Authentication failed. Connect a valid provider credential.", {
        cause: error,
      });
    }
    if (/fetch failed|network|timeout|connect.*refused|offline/i.test(normalized)) {
      return new RuntimeError("network_error", "The runtime provider is unreachable. Check its connection and try again.", {
        retryable: true,
        cause: error,
      });
    }
    if (/no model|model.*unavailable|model.*not found/i.test(normalized)) {
      return new RuntimeError("model_unavailable", "The selected model is unavailable. Choose a discovered model.", {
        cause: error,
      });
    }
    this.options.logger?.error("Runtime operation failed", {
      operation,
      sessionId: this.activeSessionId,
    });
    return new RuntimeError("unknown", "The runtime provider failed. Check the extension logs for details.", {
      cause: error,
    });
  }

  private isNonTerminal(status: RuntimeSessionStatus): boolean {
    return ["IDLE", "STARTING", "READY", "RUNNING", "CANCELLING"].includes(status);
  }

  private getMostRecentSessionId(): string | undefined {
    return this.listSessions()[0]?.sessionId;
  }

  private updateSession(sessionId: string, patch: Partial<CodeviaSession>): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    Object.assign(session, patch, { updatedAt: new Date() });
    this.enqueuePersistence();
  }

  private enqueuePersistence(): void {
    void this.persistenceQueue
      .then(() => this.saveSessions())
      .catch(() => {
        this.options.logger?.error("Failed to persist runtime sessions", {
          operation: "persistSessions",
          sessionId: this.activeSessionId,
        });
      });
  }

  private async saveSessions(): Promise<void> {
    await Promise.all([
      this.options.sessionStore.saveSessions(Array.from(this.sessions.values())),
      this.options.sessionStore.saveActiveSessionId(this.activeSessionId),
    ]);
  }

  private publishEvent(event: RuntimeEvent): void {
    this.emitter.fire(event);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type { RuntimeToolExecutor } from "./runtimeTypes";
