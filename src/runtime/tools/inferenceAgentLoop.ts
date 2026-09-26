import type {
  RuntimeEventSink,
  RuntimeSendRequest,
  RuntimeToolCall,
  RuntimeToolCallResponse,
} from "../runtimeTypes";
import { RuntimeError } from "../runtimeTypes";
import { buildAgentSystemPrompt, stripToolCallMarkup } from "./localToolDefinitions";
import { parseFallbackToolCalls, TEXT_TOOL_FALLBACK_INSTRUCTION } from "./textToolFallback";

export interface ChatTurn {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: Record<string, unknown> };
  }>;
}

export interface ChatCompletion {
  readonly content: string;
  readonly nativeToolCalls?: RuntimeToolCall[];
}

export type CompleteChat = (messages: readonly ChatTurn[], signal?: AbortSignal) => Promise<ChatCompletion>;

export const MAX_TOOL_ITERATIONS = 20;

export interface AgentLoopOptions {
  readonly nativeTools: boolean;
}

export async function runInferenceAgentLoop(
  request: RuntimeSendRequest,
  history: ChatTurn[],
  completeChat: CompleteChat,
  emit: RuntimeEventSink,
  options: AgentLoopOptions = { nativeTools: true },
): Promise<void> {
  prepareHistory(history, request.retry === true);
  ensureSystemPrompt(history, request.modelId, options.nativeTools);
  history.push({ role: "user", content: request.prompt });
  await emit({ type: "status", sessionId: request.sessionId, status: "RUNNING", timestamp: Date.now() });

  if (!request.onToolCall) {
    const completion = await completeChat(history, request.signal);
    const message = visibleText(completion.content) || "(The local model returned an empty response.)";
    history.push({ role: "assistant", content: message });
    await emit({ type: "assistant_message", sessionId: request.sessionId, message, timestamp: Date.now() });
    return;
  }

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    throwIfAborted(request.signal);
    const completion = await completeChat(history, request.signal);
    const calls = selectToolCalls(completion, options.nativeTools);
    const visible = visibleText(completion.content);

    if (calls.length === 0) {
      const message = visible || "(The local model returned an empty response.)";
      history.push({ role: "assistant", content: message });
      await emit({ type: "assistant_message", sessionId: request.sessionId, message, timestamp: Date.now() });
      return;
    }

    if (visible.length > 0) {
      await emit({ type: "thinking", sessionId: request.sessionId, message: visible, timestamp: Date.now() });
    }

    history.push({
      role: "assistant",
      content: visible,
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: {
          name: call.name,
          arguments: isRecord(call.input) ? call.input : {},
        },
      })),
    });

    for (const call of calls) {
      throwIfAborted(request.signal);
      await emit({ type: "tool_call", sessionId: request.sessionId, toolCall: call, timestamp: Date.now() });
      await emit({ type: "tool_running", sessionId: request.sessionId, toolCall: call, timestamp: Date.now() });
      const response = await request.onToolCall(call, request.signal);
      await emitCommandOutput(request.sessionId, call, response, emit);
      await emit({
        type: "tool_result",
        sessionId: request.sessionId,
        toolResult: {
          toolCallId: call.id,
          name: call.name,
          ...(response.result !== undefined ? { result: response.result } : {}),
          ...(response.error ? { error: response.error } : {}),
        },
        timestamp: Date.now(),
      });
      history.push({
        role: "tool",
        content: JSON.stringify(response.result ?? { success: false, tool: call.name, error: response.error ?? "Tool failed." }),
      });

      if (response.finished) {
        const summary = summaryFrom(response.result) || "Done.";
        history.push({ role: "assistant", content: summary });
        await emit({ type: "assistant_message", sessionId: request.sessionId, message: summary, timestamp: Date.now() });
        return;
      }
    }
  }

  const message = `Stopped after ${MAX_TOOL_ITERATIONS} tool iterations.`;
  history.push({ role: "assistant", content: message });
  await emit({ type: "assistant_message", sessionId: request.sessionId, message, timestamp: Date.now() });
}

function selectToolCalls(completion: ChatCompletion, nativeTools: boolean): RuntimeToolCall[] {
  if (nativeTools) {
    return completion.nativeToolCalls ?? [];
  }
  return parseFallbackToolCalls(completion.content);
}

function ensureSystemPrompt(history: ChatTurn[], modelId: string | undefined, nativeTools: boolean): void {
  const prompt = nativeTools
    ? buildAgentSystemPrompt(modelId)
    : `${buildAgentSystemPrompt(modelId)}\n\n${TEXT_TOOL_FALLBACK_INSTRUCTION}`;
  const existing = history.find((turn) => turn.role === "system");
  if (!existing) {
    history.unshift({ role: "system", content: prompt });
    return;
  }
  existing.content = prompt;
}

function prepareHistory(history: ChatTurn[], retry: boolean): void {
  if (retry) {
    while (history.length > 0 && history[history.length - 1]?.role !== "system") {
      const last = history.pop();
      if (last?.role === "user") {
        break;
      }
    }
    return;
  }

  const last = history[history.length - 1];
  if (
    last?.role === "assistant"
    && visibleText(last.content).length === 0
    && ((last.tool_calls && last.tool_calls.length > 0) || parseFallbackToolCalls(last.content).length > 0)
  ) {
    history.pop();
  }
}

function visibleText(content: string): string {
  return stripToolCallMarkup(content);
}

function summaryFrom(result: unknown): string {
  if (!isRecord(result)) {
    return "";
  }
  return typeof result.summary === "string" ? result.summary : typeof result.message === "string" ? result.message : "";
}

async function emitCommandOutput(
  sessionId: string,
  call: RuntimeToolCall,
  response: RuntimeToolCallResponse,
  emit: RuntimeEventSink,
): Promise<void> {
  if (call.name !== "run_command" || !isRecord(response.result)) {
    return;
  }
  const result = response.result;
  if (typeof result.stdout !== "string" && typeof result.stderr !== "string") {
    return;
  }
  await emit({
    type: "command_output",
    sessionId,
    command: typeof result.command === "string" ? result.command : commandFromInput(call.input),
    ...(typeof result.cwd === "string" ? { cwd: result.cwd } : {}),
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    exitCode: typeof result.exitCode === "number" ? result.exitCode : null,
    timestamp: Date.now(),
  });
}

function commandFromInput(input: unknown): string {
  return isRecord(input) && typeof input.command === "string" ? input.command : "";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RuntimeError("cancelled", "The local agent run was cancelled.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
