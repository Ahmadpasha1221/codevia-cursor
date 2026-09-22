import type { PermissionRequest } from "../permissions/permissionTypes";

export type RuntimeProvider = "cursor" | "ollama" | "openai-compatible" | "mock";

export type RuntimeProviderFamily = "agent" | "inference" | "mock";

export interface ModelCapabilities {
  readonly streaming: boolean;
  readonly toolCalling: boolean;
  readonly structuredOutput: boolean;
  readonly codeEditing?: boolean;
  readonly reasoning?: boolean;
}

export interface RuntimeModel {
  readonly id: string;
  readonly name: string;
  readonly provider: RuntimeProvider;
  readonly contextWindow?: number;
  readonly capabilities?: ModelCapabilities;
}

export type RuntimeSessionStatus =
  | "IDLE"
  | "STARTING"
  | "READY"
  | "RUNNING"
  | "CANCELLING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "DISCONNECTED";

export interface RuntimeErrorInfo {
  readonly message: string;
  readonly category: string;
}

export interface CodeviaSession {
  readonly sessionId: string;
  readonly provider: RuntimeProvider;
  readonly modelId?: string;
  readonly workspacePath: string;
  readonly providerSessionId?: string;
  readonly agentId?: string;
  readonly runId?: string;
  readonly status: RuntimeSessionStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly currentTask?: string;
  readonly error?: RuntimeErrorInfo;
}

export interface RuntimeMessage {
  readonly role: "user" | "assistant" | "tool";
  readonly content?: string;
  readonly toolCall?: RuntimeToolCall;
  readonly toolResult?: RuntimeToolResult;
}

export interface RuntimeToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface RuntimeToolResult {
  readonly toolCallId: string;
  readonly name: string;
  readonly result?: unknown;
  readonly error?: string;
}

export interface RuntimeToolCallResponse {
  readonly allowed: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

export type RuntimeErrorCode =
  | "provider_unavailable"
  | "authentication_failed"
  | "no_models_found"
  | "model_unavailable"
  | "network_error"
  | "unsupported_capability"
  | "agent_not_found"
  | "session_not_found"
  | "invalid_configuration"
  | "cancelled"
  | "unknown";

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: RuntimeErrorCode,
    message: string,
    options: { readonly retryable?: boolean; readonly details?: Record<string, unknown>; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "RuntimeError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export interface RuntimeAvailability {
  readonly available: boolean;
  readonly status: "connected" | "disconnected" | "error";
  readonly message?: string;
}

export interface RuntimeSessionRequest {
  readonly sessionId: string;
  readonly workspacePath: string;
  readonly modelId?: string;
}

export interface RuntimeResumeRequest {
  readonly sessionId: string;
  readonly providerSessionId: string;
  readonly workspacePath: string;
  readonly modelId?: string;
}

export interface RuntimeSendRequest {
  readonly sessionId: string;
  readonly providerSessionId?: string;
  readonly workspacePath: string;
  readonly modelId?: string;
  readonly prompt: string;
  readonly messages?: readonly RuntimeMessage[];
  readonly signal?: AbortSignal;
  readonly onToolCall?: (
    call: RuntimeToolCall,
    signal?: AbortSignal,
  ) => Promise<RuntimeToolCallResponse>;
}

export interface RuntimeCancelRequest {
  readonly sessionId: string;
  readonly providerSessionId?: string;
  readonly runId?: string;
  readonly signal?: AbortSignal;
}

export type RuntimeEvent =
  | { type: "status"; sessionId: string; status: RuntimeSessionStatus; timestamp: number }
  | { type: "thinking"; sessionId: string; message: string; timestamp: number }
  | { type: "text_delta"; sessionId: string; text: string; timestamp: number }
  | { type: "assistant_message"; sessionId: string; message: string; timestamp: number }
  | { type: "tool_call"; sessionId: string; toolCall: RuntimeToolCall; timestamp: number }
  | { type: "tool_result"; sessionId: string; toolResult: RuntimeToolResult; timestamp: number }
  | { type: "permission_request"; sessionId: string; request: PermissionRequest; timestamp: number }
  | { type: "error"; sessionId: string; error: RuntimeError; timestamp: number }
  | { type: "completed"; sessionId: string; timestamp: number }
  | { type: "cancelled"; sessionId: string; timestamp: number };

export type RuntimeEventSink = (event: RuntimeEvent) => void | Promise<void>;

export type CursorRuntimeConfig = {
  readonly provider: "cursor";
  readonly modelId?: string;
};

export type OllamaRuntimeConfig = {
  readonly provider: "ollama";
  readonly baseUrl?: string;
  readonly modelId?: string;
};

export type OpenAICompatibleRuntimeConfig = {
  readonly provider: "openai-compatible";
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey?: string;
};

export type MockRuntimeConfig = {
  readonly provider: "mock";
  readonly scenario?: MockRuntimeScenario;
  readonly delayMs?: number;
};

export type MockRuntimeScenario =
  | "default"
  | "streaming"
  | "tool-calls"
  | "error"
  | "cancellation"
  | "long-running"
  | "permission"
  | "provider-unavailable"
  | "model-unavailable";

export type RuntimeProviderConfig =
  | CursorRuntimeConfig
  | OllamaRuntimeConfig
  | OpenAICompatibleRuntimeConfig
  | MockRuntimeConfig;

export interface ResolvedRuntimeConfig {
  readonly provider: RuntimeProvider;
  readonly modelId?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly scenario?: MockRuntimeScenario;
  readonly delayMs?: number;
}

export interface RuntimeToolExecutorContext {
  readonly session: CodeviaSession;
  readonly signal?: AbortSignal;
}

export interface RuntimeToolExecutor {
  execute(call: RuntimeToolCall, context: RuntimeToolExecutorContext): Promise<unknown>;
}

export interface AgentRuntime {
  readonly provider: RuntimeProvider;
  readonly family: RuntimeProviderFamily;
  configure(config: RuntimeProviderConfig): Promise<void>;
  checkAvailability(signal?: AbortSignal): Promise<RuntimeAvailability>;
  discoverModels(signal?: AbortSignal): Promise<RuntimeModel[]>;
  createSession(request: RuntimeSessionRequest): Promise<{ providerSessionId?: string }>;
  resumeSession(request: RuntimeResumeRequest): Promise<{ providerSessionId?: string }>;
  sendMessage(request: RuntimeSendRequest, emit: RuntimeEventSink): Promise<void>;
  cancel(request: RuntimeCancelRequest): Promise<void>;
  dispose(): void;
}
