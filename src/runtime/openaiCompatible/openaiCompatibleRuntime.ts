import {
  AgentRuntime,
  OpenAICompatibleRuntimeConfig,
  RuntimeAvailability,
  RuntimeCancelRequest,
  RuntimeError,
  RuntimeEventSink,
  RuntimeModel,
  RuntimeProvider,
  RuntimeProviderFamily,
  RuntimeResumeRequest,
  RuntimeSendRequest,
  RuntimeSessionRequest,
  RuntimeUsage,
} from "../runtimeTypes";
import { ChatTurn, runInferenceAgentLoop } from "../tools/inferenceAgentLoop";
import { parseNativeToolCalls } from "../tools/parseToolCalls";
import { nativeChatTools } from "../tools/toolRegistry";
import { availableToolNames, type AgentMode } from "../tools/toolAvailability";
import { modelSupportsNativeTools } from "../tools/textToolFallback";
type FetchLike = typeof fetch;

function normalizeOpenAiUsage(usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined): RuntimeUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completionTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

export class OpenAICompatibleRuntime implements AgentRuntime {
  readonly provider: RuntimeProvider = "openai-compatible";
  readonly family: RuntimeProviderFamily = "inference";

  private baseUrl = "http://127.0.0.1:1234/v1";
  private modelId?: string;
  private apiKey?: string;
  private readonly histories = new Map<string, ChatTurn[]>();
  private readonly fetcher: FetchLike;

  constructor(fetcher: FetchLike = fetch) {
    this.fetcher = fetcher;
  }

  async configure(config: OpenAICompatibleRuntimeConfig): Promise<void> {
    const modelChanged = this.modelId !== undefined && this.modelId !== config.modelId;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.modelId = config.modelId;
    this.apiKey = config.apiKey;
    if (modelChanged) {
      this.histories.clear();
    }
  }

  async checkAvailability(signal?: AbortSignal): Promise<RuntimeAvailability> {
    try {
      const response = await this.request("/models", { method: "GET", signal });
      if (!response.ok) {
        return {
          available: false,
          status: "error",
          message: `Local OpenAI-compatible server returned HTTP ${response.status}.`,
        };
      }
      return { available: true, status: "connected" };
    } catch (error) {
      if (signal?.aborted) {
        throw new RuntimeError("cancelled", "Availability check was cancelled.", { cause: error });
      }
      return {
        available: false,
        status: "disconnected",
        message: `No OpenAI-compatible server at ${this.baseUrl}.`,
      };
    }
  }

  async discoverModels(signal?: AbortSignal): Promise<RuntimeModel[]> {
    const availability = await this.checkAvailability(signal);
    if (!availability.available) {
      throw new RuntimeError("provider_unavailable", availability.message ?? "Local server is not available.");
    }
    const response = await this.request("/models", { method: "GET", signal });
    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    const models = Array.isArray(payload.data) ? payload.data : [];
    return models
      .map((model) => model.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .map((id) => ({
        id,
        name: id,
        provider: "openai-compatible" as const,
        capabilities: { streaming: true, toolCalling: false, structuredOutput: false },
      }));
  }

  async createSession(request: RuntimeSessionRequest): Promise<{ providerSessionId?: string }> {
    this.histories.set(request.sessionId, []);
    if (request.modelId) {
      this.modelId = request.modelId;
    }
    return { providerSessionId: request.sessionId };
  }

  async resumeSession(request: RuntimeResumeRequest): Promise<{ providerSessionId?: string }> {
    if (!this.histories.has(request.sessionId)) {
      this.histories.set(request.sessionId, []);
    }
    return { providerSessionId: request.providerSessionId };
  }

  async sendMessage(request: RuntimeSendRequest, emit: RuntimeEventSink): Promise<void> {
    const modelId = request.modelId ?? this.modelId;
    if (!modelId) {
      throw new RuntimeError("model_unavailable", "Select a local model before sending a prompt.");
    }
    const history = this.histories.get(request.sessionId) ?? [];
    this.histories.set(request.sessionId, history);

    const nativeTools = modelSupportsNativeTools(modelId);
    if (request.onStreamDelta && request.signal?.aborted !== true) {
      const capabilities = await this.capabilitiesFor(modelId, request.signal).catch(() => undefined);
      if (capabilities && !capabilities.streaming) {
        throw new RuntimeError("unsupported_capability", `Model ${modelId} does not support streaming.`, { details: { capability: "streaming", modelId } });
      }
    }
    await runInferenceAgentLoop(
      request,
      history,
      (messages, signal) => this.completeChat(modelId, messages, signal, nativeTools, request.mode),
      emit,
      { nativeTools, mode: request.mode },
    );
  }

  private async capabilitiesFor(modelId: string, signal?: AbortSignal): Promise<RuntimeModel["capabilities"]> {
    const models = await this.discoverModels(signal);
    return models.find((model) => model.id === modelId)?.capabilities;
  }

  async cancel(_request: RuntimeCancelRequest): Promise<void> {}

  dispose(): void {
    this.histories.clear();
  }

  private async completeChat(modelId: string, messages: readonly ChatTurn[], signal?: AbortSignal, nativeTools = true, mode?: AgentMode) {
    const response = await this.request("/chat/completions", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages,
        stream: false,
        ...(nativeTools ? { tools: nativeChatTools(availableToolNames(mode)) } : {}),
      }),
    });

    if (!response.ok) {
      throw new RuntimeError("unknown", `Local chat failed with HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; tool_calls?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const message = payload.choices?.[0]?.message;
    const usage = normalizeOpenAiUsage(payload.usage);
    return {
      content: message?.content ?? "",
      nativeToolCalls: parseNativeToolCalls(message?.tool_calls),
      ...(usage ? { usage } : {}),
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.apiKey) {
      headers.set("Authorization", `Bearer ${this.apiKey}`);
    }
    try {
      return await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers });
    } catch (error) {
      if (init.signal?.aborted) {
        throw new RuntimeError("cancelled", "The local request was cancelled.", { cause: error });
      }
      throw new RuntimeError("network_error", `Could not reach ${this.baseUrl}.`, { retryable: true, cause: error });
    }
  }
}
