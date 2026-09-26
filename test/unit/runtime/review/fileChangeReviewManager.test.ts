import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { FileChangeReviewManager } from "../../../../src/runtime/review/fileChangeReviewManager";

describe("FileChangeReviewManager", () => {
  it("records an edit with correct stats and status", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-review-"));
    const target = path.join(root, "a.ts");
    await fs.writeFile(target, "one\ntwo\n", "utf8");

    const manager = new FileChangeReviewManager();
    const captured = await manager.capture("s1", "call-1", "edit_file", target, "one\nTWO\n");

    const change = manager.getChange(captured.changeId);
    expect(change).toBeDefined();
    expect(change?.additions + change?.deletions).toBeGreaterThan(0);
    expect(change?.status).toBe("APPLIED");
    expect(change?.beforeExists).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("revert restores the original content of an edited file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-review-"));
    const target = path.join(root, "a.ts");
    await fs.writeFile(target, "original\n", "utf8");

    const manager = new FileChangeReviewManager();
    const captured = await manager.capture("s1", "call-1", "write_file", target, "replaced\n");
    await fs.writeFile(target, "replaced\n", "utf8");

    await manager.revert(captured.changeId, root);

    expect(await fs.readFile(target, "utf8")).toBe("original\n");
    expect(manager.getChange(captured.changeId)?.status).toBe("REVERTED");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("revert deletes a file the agent created", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-review-"));
    const target = path.join(root, "created.ts");

    const manager = new FileChangeReviewManager();
    const captured = await manager.capture("s1", "call-1", "write_file", target, "brand new\n");
    await fs.writeFile(target, "brand new\n", "utf8");

    await manager.revert(captured.changeId, root);

    await expect(fs.readFile(target, "utf8")).rejects.toThrow();
    expect(manager.getChange(captured.changeId)?.status).toBe("REVERTED");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("revert is idempotent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-review-"));
    const target = path.join(root, "a.ts");
    await fs.writeFile(target, "original\n", "utf8");

    const manager = new FileChangeReviewManager();
    const captured = await manager.capture("s1", "call-1", "write_file", target, "changed\n");
    await manager.revert(captured.changeId, root);
    await manager.revert(captured.changeId, root);

    expect(await fs.readFile(target, "utf8")).toBe("original\n");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("lists changes per session", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-review-"));
    const manager = new FileChangeReviewManager();
    await manager.capture("s1", "c1", "write_file", path.join(root, "one.ts"), "x\n");
    await manager.capture("s2", "c2", "write_file", path.join(root, "two.ts"), "y\n");

    expect(manager.listChanges("s1")).toHaveLength(1);
    expect(manager.listChanges("s2")).toHaveLength(1);
    expect(manager.listChanges("s3")).toHaveLength(0);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("revert throws for an unknown change id", async () => {
    const manager = new FileChangeReviewManager();
    await expect(manager.revert("nope", ".")).rejects.toThrow("Unknown file change");
  });
});
