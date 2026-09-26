import { describe, expect, it } from "vitest";
import { computeLineDiff, diffStats } from "../../../../src/runtime/review/lineDiff";

describe("computeLineDiff", () => {
  it("returns one hunk with additions and deletions for an edit", () => {
    const diff = computeLineDiff("const a = 1;\nconst b = 2;\n", "const a = 1;\nconst b = 3;\n");

    expect(diff).toHaveLength(1);
    const types = diff[0].lines.map((line) => line.type);
    expect(types).toContain("del");
    expect(types).toContain("add");
    const stats = diffStats(diff);
    expect(stats.additions).toBe(1);
    expect(stats.deletions).toBe(1);
  });

  it("returns an empty diff for identical content", () => {
    expect(computeLineDiff("same\n", "same\n")).toEqual([]);
  });

  it("treats a created file as all additions", () => {
    const diff = computeLineDiff("", "new line\nanother\n");
    const stats = diffStats(diff);
    expect(stats.additions).toBe(2);
    expect(stats.deletions).toBe(0);
  });

  it("treats a deleted file as all deletions", () => {
    const diff = computeLineDiff("gone\n", "");
    const stats = diffStats(diff);
    expect(stats.additions).toBe(0);
    expect(stats.deletions).toBe(1);
  });

  it("handles CRLF content without phantom changes", () => {
    const diff = computeLineDiff("a\r\nb\r\n", "a\r\nb\r\nc\r\n");
    const stats = diffStats(diff);
    expect(stats.additions).toBe(1);
    expect(stats.deletions).toBe(0);
  });

  it("keeps hunk count within the configured maximum", () => {
    const before = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
    const after = Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? `line ${index} changed` : `line ${index}`)).join("\n");
    const diff = computeLineDiff(before, after, { maxHunks: 5 });
    expect(diff.length).toBeLessThanOrEqual(5);
  });
});
