import { Agent, configureCursorSdk, type SDKAgent, type SDKAgentInfo, type Run, type SDKMessage, type ToolName, type AgentOptions } from "@cursor/sdk";
import { CursorAuthError } from "./cursorAuthError";
import { CursorRunMessage } from "../agent/cursorRunMessage";

export interface CursorAgentRun {
  runId: string;
  agentId: string;
  status: "running" | "finished" | "error" | "cancelled";
}

export interface CreateAgentOptions {
  readonly name: string;
  readonly workspacePath: string;
  readonly disallowedTools?: readonly ToolName[];
}

export class CursorClient {
  private apiKey: string | undefined;

  constructor(apiKey: string | undefined) {
    this.apiKey = apiKey;
    configureCursorSdk({});
  }

  async createAgent(name: string, workspacePath: string): Promise<SDKAgent>;
  async createAgent(options: CreateAgentOptions): Promise<SDKAgent>;
  async createAgent(
    nameOrOptions: string | CreateAgentOptions,
    workspacePath?: string,
  ): Promise<SDKAgent> {
    const options = typeof nameOrOptions === "string"
      ? { name: nameOrOptions, workspacePath: workspacePath ?? "." }
      : nameOrOptions;

    const createOptions: AgentOptions = {
      name: options.name,
      local: { cwd: options.workspacePath },
      apiKey: this.apiKey,
    };

    if (options.disallowedTools && options.disallowedTools.length > 0) {
      createOptions.disallowedTools = [...options.disallowedTools];
    }

    try {
      return await Agent.create(createOptions);
    } catch (error) {
      throw this.convertError(error, "agent_create");
    }
  }

  async getAgent(agentId: string): Promise<SDKAgentInfo> {
    try {
      return await Agent.get(agentId, { apiKey: this.apiKey });
    } catch (error) {
      throw this.convertError(error, "agent_get");
    }
  }

  async listAgents(): Promise<SDKAgentInfo[]> {
    try {
      const result = await Agent.list();
      return result.items;
    } catch (error) {
      throw this.convertError(error, "agent_list");
    }
  }

  async resumeAgent(agentId: string): Promise<SDKAgent> {
    try {
      return await Agent.resume(agentId, { apiKey: this.apiKey });
    } catch (error) {
      throw this.convertError(error, "agent_resume");
    }
  }

  async sendMessage(agentId: string, prompt: string): Promise<Run> {
    const agent = await this.resumeAgent(agentId);
    try {
      return await agent.send(prompt);
    } catch (error) {
      throw this.convertError(error, "agent_send");
    }
  }

  async cancelRun(run: Run): Promise<void> {
    try {
      await run.cancel();
    } catch (error) {
      throw this.convertError(error, "run_cancel");
    }
  }

  async waitRun(run: Run): Promise<CursorAgentRun> {
    try {
      const result = await run.wait();
      return {
        runId: run.id,
        agentId: run.agentId,
        status: result.status,
      };
    } catch (error) {
      throw this.convertError(error, "run_wait");
    }
  }

  async *streamRunMessages(run: Run): AsyncGenerator<CursorRunMessage> {
    for await (const message of run.stream()) {
      yield this.normalizeMessage(message);
    }
  }

  async *streamRunEvents(run: Run): AsyncGenerator<CursorAgentRun> {
    for await (const _message of this.streamRunMessages(run)) {
      void _message;
      yield {
        runId: run.id,
        agentId: run.agentId,
        status: run.status,
      };
    }
  }

  dispose(): void {
    this.apiKey = undefined;
  }

  private convertError(error: unknown, operation: string): Error {
    if (error instanceof CursorAuthError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    return new Error(`Cursor SDK error in ${operation}: ${message}`);
  }

  private normalizeMessage(message: SDKMessage): CursorRunMessage {
    switch (message.type) {
      case "system":
        return { kind: "system", message };
      case "user":
        return { kind: "user", message };
      case "assistant":
        return { kind: "assistant", message };
      case "tool_call":
        return { kind: "tool_call", message };
      case "thinking":
        return { kind: "thinking", message };
      case "status":
        return { kind: "status", message };
      case "request":
        return { kind: "request", message };
      case "task":
        return { kind: "task", message };
      case "usage":
        return { kind: "usage", message };
      default:
        return { kind: "unknown", message };
    }
  }
}
