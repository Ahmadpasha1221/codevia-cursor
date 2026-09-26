import * as vscode from "vscode";

export interface SecretStorage {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class VSCodeSecretStorageAdapter implements SecretStorage {
  constructor(private readonly storage: vscode.SecretStorage) {}

  async get(key: string): Promise<string | undefined> {
    return this.storage.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    await this.storage.store(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.storage.delete(key);
  }
}
