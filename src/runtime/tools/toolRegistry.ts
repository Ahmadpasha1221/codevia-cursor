import type { RuntimeToolCall, RuntimeToolExecutor, RuntimeToolExecutorContext } from "../runtimeTypes";
import { isLocalToolName } from "./localToolDefinitions";

export type ToolCategory = "filesystem" | "terminal" | "workflow";
export type ToolPermission = "safe" | "modify" | "destructive" | "execute";

export interface ToolSchema {
  readonly type: "object";
  readonly properties: Record<string, { type: string; description?: string }>;
  readonly required?: readonly string[];
}

export interface RegisteredTool {
  readonly name: string;
  readonly description: string;
  readonly category: ToolCategory;
  readonly permission: ToolPermission;
  readonly parameters: ToolSchema;
  validate(input: Record<string, unknown>): string | undefined;
  execute(call: RuntimeToolCall, context: RuntimeToolExecutorContext, executor?: RuntimeToolExecutor): Promise<unknown>;
}

const pathProp = { type: "string", description: "Path relative to the workspace root." };

function requireStrings(input: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    if (typeof input[key] !== "string" || (input[key] as string).length === 0) {
      return `Missing required argument: ${key}`;
    }
  }
  return undefined;
}

function workspaceTool(
  name: string,
  description: string,
  permission: ToolPermission,
  parameters: ToolSchema,
  required: readonly string[],
): RegisteredTool {
  return {
    name,
    description,
    category: "filesystem",
    permission,
    parameters,
    validate: (input) => requireStrings(input, required),
    execute: (call, context, executor) => {
      if (!executor) {
        throw new Error("No workspace tool executor is configured.");
      }
      return executor.execute(call, context);
    },
  };
}

const TOOLS: readonly RegisteredTool[] = [
  workspaceTool("list_files", "List files and directories in a workspace path.", "safe", { type: "object", properties: { path: pathProp } }, []),
  workspaceTool("read_file", "Read a text file from the workspace.", "safe", { type: "object", properties: { path: pathProp }, required: ["path"] }, ["path"]),
  workspaceTool("search_files", "Search file names and contents in the workspace.", "safe", {
    type: "object",
    properties: { query: { type: "string" }, path: pathProp },
    required: ["query"],
  }, ["query"]),
  workspaceTool("write_file", "Create or overwrite a text file in the workspace.", "modify", {
    type: "object",
    properties: { path: pathProp, content: { type: "string", description: "Full file contents." } },
    required: ["path", "content"],
  }, ["path", "content"]),
  workspaceTool("edit_file", "Replace exact text in a workspace file.", "modify", {
    type: "object",
    properties: {
      path: pathProp,
      old_string: { type: "string" },
      new_string: { type: "string" },
    },
    required: ["path", "old_string", "new_string"],
  }, ["path", "old_string", "new_string"]),
  workspaceTool("create_directory", "Create a directory in the workspace.", "modify", { type: "object", properties: { path: pathProp }, required: ["path"] }, ["path"]),
  workspaceTool("move_file", "Move or rename a file or directory inside the workspace.", "modify", {
    type: "object",
    properties: { from: pathProp, to: pathProp },
    required: ["from", "to"],
  }, ["from", "to"]),
  workspaceTool("delete_file", "Delete a file or empty directory in the workspace.", "destructive", { type: "object", properties: { path: pathProp }, required: ["path"] }, ["path"]),
  {
    name: "run_command",
    description: "Run a shell command in the workspace.",
    category: "terminal",
    permission: "execute",
    parameters: {
      type: "object",
      properties: { command: { type: "string" }, cwd: pathProp, timeoutMs: { type: "number" } },
      required: ["command"],
    },
    validate: (input) => requireStrings(input, ["command"]),
    execute: (call, context, executor) => {
      if (!executor) {
        throw new Error("No workspace tool executor is configured.");
      }
      return executor.execute(call, context);
    },
  },
  {
    name: "finish",
    description: "Stop the agent loop after the task is complete.",
    category: "workflow",
    permission: "safe",
    parameters: {
      type: "object",
      properties: { summary: { type: "string", description: "Short summary of what was done." } },
      required: ["summary"],
    },
    validate: (input) => requireStrings(input, ["summary"]),
    execute: async (call) => {
      const input = isRecord(call.input) ? call.input : {};
      return { summary: input.summary };
    },
  },
];

const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function listRegisteredTools(): readonly RegisteredTool[] {
  return TOOLS;
}

export function getRegisteredTool(name: string): RegisteredTool | undefined {
  return byName.get(name);
}

export function ollamaChatTools(): Array<{ type: "function"; function: { name: string; description: string; parameters: ToolSchema } }> {
  return TOOLS.filter((tool) => isLocalToolName(tool.name)).map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
