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