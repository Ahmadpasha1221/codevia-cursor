import type { RuntimeToolCall, RuntimeToolCallResponse, RuntimeToolExecutor, RuntimeToolExecutorContext } from "../runtimeTypes";
import { availableToolNames, DEFAULT_AGENT_MODE, type AgentMode } from "./toolAvailability";
import { getRegisteredTool, listAvailableToolNames } from "./toolRegistry";

export type AuthorizeTool = (
  call: RuntimeToolCall,
  signal?: AbortSignal,
) => Promise<{ allowed: boolean; error?: string }>;

export class ToolRouter {
  constructor(private readonly executor?: RuntimeToolExecutor) {}

  async route(
    call: RuntimeToolCall,
    context: RuntimeToolExecutorContext,
    authorize: AuthorizeTool,
    options: { mode?: AgentMode } = {},
  ): Promise<RuntimeToolCallResponse> {
    const mode = options.mode ?? DEFAULT_AGENT_MODE;
    const allowed = new Set(availableToolNames(mode));

    const tool = getRegisteredTool(call.name);
    if (!tool || !allowed.has(call.name)) {
      // Structured error back to the model (never executed, never chat):
      // names the problem and lists the current available-tool set so the
      // model can retry with a valid tool.
      const availableList = listAvailableToolNames(availableToolNames(mode)).join("\n");
      const error = tool
        ? `Tool not available: ${call.name}. Available tools:\n${availableList}`
        : `Unknown tool: ${call.name}. Available tools:\n${availableList}`;
      return failure(call.name, error, false);
    }

    const input = isRecord(call.input) ? call.input : {};
    const validationError = tool.validate(input);
    if (validationError) {
      return failure(call.name, validationError, false);
    }

    const permission = await authorize(call, context.signal);
    if (!permission.allowed) {
      return failure(call.name, permission.error ?? "Permission denied.", false);
    }

    try {
      const raw = await tool.execute(call, context, this.executor);
      const result = success(call.name, raw);
      return {
        allowed: true,
        result,
        ...(call.name === "finish" ? { finished: true } : {}),
      };
    } catch (error) {
      return failure(call.name, error instanceof Error ? error.message : "Tool execution failed.", true);
    }
  }
}

function success(tool: string, raw: unknown): Record<string, unknown> {
  const details = isRecord(raw) ? raw : { result: raw };
  return {
    success: true,
    tool,
    message: `${tool} completed.`,
    ...details,
  };
}

function failure(tool: string, error: string, allowed: boolean): RuntimeToolCallResponse {
  return {
    allowed,
    error,
    result: { success: false, tool, error },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
