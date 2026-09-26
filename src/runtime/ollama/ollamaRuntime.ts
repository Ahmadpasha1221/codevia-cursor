import {
  AgentRuntime,
  OllamaRuntimeConfig,
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
} from "../runtimeTypes";
import { ChatTurn, runInferenceAgentLoop } from "../tools/inferenceAgentLoop";
import { ollamaChatTools } from "../tools/toolRegistry";
import { modelSupportsNativeTools } from "../tools/textToolFallback";
import { parseNativeToolCalls } from "../tools/parseToolCalls";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

type FetchLike = typeof fetch;

export class OllamaRuntime implements AgentRuntime {
  readonly provider: RuntimeProvider = "ollama";
  readonly family: RuntimeProviderFamily = "inference";

  private baseUrl = DEFAULT_OLLAMA_BASE_URL;
  private modelId?: string;
  private readonly histories = new Map<string, ChatTurn[]>();
  private readonly fetcher: FetchLike;

  constructor(fetcher: FetchLike = fetch) {
    this.fetcher = fetcher;
  }

  async configure(config: OllamaRuntimeConfig): Promise<void> {
    const modelChanged = this.modelId !== undefined && config.modelId !== undefined && this.modelId !== config.modelId;
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.modelId = config.modelId;
    if (modelChanged) {
      this.histories.clear();
    }
  }

  async checkAvailability(signal?: AbortSignal): Promise<RuntimeAvailability> {
    try {
      const response = await this.request("/api/tags", { method: "GET", signal });
      if (!response.ok) {
        return {
          available: false,
          status: "error",
          message: `Ollama returned HTTP ${response.status}. Is the server running?`,
        };
      }
      return { available: true, status: "connected", message: "Ollama is running." };
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw new RuntimeError("cancelled", "Ollama availability check was cancelled.", { cause: error });
      }
      return {
        available: false,
        status: "disconnected",
        message: "Ollama is not reachable at " + this.baseUrl + ". Start Ollama and try again.",
      };
    }
  }

  async discoverModels(signal?: AbortSignal): Promise<RuntimeModel[]> {
    const availability = await this.checkAvailability(signal);
    if (!availability.available) {
      throw new RuntimeError("provider_unavailable", availability.message ?? "Ollama is not available.");
    }

    const response = await this.request("/api/tags", { method: "GET", signal });
    if (!response.ok) {
      throw new RuntimeError("provider_unavailable", `Ollama returned HTTP ${response.status} while listing models.`);
    }

    const payload = (await response.json()) as { models?: Array<{ name?: string; model?: string; details?: { family?: string } }> };
    const raw = Array.isArray(payload.models) ? payload.models : [];
    const models: RuntimeModel[] = [];
    for (const model of raw) {
      const id = model.name ?? model.model;
      if (!id) {
        continue;
      }
      models.push({
        id,
        name: id,
        provider: "ollama",
        capabilities: {
          streaming: true,
          toolCalling: modelSupportsNativeTools(id),
          structuredOutput: false,
          codeEditing: false,
          reasoning: model.details?.family?.includes("qwen3") ?? false,
        },
      });
    }
    return models;
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
    if (request.modelId) {
      this.modelId = request.modelId;
    }
    return { providerSessionId: request.providerSessionId };
  }

  async sendMessage(request: RuntimeSendRequest, emit: RuntimeEventSink): Promise<void> {
    const modelId = request.modelId ?? this.modelId;
    if (!modelId) {
      throw new RuntimeError("model_unavailable", "Select an Ollama model before sending a prompt.");
    }

    const history = this.histories.get(request.sessionId) ?? [];
    this.histories.set(request.sessionId, history);

    const nativeTools = modelSupportsNativeTools(modelId);
    await runInferenceAgentLoop(
      request,
      history,
      (messages, signal) => this.completeChat(modelId, messages, signal, nativeTools),
      emit,
      { nativeTools },
    );
  }

  async cancel(_request: RuntimeCancelRequest): Promise<void> {}

  dispose(): void {
    this.histories.clear();
  }

  private async completeChat(modelId: string, messages: readonly ChatTurn[], signal?: AbortSignal, toolsEnabled = false) {
    const payload: Record<string, unknown> = {
      model: modelId,
      messages,
      stream: true,
    };
    if (toolsEnabled) {
      payload.tools = ollamaChatTools();
    }

    let response = await this.request("/api/chat", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      response = await this.request("/api/chat", {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId, messages, stream: true }),
      });
    }

    if (!response.ok) {
      const detail = await safeText(response);
      throw new RuntimeError(
        response.status === 404 ? "model_unavailable" : "unknown",
        detail || `Ollama chat failed with HTTP ${response.status}.`,
      );
    }

    let content = "";
    const native: unknown[] = [];
    try {
      for await (const chunk of readNdjson(response, signal)) {
        content += extractOllamaContent(chunk);
        const calls = extractOllamaToolCalls(chunk);
        if (calls) {
          native.push(...calls);
        }
      }
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw new RuntimeError("cancelled", "The Ollama run was cancelled.", { cause: error });
      }
      throw toRuntimeError(error);
    }

    return {
      content,
      nativeToolCalls: parseNativeToolCalls(native),
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    try {
      return await this.fetcher(url, init);
    } catch (error) {
      if (isAbortError(error, init.signal ?? undefined)) {
        throw new RuntimeError("cancelled", "The Ollama request was cancelled.", { cause: error });
      }
      throw new RuntimeError("network_error", `Could not reach Ollama at ${this.baseUrl}.`, {
        retryable: true,
        cause: error,
      });
    }
  }
}

function normalizeBaseUrl(value?: string): string {
  const raw = (value && value.trim().length > 0 ? value : DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, "");
  return raw;
}

function extractOllamaToolCalls(chunk: unknown): unknown[] | undefined {
  if (!isRecord(chunk)) {
    return undefined;
  }
  const message = chunk.message;
  if (isRecord(message) && Array.isArray(message.tool_calls)) {
    return message.tool_calls;
  }
  return undefined;
}

function extractOllamaContent(chunk: unknown): string {
  if (!isRecord(chunk)) {
    return "";
  }
  const message = chunk.message;
  if (isRecord(message) && typeof message.content === "string") {
    return message.content;
  }
  if (typeof chunk.response === "string") {
    return chunk.response;
  }
  return "";
}

async function* readNdjson(response: Response, signal?: AbortSignal): AsyncGenerator<unknown> {
  if (!response.body) {
    const text = await response.text();
    if (text.trim().length > 0) {
      yield JSON.parse(text) as unknown;
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      throw new RuntimeError("cancelled", "The Ollama stream was cancelled.");
    }
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      yield JSON.parse(trimmed) as unknown;
    }
  }

  const trailing = buffer.trim();
  if (trailing.length > 0) {
    yield JSON.parse(trailing) as unknown;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

function toRuntimeError(error: unknown): RuntimeError {
  if (error instanceof RuntimeError) {
    return error;
  }
  return new RuntimeError("unknown", error instanceof Error ? error.message : "Ollama request failed.", { cause: error });
}
