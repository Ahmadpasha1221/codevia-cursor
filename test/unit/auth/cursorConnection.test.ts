import { describe, expect, it, vi } from "vitest";
import { CursorConnectionService } from "../../../src/auth/cursorConnection";
import { CursorClient } from "../../../src/auth/cursorClient";
import { API_KEY_SECRET_KEY } from "../../../src/shared/constants";

describe("CursorConnectionService", () => {
  it("stores the key only after a successful Cursor validation", async () => {
    const secretStorage = {
      get: vi.fn().mockResolvedValue(undefined),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const cursorClient = {
      setApiKey: vi.fn(),
      hasApiKey: vi.fn().mockReturnValue(true),
      validateConnection: vi.fn().mockResolvedValue("pong"),
    } as unknown as CursorClient;

    const service = new CursorConnectionService(secretStorage, cursorClient, () => "/workspace");
    const status = await service.connect("cursor_secret");

    expect(cursorClient.setApiKey).toHaveBeenCalledWith("cursor_secret");
    expect(cursorClient.validateConnection).toHaveBeenCalledWith("/workspace");
    expect(secretStorage.store).toHaveBeenCalledWith(API_KEY_SECRET_KEY, "cursor_secret");
    expect(status).toEqual({
      type: "AUTH_STATUS",
      status: "connected",
      hasKey: true,
      message: "pong",
    });
    expect(JSON.stringify(status)).not.toContain("cursor_secret");
  });

  it("does not persist an invalid key and returns a user-facing error", async () => {
    const secretStorage = {
      get: vi.fn().mockResolvedValue(undefined),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const cursorClient = {
      setApiKey: vi.fn(),
      hasApiKey: vi.fn().mockReturnValue(false),
      validateConnection: vi.fn().mockRejectedValue(new Error("Invalid API key")),
    } as unknown as CursorClient;

    const service = new CursorConnectionService(secretStorage, cursorClient, () => "/workspace");
    const status = await service.connect("bad-key");

    expect(secretStorage.store).not.toHaveBeenCalled();
    expect(secretStorage.delete).toHaveBeenCalledWith(API_KEY_SECRET_KEY);
    expect(status.status).toBe("error");
    expect(status.hasKey).toBe(false);
    expect(JSON.stringify(status)).not.toContain("bad-key");
  });

  it("disconnects by clearing SecretStorage and the SDK client", async () => {
    const secretStorage = {
      get: vi.fn().mockResolvedValue("stored"),
      store: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const cursorClient = {
      setApiKey: vi.fn(),
      hasApiKey: vi.fn().mockReturnValue(false),
      validateConnection: vi.fn(),
    } as unknown as CursorClient;

    const service = new CursorConnectionService(secretStorage, cursorClient, () => "/workspace");
    const status = await service.disconnect();

    expect(cursorClient.setApiKey).toHaveBeenCalledWith(undefined);
    expect(secretStorage.delete).toHaveBeenCalledWith(API_KEY_SECRET_KEY);
    expect(status).toEqual({ type: "AUTH_STATUS", status: "disconnected", hasKey: false });
  });
});
