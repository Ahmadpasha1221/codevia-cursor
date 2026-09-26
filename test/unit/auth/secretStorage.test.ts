import { describe, expect, it, vi } from "vitest";
import { VSCodeSecretStorageAdapter } from "../../../src/auth/secretStorage";

describe("VSCodeSecretStorageAdapter", () => {
  it("delegates get, store, and delete", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue("token"),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const adapter = new VSCodeSecretStorageAdapter(storage as unknown as import("vscode").SecretStorage);

    expect(await adapter.get("key")).toBe("token");
    await adapter.store("key", "value");
    await adapter.delete("key");

    expect(storage.get).toHaveBeenCalledWith("key");
    expect(storage.store).toHaveBeenCalledWith("key", "value");
    expect(storage.delete).toHaveBeenCalledWith("key");
  });
});
