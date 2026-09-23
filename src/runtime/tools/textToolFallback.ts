import type { RuntimeToolCall } from "../runtimeTypes";
import { parseToolCallsFromText } from "./parseToolCalls";

export const TEXT_TOOL_FALLBACK_INSTRUCTION = `This model cannot use native tool calls. When a tool is required, reply with only one JSON object and no surrounding explanation, for example {"name":"read_file","arguments":{"path":"simple.py"}}. After the tool result arrives, continue the task or call finish.`;

const TEXT_ONLY_MODELS = [/qwen2\.5:0\.5b/i, /qwen2\.5-coder:1\.5b/i];

export function modelSupportsNativeTools(modelId?: string): boolean {
  if (!modelId) {
    return true;
  }
  return !TEXT_ONLY_MODELS.some((pattern) => pattern.test(modelId));
}

export function parseFallbackToolCalls(text: string): RuntimeToolCall[] {
  return parseToolCallsFromText(text);
}
