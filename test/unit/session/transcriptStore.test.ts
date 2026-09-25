import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { TranscriptStore } from "../../../src/session/transcriptStore";

function toGlobalStorageUri(root: string): vscode.Uri {
  return { fsPath: root } as unknown as vscode.Uri;
}

describe("TranscriptStore", () => {
  it("round-trips entries across a simulated restart", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-transcript-"));
    const store = new TranscriptStore(toGlobalStorageUri(root));

    await store.append("session-1", { kind: "user", text: "Fix the bug", timestamp: 1 });
    await store.append("session-1", { kind: "tool", text: "Using read_file", timestamp: 2, toolName: "read_file", path: "src/a.ts" });
    await store.append("session-1", { kind: "assistant", text: "Fixed it", timestamp: 3 });

    const entries = await store.load("session-1");

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ kind: "user", text: "Fix the bug" });
    expect(entries[1]).toMatchObject({ kind: "tool", toolName: "read_file", path: "src/a.ts" });
    expect(entries[2]).toMatchObject({ kind: "assistant", text: "Fixed it" });
    await fs.rm(root, { recursive: true, force: true });
  });

  it("keeps sessions isolated in separate files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-transcript-"));
    const store = new TranscriptStore(toGlobalStorageUri(root));

    await store.append("session-1", { kind: "user", text: "one", timestamp: 1 });
    await store.append("session-2", { kind: "user", text: "two", timestamp: 2 });

    expect((await store.load("session-1")).map((entry) => entry.text)).toEqual(["one"]);
    expect((await store.load("session-2")).map((entry) => entry.text)).toEqual(["two"]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("drops a torn final line without losing earlier entries", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-transcript-"));
    const store = new TranscriptStore(toGlobalStorageUri(root));
    await store.append("session-1", { kind: "user", text: "before crash", timestamp: 1 });

    const transcriptDir = path.join(root, "transcripts");
    await fs.appendFile(path.join(transcriptDir, "session-1.jsonl"), '{"kind":"assistant","tex', "utf8");

    const entries = await store.load("session-1");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.text).toBe("before crash");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns an empty transcript for unknown sessions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-transcript-"));
    const store = new TranscriptStore(toGlobalStorageUri(root));

    expect(await store.load("missing")).toEqual([]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("rejects session ids that could escape the transcripts directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-transcript-"));
    const store = new TranscriptStore(toGlobalStorageUri(root));

    await store.append("../escape", { kind: "user", text: "nope", timestamp: 1 });
    await store.delete("../escape");

    expect(await store.load("../escape")).toEqual([]);
    const siblings = await fs.readdir(root);
    expect(siblings).toEqual([]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("delete removes only the target transcript", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-transcript-"));
    const store = new TranscriptStore(toGlobalStorageUri(root));
    await store.append("session-1", { kind: "user", text: "keep me", timestamp: 1 });
    await store.append("session-2", { kind: "user", text: "delete me", timestamp: 2 });

    await store.delete("session-2");

    expect(await store.load("session-2")).toEqual([]);
    expect(await store.load("session-1")).toHaveLength(1);
    await fs.rm(root, { recursive: true, force: true });
  });
});
