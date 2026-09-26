import type { RuntimeToolCall } from "../runtimeTypes";

export const LOCAL_TOOL_NAMES = [
  "list_files",
  "read_file",
  "search_files",
  "write_file",
  "edit_file",
  "create_directory",
  "move_file",
  "delete_file",
  "run_command",
  "finish",
] as const;

export type LocalToolName = (typeof LOCAL_TOOL_NAMES)[number];

export const READ_TOOL_NAMES: ReadonlySet<string> = new Set(["list_files", "read_file", "search_files", "finish", "read"]);
export const MODIFY_TOOL_NAMES: ReadonlySet<string> = new Set([
  "write_file",
  "edit_file",
  "create_directory",
  "move_file",
  "edit",
]);
export const EXECUTE_TOOL_NAMES: ReadonlySet<string> = new Set(["run_command", "shell"]);
export const DESTRUCTIVE_TOOL_NAMES: ReadonlySet<string> = new Set(["delete_file", "delete", "applyagentdiff"]);

export const LOCAL_AGENT_SYSTEM_PROMPT = `You are Codevia, a coding agent working inside the user's workspace.

You choose tools from the registered tool list based on the current task. The application validates arguments, checks permissions, executes the tool, and returns the result. Do not invent tool results.

Use a tool when the task needs the workspace or a command. Read or inspect existing files before changing them when you need their current contents. Verify important writes and edits. When the task is done, call finish with a short summary, or reply in plain text if no further tool is required.

Conversation, greetings, and questions that do not need the workspace should be answered in plain text without a tool call.
If the user asks which model is running, answer with the selected model named below and do not call a workspace tool.

Paths in tool arguments are relative to the workspace root, such as simple.py. Do not use absolute paths or paths that leave the workspace.
Never tell the user a file was created, changed, or a command succeeded unless the tool result says success.`;

export function buildAgentSystemPrompt(modelId?: string): string {
  const modelLine = modelId ? `\nSelected model: ${modelId}.` : "";
  return `${LOCAL_AGENT_SYSTEM_PROMPT}${modelLine}`;
}

export function isLocalToolName(name: string): name is LocalToolName {
  return (LOCAL_TOOL_NAMES as readonly string[]).includes(name);
}

export function stripToolCallMarkup(text: string): string {
  const withoutTags = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  const withoutFence = withoutTags.replace(/```(?:json)?\s*\{[\s\S]*?"name"\s*:\s*"[a-z_]+"[\s\S]*?```/gi, "");
  return withoutFence.replace(/\{[\s\S]*?"name"\s*:\s*"(?:list_files|read_file|search_files|write_file|edit_file|create_directory|move_file|delete_file|run_command)"[\s\S]*\}/g, "").trim();
}

export function formatToolResultForModel(call: RuntimeToolCall, result: unknown, error?: string): string {
  const payload = error ? { ok: false, error } : { ok: true, result };
  return `TOOL_RESULT ${call.name} (${call.id}):\n${safeJson(payload)}`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
