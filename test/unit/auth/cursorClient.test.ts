import { describe, expect, it, vi } from "vitest";
import { CursorClient } from "../../../src/auth/cursorClient";
import { CursorAuthError } from "../../../src/auth/cursorAuthError";
import { Agent, Run } from "@cursor/sdk";

vi.mock("@cursor/sdk", () => ({
  Agent: {
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    resume: vi.fn(),
  },
  Run: vi.fn(),
  configureCursorSdk: vi.fn(),
}));

describe("CursorClient", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("createAgent returns an SDK agent", async () => {
    const agent = { agentId: "agent-1", close: vi.fn() };
    vi.mocked(Agent.create).mockResolvedValue(agent);

    const client = new CursorClient(undefined);
    const result = await client.createAgent("Test Agent", "/workspace");

    expect(result).toBe(agent);
    expect(Agent.create).toHaveBeenCalledWith({
      name: "Test Agent",
      local: { cwd: "/workspace" },
      apiKey: undefined,
    });
  });

  it("createAgent throws CursorAuthError on auth failure", async () => {
    vi.mocked(Agent.create).mockRejectedValue(new CursorAuthError("Auth failed", 401));

    const client = new CursorClient(undefined);
    await expect(client.createAgent("Test Agent", "/workspace")).rejects.toBeInstanceOf(CursorAuthError);
  });

  it("listAgents returns items", async () => {
    vi.mocked(Agent.list).mockResolvedValue({ items: [{ agentId: "agent-1", name: "Agent" }] });

    const client = new CursorClient(undefined);
    const agents = await client.listAgents();

    expect(agents).toHaveLength(1);
    expect(agents[0].agentId).toBe("agent-1");
  });

  it("sendMessage resumes agent and sends prompt", async () => {
    const run = { id: "run-1", agentId: "agent-1", cancel: vi.fn(), wait: vi.fn().mockResolvedValue({ status: "finished" }), stream: vi.fn() };
    const agent = { agentId: "agent-1", send: vi.fn().mockResolvedValue(run) };
    vi.mocked(Agent.resume).mockResolvedValue(agent as unknown as ReturnType<typeof Agent.resume>);

    const client = new CursorClient(undefined);
    const result = await client.sendMessage("agent-1", "Hello");

    expect(result).toBe(run);
    expect(agent.send).toHaveBeenCalledWith("Hello");
  });

  it("cancelRun cancels the run", async () => {
    const run = { cancel: vi.fn() } as unknown as Run;
    vi.mocked(Agent.resume).mockResolvedValue({ agentId: "agent-1" } as unknown as ReturnType<typeof Agent.resume>);

    const client = new CursorClient(undefined);
    await client.cancelRun(run);

    expect(run.cancel).toHaveBeenCalled();
  });

  it("waitRun returns run status", async () => {
    const run = {
      id: "run-1",
      agentId: "agent-1",
      cancel: vi.fn(),
      wait: vi.fn().mockResolvedValue({ status: "finished" }),
      stream: vi.fn(),
    } as unknown as Run;

    const client = new CursorClient(undefined);
    const result = await client.waitRun(run);

    expect(result).toEqual({ runId: "run-1", agentId: "agent-1", status: "finished" });
  });
});
