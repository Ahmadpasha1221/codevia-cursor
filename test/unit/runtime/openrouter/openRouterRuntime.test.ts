import { describe, expect, it, vi } from "vitest";
import { OpenRouterRuntime, OPENROUTER_BASE_URL } from "../../../../src/runtime/openrouter/openRouterRuntime";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CATALOG = {
  data: [
    {
      id: "anthropic/claude-sonnet-4",
      name: "Claude Sonnet 4",
      context_length: 200000,
      architecture: { input_modalities: ["text", "image"] },
      supported_parameters: ["tools", "tool_choice", "structured_outputs"],
      pricing: { prompt: "0.000003", completion: "0.000015" },
    },
    {
      id: "meta-llama/llama-3-8b-instruct",
      name: "Llama 3 8B Instruct",
      context_length: 8192,
      architecture: { input_modalities: ["text"] },
      supported_parameters: [],
      pricing: { prompt: "0", completion: "0" },
    },
  ],
};

function fetcherWith(catalogResponse: () => Response, chatResponse?: () => Response) {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    if (String(url).endsWith("/models")) {
      return catalogResponse();
    }
    if (String(url).endsWith("/chat/completions")) {
      return chatResponse
        ? chatResponse()
        : jsonResponse({ choices: [{ message: { content: "Hello" } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
    }
    throw new TypeError(`Unexpected URL ${String(url)}`);
  }) as unknown as typeof fetch;
}

describe("OpenRouterRuntime", () => {
  it("maps catalog entries to runtime models with metadata", async () => {
    const fetcher = fetcherWith(() => jsonResponse(CATALOG));
    const runtime = new OpenRouterRuntime(fetcher);
    const models = await runtime.discoverModels();

    expect(models).toHaveLength(2);
    const claude = models[0];
    expect(claude.id).toBe("anthropic/claude-sonnet-4");
    expect(claude.name).toBe("Claude Sonnet 4");
    expect(claude.provider).toBe("openrouter");
    expect(claude.contextWindow).toBe(200000);
    expect(claude.capabilities?.toolCalling).toBe(true);
    expect(claude.capabilities?.vision).toBe(true);
    expect(claude.pricing?.promptUsdPerMillion).toBeCloseTo(3);
    expect(claude.pricing?.completionUsdPerMillion).toBeCloseTo(15);

    const llama = models[1];
    expect(llama.capabilities?.toolCalling).toBe(false);
    expect(llama.capabilities?.vision).toBe(false);
    expect(llama.pricing?.promptUsdPerMillion).toBe(0);
  });

  it("reports authentication failure for invalid API keys", async () => {
    const fetcher = fetcherWith(() => jsonResponse({ error: "invalid key" }, 401));
    const runtime = new OpenRouterRuntime(fetcher);
    await expect(runtime.discoverModels()).rejects.toMatchObject({ code: "authentication_failed" });
  });

  it("reports rate limit errors as retryable", async () => {
    const fetcher = fetcherWith(() => jsonResponse({}, 429));
    const runtime = new OpenRouterRuntime(fetcher);
    await expect(runtime.discoverModels()).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
  });

  it("reports network failures", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const runtime = new OpenRouterRuntime(fetcher);
    await expect(runtime.discoverModels()).rejects.toMatchObject({ code: "network_error" });
    const availability = await runtime.checkAvailability();
    expect(availability.available).toBe(false);
    expect(availability.status).toBe("disconnected");
  });

  it("throws no_models_found for an empty catalog", async () => {
    const fetcher = fetcherWith(() => jsonResponse({ data: [] }));
    const runtime = new OpenRouterRuntime(fetcher);
    await expect(runtime.discoverModels()).rejects.toMatchObject({ code: "no_models_found" });
  });

  it("skips malformed catalog entries", async () => {
    const fetcher = fetcherWith(() =>
      jsonResponse({
        data: [{ name: "No id" }, { id: "vendor/valid", name: "Valid" }],
      }),
    );
    const runtime = new OpenRouterRuntime(fetcher);
    const models = await runtime.discoverModels();
    expect(models.map((model) => model.id)).toEqual(["vendor/valid"]);
  });

  it("sends the API key as a bearer token and never in the URL", async () => {
    const seen: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push(`${String(url)}|${new Headers(init?.headers).get("Authorization") ?? ""}`);
      return jsonResponse(CATALOG);
    }) as unknown as typeof fetch;
    const runtime = new OpenRouterRuntime(fetcher);
    await runtime.configure({ provider: "openrouter", apiKey: "sk-or-secret" });
    await runtime.discoverModels();

    expect(seen).toHaveLength(1);
    const [url, authorization] = seen[0].split("|");
    expect(url).toBe(`${OPENROUTER_BASE_URL}/models`);
    expect(authorization).toBe("Bearer sk-or-secret");
    // The secret travels only in the Authorization header, never in the URL.
    expect(url.includes("sk-or-secret")).toBe(false);
  });

  it("uses the selected model and native tools for chat completions", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/models")) {
        return jsonResponse(CATALOG);
      }
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({
        choices: [{ message: { content: "Hello" } }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      });
    }) as unknown as typeof fetch;

    const runtime = new OpenRouterRuntime(fetcher);
    await runtime.configure({ provider: "openrouter", apiKey: "k", modelId: "anthropic/claude-sonnet-4" });
    await runtime.createSession({ sessionId: "s1", workspacePath: "/ws", modelId: "anthropic/claude-sonnet-4" });

    const events: Array<{ type: string; message?: string }> = [];
    await runtime.sendMessage(
      { sessionId: "s1", workspacePath: "/ws", modelId: "anthropic/claude-sonnet-4", prompt: "hi" },
      (event) => {
        events.push(event);
      },
    );

    expect(bodies[0].model).toBe("anthropic/claude-sonnet-4");
    expect(Array.isArray(bodies[0].tools)).toBe(true);
    expect(events.some((event) => event.type === "assistant_message" && event.message === "Hello")).toBe(true);
  });

  it("reports model_unavailable when the selected model is missing", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/models")) {
        return jsonResponse(CATALOG);
      }
      return jsonResponse({ error: "model not found" }, 404);
    }) as unknown as typeof fetch;

    const runtime = new OpenRouterRuntime(fetcher);
    await runtime.configure({ provider: "openrouter", apiKey: "k", modelId: "vendor/gone" });
    await runtime.createSession({ sessionId: "s1", workspacePath: "/ws", modelId: "vendor/gone" });
    await expect(
      runtime.sendMessage({ sessionId: "s1", workspacePath: "/ws", modelId: "vendor/gone", prompt: "hi" }, async () => undefined),
    ).rejects.toMatchObject({ code: "model_unavailable" });
  });

  it("rejects prompts without a selected model", async () => {
    const fetcher = fetcherWith(() => jsonResponse(CATALOG));
    const runtime = new OpenRouterRuntime(fetcher);
    await runtime.createSession({ sessionId: "s1", workspacePath: "/ws" });
    await expect(
      runtime.sendMessage({ sessionId: "s1", workspacePath: "/ws", prompt: "hi" }, async () => undefined),
    ).rejects.toMatchObject({ code: "model_unavailable" });
  });

  it("sends tool results with the exact tool_call_id from the assistant tool call", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/models")) {
        return jsonResponse(CATALOG);
      }
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (bodies.length === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call_123",
                    type: "function",
                    function: { name: "list_files", arguments: "{\"path\":\".\"}" },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        });
      }
      return jsonResponse({
        choices: [{ message: { content: "Your workspace has a.py and b.ts." } }],
        usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
      });
    }) as unknown as typeof fetch;

    const runtime = new OpenRouterRuntime(fetcher);
    await runtime.configure({ provider: "openrouter", apiKey: "k", modelId: "anthropic/claude-sonnet-4" });
    await runtime.createSession({ sessionId: "s1", workspacePath: "/ws", modelId: "anthropic/claude-sonnet-4" });

    const events: Array<{ type: string; message?: string }> = [];
    await runtime.sendMessage(
      {
        sessionId: "s1",
        workspacePath: "/ws",
        modelId: "anthropic/claude-sonnet-4",
        prompt: "check what files are in my workspace",
        onToolCall: async () => ({ allowed: true, result: { success: true, files: ["a.py", "b.ts"] } }),
      },
      (event) => {
        events.push(event);
      },
    );

    // Second request must contain the assistant tool_calls with the provider id...
    const secondMessages = bodies[1]?.messages as Array<Record<string, unknown>>;
    const assistantToolCallTurn = secondMessages.find(
      (message) => message.role === "assistant" && Array.isArray(message.tool_calls),
    );
    expect(assistantToolCallTurn).toBeDefined();
    expect((assistantToolCallTurn?.tool_calls as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: "call_123",
      type: "function",
    });
    expect((assistantToolCallTurn?.tool_calls as Array<Record<string, unknown>>)[0].function).toMatchObject({
      name: "list_files",
      arguments: "{\"path\":\".\"}",
    });
    // ...and the tool result referencing exactly call_123.
    const toolTurn = secondMessages.find((message) => message.role === "tool");
    expect(toolTurn).toBeDefined();
    expect(toolTurn?.tool_call_id).toBe("call_123");
    expect(typeof toolTurn?.content).toBe("string");
    expect((toolTurn?.content as string).length).toBeGreaterThan(0);

    // The loop completed with a final model answer.
    expect(events.some((event) => event.type === "assistant_message" && event.message === "Your workspace has a.py and b.ts.")).toBe(true);
  });

  it("keeps the conversation valid for a later normal message after tool calls", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let chatCalls = 0;
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/models")) {
        return jsonResponse(CATALOG);
      }
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      chatCalls += 1;
      if (chatCalls === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  { id: "call_1", type: "function", function: { name: "list_files", arguments: "{}" } },
                  { id: "call_2", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a.py\"}" } },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        });
      }
      return jsonResponse({
        choices: [{ message: { content: "Here is what I found." } }],
        usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
      });
    }) as unknown as typeof fetch;

    const runtime = new OpenRouterRuntime(fetcher);
    await runtime.configure({ provider: "openrouter", apiKey: "k", modelId: "anthropic/claude-sonnet-4" });
    await runtime.createSession({ sessionId: "s1", workspacePath: "/ws", modelId: "anthropic/claude-sonnet-4" });

    await runtime.sendMessage(
      {
        sessionId: "s1",
        workspacePath: "/ws",
        modelId: "anthropic/claude-sonnet-4",
        prompt: "check what files are in my workspace",
        onToolCall: async (call) => ({ allowed: true, result: { success: true, tool: call.name } }),
      },
      async () => undefined,
    );

    // A later normal message must reuse the same history without re-sending
    // malformed tool turns (no duplicate tool messages, every id preserved).
    await runtime.sendMessage(
      { sessionId: "s1", workspacePath: "/ws", modelId: "anthropic/claude-sonnet-4", prompt: "hi" },
      async () => undefined,
    );

    const thirdMessages = bodies[2]?.messages as Array<Record<string, unknown>>;
    const toolTurns = thirdMessages.filter((message) => message.role === "tool");
    expect(toolTurns).toHaveLength(2);
    expect(toolTurns[0]).toMatchObject({ role: "tool", tool_call_id: "call_1" });
    expect(toolTurns[1]).toMatchObject({ role: "tool", tool_call_id: "call_2" });
    expect(bodies[2].messages).toBeDefined();
  });

  it("maps parallel tool calls to results with matching ids in request order", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let chatCalls = 0;
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/models")) {
        return jsonResponse(CATALOG);
      }
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      chatCalls += 1;
      if (chatCalls === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  { id: "call_1", type: "function", function: { name: "list_files", arguments: "{}" } },
                  { id: "call_2", type: "function", function: { name: "search_files", arguments: "{\"query\":\"TODO\"}" } },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        });
      }
      return jsonResponse({
        choices: [{ message: { content: "Done listing and searching." } }],
        usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
      });
    }) as unknown as typeof fetch;

    const runtime = new OpenRouterRuntime(fetcher);
    await runtime.configure({ provider: "openrouter", apiKey: "k", modelId: "anthropic/claude-sonnet-4" });
    await runtime.createSession({ sessionId: "s1", workspacePath: "/ws", modelId: "anthropic/claude-sonnet-4" });

    await runtime.sendMessage(
      {
        sessionId: "s1",
        workspacePath: "/ws",
        modelId: "anthropic/claude-sonnet-4",
        prompt: "list files and search for TODO",
        onToolCall: async () => ({ allowed: true, result: { success: true } }),
      },
      async () => undefined,
    );

    const secondMessages = bodies[1]?.messages as Array<Record<string, unknown>>;
    const toolTurns = secondMessages.filter((message) => message.role === "tool");
    expect(toolTurns.map((turn) => turn.tool_call_id)).toEqual(["call_1", "call_2"]);
  });
});
