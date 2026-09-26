import { describe, expect, it, vi } from "vitest";
import type { CodeviaSession, RuntimeToolExecutor } from "../../../../src/runtime/runtimeTypes";
import { ToolRouter } from "../../../../src/runtime/tools/toolRouter";

describe("ToolRouter", () => {
  const session = {
    sessionId: "s1",
    provider: "ollama",
    workspacePath: "C:\\working_place\\testing\\agenttest\\test",
    status: "RUNNING",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CodeviaSession;

  it("rejects unknown tools and invalid arguments before execution", async () => {
    const executor: RuntimeToolExecutor = { execute: vi.fn() };
    const router = new ToolRouter(executor);
    const unknown = await router.route(
      { id: "1", name: "compile_project", input: {} },
      { session },
      async () => ({ allowed: true }),
    );
    const invalid = await router.route(
      { id: "2", name: "write_file", input: { path: "simple.py" } },
      { session },
      async () => ({ allowed: true }),
    );
    expect(unknown.result).toEqual(expect.objectContaining({ success: false, tool: "compile_project" }));
    expect(invalid.result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining("content") }));
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("checks permission, then executes the registered tool", async () => {
    const executor: RuntimeToolExecutor = {
      execute: vi.fn(async () => ({ path: "simple.py", written: true })),
    };
    const authorize = vi.fn(async () => ({ allowed: true }));
    const router = new ToolRouter(executor);
    const response = await router.route(
      { id: "3", name: "write_file", input: { path: "simple.py", content: "print(1)\n" } },
      { session },
      authorize,
    );
    expect(authorize).toHaveBeenCalled();
    expect(executor.execute).toHaveBeenCalled();
    expect(response.result).toEqual(expect.objectContaining({ success: true, tool: "write_file", path: "simple.py" }));
  });

  it("returns a denied result without executing", async () => {
    const executor: RuntimeToolExecutor = { execute: vi.fn() };
    const router = new ToolRouter(executor);
    const response = await router.route(
      { id: "4", name: "run_command", input: { command: "pytest" } },
      { session },
      async () => ({ allowed: false, error: "Permission denied." }),
    );
    expect(executor.execute).not.toHaveBeenCalled();
    expect(response.result).toEqual(expect.objectContaining({ success: false, error: "Permission denied." }));
  });

  it("stops the loop when finish succeeds", async () => {
    const router = new ToolRouter();
    const response = await router.route(
      { id: "5", name: "finish", input: { summary: "Created simple.py." } },
      { session },
      async () => ({ allowed: true }),
    );
    expect(response.finished).toBe(true);
    expect(response.result).toEqual(expect.objectContaining({ success: true, tool: "finish", summary: "Created simple.py." }));
  });
});
