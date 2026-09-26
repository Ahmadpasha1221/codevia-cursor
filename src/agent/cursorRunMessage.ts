import type { SDKMessage } from "@cursor/sdk";

export type CursorRunMessageKind =
  | "system"
  | "user"
  | "assistant"
  | "tool_call"
  | "thinking"
  | "status"
  | "request"
  | "task"
  | "usage"
  | "unknown";

export interface CursorRunMessage {
  readonly kind: CursorRunMessageKind;
  readonly message: SDKMessage;
}

export function isRequestMessage(message: CursorRunMessage): message is CursorRunMessage & { kind: "request" } {
  return message.kind === "request";
}

export function isToolCallMessage(message: CursorRunMessage): message is CursorRunMessage & { kind: "tool_call" } {
  return message.kind === "tool_call";
}

export function isStatusMessage(message: CursorRunMessage): message is CursorRunMessage & { kind: "status" } {
  return message.kind === "status";
}

export function isAssistantMessage(message: CursorRunMessage): message is CursorRunMessage & { kind: "assistant" } {
  return message.kind === "assistant";
}

export function isThinkingMessage(message: CursorRunMessage): message is CursorRunMessage & { kind: "thinking" } {
  return message.kind === "thinking";
}

export function extractTextContent(message: CursorRunMessage): string | undefined {
  return extractFromUnknown(message.message);
}

function extractFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (value === null || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const direct = [record.text, record.thinking, record.content]
    .map((part) => (typeof part === "string" ? part : undefined))
    .find((part) => part !== undefined && part.trim().length > 0);

  if (direct) {
    return direct.trim();
  }

  if (Array.isArray(record.content)) {
    const joined = record.content
      .map((part) => extractFromUnknown(part))
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join("");
    return joined.length > 0 ? joined : undefined;
  }

  if (record.message !== undefined) {
    return extractFromUnknown(record.message);
  }

  return undefined;
}

export interface ToolCallInfo {
  readonly toolName: string;
  readonly command?: string;
  readonly path?: string;
}

export function extractToolCallInfo(message: CursorRunMessage): ToolCallInfo | undefined {
  if (message.kind !== "tool_call") {
    return undefined;
  }

  const toolCall = (message.message as { name?: string; args?: Record<string, unknown> }).name;
  const args = (message.message as { args?: Record<string, unknown> }).args ?? {};

  return {
    toolName: toolCall ?? "unknown",
    command: typeof args.command === "string" ? args.command : undefined,
    path: typeof args.file_path === "string" ? args.file_path : (typeof args.path === "string" ? args.path : undefined),
  };
}