import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ProviderConfigStore } from "../../../src/session/providerConfigStore";
import { RuntimeManager } from "../../../src/runtime/runtimeManager";
import { WorkspaceToolExecutor } from "../../../src/runtime/tools/workspaceToolExecutor";
import { PermissionManager } from "../../../src/permissions/permissionManager";
import { createDefaultPermissionPolicy } from "../../../src/permissions/permissionPolicy";
import type { RuntimeProviderConfig } from "../../../src/runtime/runtimeTypes";

vi.mock("vscode", () => ({
  EventEmitter: class {
    private listeners: ((event: unknown) => void)[] = [];
    event: (listener: (event: unknown) => void) => void;
    constructor() {
      this.event = (listener: (event: unknown) => void) => {
        this.listeners.push(listener);
      };
    }
    fire(event: unknown): void {
      this.listeners.forEach((listener) => listener(event));
    }
    dispose(): void {
      this.listeners = [];
    }
  },
}));

function createMemento(values: Record<string, unknown> = {}) {
  return {
    get: vi.fn((key: string) => values[key]),
    update: vi.fn(async (key: string, value: unknown) => {
      values[key] = value;
    }),
  };
}

const PROVIDER_KEY = "codeviaCursor.providerConfig";

describe("ProviderConfigStore", () => {
  it("returns undefined when nothing is saved", () => {
    const store = new ProviderConfigStore(createMemento() as never);
    expect(store.load()).toBeUndefined();
  });

  it("saves provider, model, and baseUrl but never secrets", async () => {
    const values: Record<string, unknown> = {};
    const memento = createMemento(values) as unknown as { get: (key: string) => unknown; update: (key: string, value: unknown) => Promise<void> };
    const store = new ProviderConfigStore(memento as never);
    const config: RuntimeProviderConfig = {
      provider: "openai-compatible",
      baseUrl: "http://127.0.0.1:1234/v1",
      modelId: "gpt-4o-mini",
      apiKey: "sk-super-secret",
    };

    await store.save(config);

    const persisted = values[PROVIDER_KEY] as Record<string, unknown>;
    expect(persisted).toEqual({
      provider: "openai-compatible",
      baseUrl: "http://127.0.0.1:1234/v1",
      modelId: "gpt-4o-mini",
    });
    expect(JSON.stringify(persisted)).not.toContain("sk-super-secret");
    expect(store.load()).toEqual({
      provider: "openai-compatible",
      baseUrl: "http://127.0.0.1:1234/v1",
      modelId: "gpt-4o-mini",
    });
  });
});

function createStore() {
  return {
    loadSessions: () => [],
    loadActiveSessionId: () => undefined,
    saveSessions: vi.fn().mockResolvedValue(undefined),
    saveActiveSessionId: vi.fn().mockResolvedValue(undefined),
  };
}

describe("RuntimeManager provider restore", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-provider-"));
  });

  function makeManager(memento: Record<string, unknown>): RuntimeManager {
    const configure = vi.fn(async () => undefined);
    return new RuntimeManager({
      sessionStore: createStore() as never,
      permissionManager: new PermissionManager(createDefaultPermissionPolicy({ isWorkspaceTrusted: () => true })),
      runtimes: [
        {
          provider: "ollama",
          family: "inference",
          configure: vi.fn(async () => undefined),
          checkAvailability: vi.fn(async () => ({ available: true, status: "connected" as const })),
          discoverModels: vi.fn(async () => []),
          createSession: vi.fn(async () => ({})),
          resumeSession: vi.fn(async () => ({})),
          sendMessage: vi.fn(async () => undefined),
          cancel: vi.fn(async () => undefined),
          dispose: vi.fn(),
        },
        {
          provider: "openrouter",
          family: "inference",
          configure,
          checkAvailability: vi.fn(async () => ({ available: true, status: "connected" as const })),
          discoverModels: vi.fn(async () => []),
          createSession: vi.fn(async () => ({})),
          resumeSession: vi.fn(async () => ({})),
          sendMessage: vi.fn(async () => undefined),
          cancel: vi.fn(async () => undefined),
          dispose: vi.fn(),
        },
      ],
      toolExecutor: new WorkspaceToolExecutor(),
      defaultWorkspacePath: root,
      providerConfigStore: new ProviderConfigStore(createMemento(memento) as never),
    });
  }

  it("defers the saved openrouter config to the caller so the secret can be re-attached", async () => {
    const memento: Record<string, unknown> = {
      [PROVIDER_KEY]: { provider: "openrouter", modelId: "anthropic/claude-sonnet-4" },
    };
    const manager = makeManager(memento);

    const restored = await manager.restoreProviderConfig();

    // Returned for the caller (extension.ts re-attaches the key from
    // SecretStorage and then calls setProvider), but not applied here.
    expect(restored).toEqual({ provider: "openrouter", modelId: "anthropic/claude-sonnet-4" });
    expect(manager.provider).toBeUndefined();
  });

  it("applies a saved local provider config directly", async () => {
    const memento: Record<string, unknown> = {
      [PROVIDER_KEY]: { provider: "ollama", modelId: "qwen2.5:0.5b-instruct", baseUrl: "http://127.0.0.1:11434" },
    };
    const manager = makeManager(memento);

    const restored = await manager.restoreProviderConfig();

    expect(restored).toEqual({
      provider: "ollama",
      modelId: "qwen2.5:0.5b-instruct",
      baseUrl: "http://127.0.0.1:11434",
    });
    expect(manager.provider).toBe("ollama");
  });

  it("returns undefined when no provider was saved", async () => {
    const manager = makeManager({});
    expect(await manager.restoreProviderConfig()).toBeUndefined();
  });
});
