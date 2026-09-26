import { describe, expect, it, vi } from "vitest";
import { OllamaRuntime } from "../../../../src/runtime/ollama/ollamaRuntime";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function streamResponse(lines: string[]): Response {
  const payload = `${lines.join("\n")}\n`;
  return new Response(payload, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

describe("OllamaRuntime", () => {
  it("discovers models from /api/tags", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("/api/tags");
      return jsonResponse({
        models: [{ name: "qwen2.5:0.5b-instruct" }, { name: "qwen3:8b" }],
      });
    }) as unknown as typeof fetch;

    const runtime = new OllamaRuntime(fetcher);
    await runtime.configure({ provider: "ollama" });
    const models = await runtime.discoverModels();

    expect(models.map((model) => model.id)).toEqual(["qwen2.5:0.5b-instruct", "qwen3:8b"]);
  });

  it("reports disconnected when Ollama is not running", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const runtime = new OllamaRuntime(fetcher);
    await runtime.configure({ provider: "ollama" });
    const availability = await runtime.checkAvailability();

    expect(availability.available).toBe(false);
    expect(availability.status).toBe("disconnected");
  });

  it("streams a chat reply and emits assistant_message", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/api/tags")) {
        return jsonResponse({ models: [{ name: "qwen2.5:0.5b-instruct" }] });
      }
      expect(String(url)).toContain("/api/chat");
      expect(init?.method).toBe("POST");
      return streamResponse([
        JSON.stringify({ message: { content: "Hel" }, done: false }),
        JSON.stringify({ message: { content: "lo" }, done: true }),
      ]);
    }) as unknown as typeof fetch;

    const runtime = new OllamaRuntime(fetcher);
    await runtime.configure({ provider: "ollama", modelId: "qwen2.5:0.5b-instruct" });
    await runtime.createSession({ sessionId: "s1", workspacePath: "/workspace", modelId: "qwen2.5:0.5b-instruct" });

    const events: Array<{ type: string; message?: string; text?: string }> = [];
    await runtime.sendMessage(
      { sessionId: "s1", workspacePath: "/workspace", modelId: "qwen2.5:0.5b-instruct", prompt: "hi" },
      (event) => {
        events.push(event);
      },
    );

    expect(events.some((event) => event.type === "assistant_message" && event.message === "Hello")).toBe(true);
  });

  it("runs a tool loop when the model emits tool calls", async () => {
    let chatCalls = 0;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/api/tags")) {
        return jsonResponse({ models: [{ name: "qwen2.5:0.5b-instruct" }] });
      }
      chatCalls += 1;
      if (chatCalls === 1) {
        return streamResponse([
          JSON.stringify({
            message: {
              content: `<tool_call>{"name":"write_file","arguments":{"path":"test.py","content":"print(1)"}}</tool_call>`,
            },
            done: true,
          }),
        ]);
      }
      return streamResponse([
        JSON.stringify({ message: { content: "Created test.py" }, done: true }),
      ]);
    }) as unknown as typeof fetch;

    const runtime = new OllamaRuntime(fetcher);
    await runtime.configure({ provider: "ollama", modelId: "qwen2.5:0.5b-instruct" });
    await runtime.createSession({ sessionId: "s1", workspacePath: "/workspace", modelId: "qwen2.5:0.5b-instruct" });

    const onToolCall = vi.fn(async () => ({ allowed: true, result: { written: true } }));
    const events: Array<{ type: string; message?: string }> = [];
    await runtime.sendMessage(
      {
        sessionId: "s1",
        workspacePath: "/workspace",
        modelId: "qwen2.5:0.5b-instruct",
        prompt: "Create test.py",
        onToolCall,
      },
      (event) => {
        events.push(event);
      },
    );

    expect(onToolCall).toHaveBeenCalledWith(expect.objectContaining({ name: "write_file" }), undefined);
    expect(events.some((event) => event.type === "tool_call")).toBe(true);
    expect(events.some((event) => event.type === "assistant_message" && event.message === "Created test.py")).toBe(true);
  });

  it("executes raw JSON tool calls and does not replay them on hi", async () => {
    let chatCalls = 0;
    const bodies: unknown[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/api/tags")) {
        return jsonResponse({ models: [{ name: "qwen2.5:0.5b-instruct" }] });
      }
      chatCalls += 1;
      if (init?.body) {
        bodies.push(JSON.parse(String(init.body)));
      }
      if (chatCalls === 1) {
        return streamResponse([
          JSON.stringify({
            message: {
              content: `{"name":"write_file","arguments":{"path":"simple.py","content":"print('Hello, World!')"}}`,
            },
            done: true,
          }),
        ]);
      }
      return streamResponse([
        JSON.stringify({ message: { content: chatCalls === 2 ? "Created simple.py" : "Hello" }, done: true }),
      ]);
    }) as unknown as typeof fetch;

    const runtime = new OllamaRuntime(fetcher);
    await runtime.configure({ provider: "ollama", modelId: "qwen2.5:0.5b-instruct" });
    await runtime.createSession({ sessionId: "s1", workspacePath: "/workspace", modelId: "qwen2.5:0.5b-instruct" });
    const onToolCall = vi.fn(async () => ({ allowed: true, result: { written: true } }));

    await runtime.sendMessage(
      {
        sessionId: "s1",
        workspacePath: "/workspace",
        modelId: "qwen2.5:0.5b-instruct",
        prompt: "create simple.py",
        onToolCall,
      },
      async () => undefined,
    );
    await runtime.sendMessage(
      {
        sessionId: "s1",
        workspacePath: "/workspace",
        modelId: "qwen2.5:0.5b-instruct",
        prompt: "hi",
        onToolCall,
      },
      async () => undefined,
    );

    expect(onToolCall).toHaveBeenCalledTimes(1);
    const firstBody = bodies[0] as { tools?: unknown };
    const lastBody = bodies.at(-1) as { tools?: unknown };
    expect(firstBody.tools).toBeUndefined();
    expect(lastBody.tools).toBeUndefined();
  });

  it("lists models from a running Ollama daemon", async () => {
    const runtime = new OllamaRuntime();
    await runtime.configure({ provider: "ollama" });
    const availability = await runtime.checkAvailability();
    if (!availability.available) {
      return;
    }

    const models = await runtime.discoverModels();
    expect(models.length).toBeGreaterThan(0);
  });
});
