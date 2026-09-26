import * as vscode from "vscode";
import type { RuntimeProviderConfig } from "../runtime/runtimeTypes";

const PROVIDER_CONFIG_STORAGE_KEY = "codeviaCursor.providerConfig";

/** Provider settings that persist across restarts. The API key never lands here. */
export interface PersistedProviderConfig {
  readonly provider: RuntimeProviderConfig["provider"];
  readonly modelId?: string;
  readonly baseUrl?: string;
}

/**
 * Persistence for the selected provider configuration, stored in the
 * extension's existing workspace state (the same Memento used by SessionStore)
 * so there is exactly one settings store. Secrets stay out of this file: the
 * OpenRouter key lives in VS Code SecretStorage, exactly as before.
 */
export class ProviderConfigStore {
  constructor(private readonly workspaceState: vscode.Memento) {}

  load(): PersistedProviderConfig | undefined {
    const raw = this.workspaceState.get<unknown>(PROVIDER_CONFIG_STORAGE_KEY);
    if (!isRecord(raw) || typeof raw.provider !== "string" || raw.provider.length === 0) {
      return undefined;
    }
    return {
      provider: raw.provider as RuntimeProviderConfig["provider"],
      ...(typeof raw.modelId === "string" && raw.modelId.length > 0 ? { modelId: raw.modelId } : {}),
      ...(typeof raw.baseUrl === "string" && raw.baseUrl.length > 0 ? { baseUrl: raw.baseUrl } : {}),
    };
  }

  async save(config: RuntimeProviderConfig): Promise<void> {
    const persisted: PersistedProviderConfig = {
      provider: config.provider,
      ...("modelId" in config && typeof config.modelId === "string" && config.modelId.length > 0
        ? { modelId: config.modelId }
        : {}),
      ...("baseUrl" in config && typeof config.baseUrl === "string" && config.baseUrl.length > 0
        ? { baseUrl: config.baseUrl }
        : {}),
    };
    await this.workspaceState.update(PROVIDER_CONFIG_STORAGE_KEY, persisted);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
