import type { RuntimeToolCall, RuntimeToolExecutor, RuntimeToolExecutorContext } from "../runtimeTypes";

export type ToolCategory = "filesystem" | "search" | "terminal" | "workflow";
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
  readonly destructive: boolean;
  readonly parameters: ToolSchema;
  /** Compact example arguments shown in the fallback tool contract. */
  readonly exampleArguments: Record<string, unknown>;
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
  category: ToolCategory,
  parameters: ToolSchema,
  required: readonly string[],
  exampleArguments: Record<string, unknown>,
): RegisteredTool {
  return {
    name,
    description,
    category,
    permission,
    destructive: permission === "destructive",
    parameters,
    exampleArguments,
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
  workspaceTool("list_files", "List files and directories in a workspace path.", "safe", "filesystem", { type: "object", properties: { path: pathProp } }, [], {}),
  workspaceTool("read_file", "Read a text file from the workspace.", "safe", "filesystem", { type: "object", properties: { path: pathProp }, required: ["path"] }, ["path"], { path: "a.py" }),
  workspaceTool("search_files", "Search file names and contents in the workspace.", "safe", "search", {
    type: "object",
    properties: { query: { type: "string" }, path: pathProp },
    required: ["query"],
  }, ["query"], { query: "TODO" }),
  workspaceTool("write_file", "Create or overwrite any text file (.txt, .py, .js, .ts, .json, .md, .html, .css and similar).", "modify", "filesystem", {
    type: "object",
    properties: { path: pathProp, content: { type: "string", description: "Full file contents." } },
    required: ["path", "content"],
  }, ["path", "content"], { path: "test.txt", content: "Hello" }),
  workspaceTool("edit_file", "Replace exact text in an existing workspace file.", "modify", "filesystem", {
    type: "object",
    properties: {
      path: pathProp,
      old_string: { type: "string" },
      new_string: { type: "string" },
    },
    required: ["path", "old_string", "new_string"],
  }, ["path", "old_string", "new_string"], { path: "a.py", old_string: "old text", new_string: "new text" }),
  workspaceTool("create_directory", "Create a directory in the workspace.", "modify", "filesystem", { type: "object", properties: { path: pathProp }, required: ["path"] }, ["path"], { path: "src" }),
  workspaceTool("move_file", "Move or rename a file or directory inside the workspace.", "modify", "filesystem", {
    type: "object",
    properties: { from: pathProp, to: pathProp },
    required: ["from", "to"],
  }, ["from", "to"], { from: "a.txt", to: "b.txt" }),
  workspaceTool("delete_file", "Delete a file or empty directory in the workspace.", "destructive", "filesystem", { type: "object", properties: { path: pathProp }, required: ["path"] }, ["path"], { path: "old.txt" }),
  {
    name: "run_command",
    description: "Run a shell command in the workspace.",
    category: "terminal",
    permission: "execute",
    destructive: false,
    parameters: {
      type: "object",
      properties: { command: { type: "string" }, cwd: pathProp, timeoutMs: { type: "number" } },
      required: ["command"],
    },
    exampleArguments: { command: "python app.py" },
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
    destructive: false,
    parameters: {
      type: "object",
      properties: { summary: { type: "string", description: "Short summary of what was done." } },
      required: ["summary"],
    },
    exampleArguments: { summary: "Created the requested files." },
    validate: (input) => requireStrings(input, ["summary"]),
    execute: async (call) => {
      const input = isRecord(call.input) ? call.input : {};
      return { summary: input.summary };
    },
  },
];

const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

/**
 * The registry is the single source of truth for tool names. Everything else
 * (schemas, descriptions, permission groups, availability) is derived from it.
 */
export type LocalToolName = string;

export const LOCAL_TOOL_NAMES: readonly string[] = TOOLS.map((tool) => tool.name);
const localToolNames = new Set<string>(LOCAL_TOOL_NAMES);

export function isLocalToolName(name: string): boolean {
  return localToolNames.has(name);
}

export function listRegisteredTools(): readonly RegisteredTool[] {
  return TOOLS;
}

export function getRegisteredTool(name: string): RegisteredTool | undefined {
  return byName.get(name);
}

export function toolsWithPermission(permission: ToolPermission): readonly RegisteredTool[] {
  return TOOLS.filter((tool) => tool.permission === permission);
}

/**
 * Permission groups derived from registry permission metadata. Legacy aliases
 * cover the Cursor SDK tool names that share the same policy.
 */
export const READ_TOOL_NAMES: ReadonlySet<string> = new Set([...toolsWithPermission("safe").map((tool) => tool.name), "read"]);
export const MODIFY_TOOL_NAMES: ReadonlySet<string> = new Set([...toolsWithPermission("modify").map((tool) => tool.name), "edit"]);
export const EXECUTE_TOOL_NAMES: ReadonlySet<string> = new Set([...toolsWithPermission("execute").map((tool) => tool.name), "shell"]);
export const DESTRUCTIVE_TOOL_NAMES: ReadonlySet<string> = new Set([...toolsWithPermission("destructive").map((tool) => tool.name), "delete", "applyagentdiff"]);

export interface NativeChatTool {
  readonly type: "function";
  readonly function: { name: string; description: string; parameters: ToolSchema };
}

/**
 * Model-facing native tool schemas, generated from the registry. Pass an
 * availability set (see toolAvailability) to restrict the exposed tools.
 */
export function nativeChatTools(allowedNames?: readonly string[]): NativeChatTool[] {
  const allowed = allowedNames ? new Set<string>(allowedNames) : undefined;
  return TOOLS.filter((tool) => !allowed || allowed.has(tool.name)).map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function listAvailableToolNames(allowedNames?: readonly string[]): readonly string[] {
  if (!allowedNames) {
    return LOCAL_TOOL_NAMES;
  }
  const allowed = new Set(allowedNames);
  return LOCAL_TOOL_NAMES.filter((name) => allowed.has(name));
}

function schemaToArgumentExample(schema: ToolSchema): string {
  const lines: string[] = [];
  for (const [key, property] of Object.entries(schema.properties)) {
    lines.push(`  "${key}": "${property.type}"`);
  }
  return `{\n${lines.join(",\n")}\n}`;
}

/**
 * The exact tool contract embedded in the system prompt for models without
 * native tool calling. Generated from the registry so prompt, schema and
 * executor can never drift apart. Pass an availability set to restrict the
 * contract to the currently available tools.
 */
export function buildFallbackToolContract(allowedNames?: readonly string[]): string {
  const allowed = allowedNames ? new Set<string>(allowedNames) : undefined;
  const visible = TOOLS.filter((tool) => !allowed || allowed.has(tool.name));
  const sections = visible.map((tool) =>
    [
      `${tool.name}`,
      `Description: ${tool.description}`,
      `Arguments:`,
      schemaToArgumentExample(tool.parameters),
    ].join("\n"),
  );
  // Pick a realistic example from the available set so restricted modes are
  // never shown an example of a tool they cannot use.
  const example = visible.find((tool) => tool.name === "write_file") ?? visible[0];
  const exampleJson = example ? JSON.stringify({ name: example.name, arguments: example.exampleArguments }) : "";
  return `AVAILABLE TOOLS (the only tools you may use):\n\n${sections.join("\n\n")}\n\nTo use a tool output exactly one JSON object and nothing else:\n${exampleJson}\nNever invent tool names. Tools not in this list do not exist. For normal conversation that does not need a tool, reply in plain text without JSON.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
