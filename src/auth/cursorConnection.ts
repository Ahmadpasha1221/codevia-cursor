import { CursorClient } from "./cursorClient";
import { CursorAuthError } from "./cursorAuthError";
import { SecretStorage } from "./secretStorage";
import { API_KEY_SECRET_KEY } from "../shared/constants";
import type { AuthStatusMessage } from "../webview/types";

export interface CursorConnection {
  connect(apiKey?: string): Promise<AuthStatusMessage>;
  disconnect(): Promise<AuthStatusMessage>;
  getStatus(): Promise<AuthStatusMessage>;
  restore(): Promise<AuthStatusMessage>;
}

export class CursorConnectionService implements CursorConnection {
  constructor(
    private readonly secretStorage: SecretStorage,
    private readonly cursorClient: CursorClient,
    private readonly getWorkspacePath: () => string,
  ) {}

  async restore(): Promise<AuthStatusMessage> {
    const stored = await this.secretStorage.get(API_KEY_SECRET_KEY);
    if (!stored) {
      this.cursorClient.setApiKey(undefined);
      return this.statusMessage("disconnected", false);
    }

    this.cursorClient.setApiKey(stored);
    return this.validateStoredKey();
  }

  async connect(apiKey?: string): Promise<AuthStatusMessage> {
    const incoming = apiKey?.trim();
    const stored = await this.secretStorage.get(API_KEY_SECRET_KEY);
    const key = incoming && incoming.length > 0 ? incoming : stored;

    if (!key) {
      this.cursorClient.setApiKey(undefined);
      return this.statusMessage("disconnected", false, "Enter a Cursor API key to connect.");
    }

    this.cursorClient.setApiKey(key);

    try {
      const message = await this.cursorClient.validateConnection(this.getWorkspacePath());
      if (incoming && incoming.length > 0) {
        await this.secretStorage.store(API_KEY_SECRET_KEY, incoming);
      }
      return this.statusMessage("connected", true, undefined, message);
    } catch (error) {
      this.cursorClient.setApiKey(undefined);
      if (incoming && incoming.length > 0) {
        await this.secretStorage.delete(API_KEY_SECRET_KEY);
      }
      return this.statusMessage("error", Boolean(stored) && !incoming, this.toUserError(error));
    }
  }

  async disconnect(): Promise<AuthStatusMessage> {
    this.cursorClient.setApiKey(undefined);
    await this.secretStorage.delete(API_KEY_SECRET_KEY);
    return this.statusMessage("disconnected", false);
  }

  async getStatus(): Promise<AuthStatusMessage> {
    const hasKey = Boolean(await this.secretStorage.get(API_KEY_SECRET_KEY));
    if (this.cursorClient.hasApiKey()) {
      return this.statusMessage("connected", hasKey);
    }
    return this.statusMessage("disconnected", hasKey);
  }

  private async validateStoredKey(): Promise<AuthStatusMessage> {
    try {
      const message = await this.cursorClient.validateConnection(this.getWorkspacePath());
      return this.statusMessage("connected", true, undefined, message);
    } catch (error) {
      this.cursorClient.setApiKey(undefined);
      return this.statusMessage("error", true, this.toUserError(error));
    }
  }

  private statusMessage(
    status: AuthStatusMessage["status"],
    hasKey: boolean,
    error?: string,
    message?: string,
  ): AuthStatusMessage {
    return {
      type: "AUTH_STATUS",
      status,
      hasKey,
      ...(error ? { error } : {}),
      ...(message ? { message } : {}),
    };
  }

  private toUserError(error: unknown): string {
    if (error instanceof CursorAuthError) {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "Could not connect to Cursor with this API key.";
  }
}
