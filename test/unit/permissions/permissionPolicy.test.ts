import { describe, expect, it, vi } from "vitest";
import { createDefaultPermissionPolicy } from "../../../src/permissions/permissionPolicy";

vi.mock("vscode", () => ({
  workspace: { isTrusted: true },
}));

describe("PermissionPolicy", () => {
  const createPolicy = (opts = {}) => createDefaultPermissionPolicy({
    isWorkspaceTrusted: () => true,
    autoAllowRead: true,
    autoAllowExternal: false,
    ...opts,
  });

  it("classifies shell as EXECUTE", () => {
    const policy = createPolicy();
    expect(policy.classify("shell", undefined, undefined)).toBe("EXECUTE");
  });

  it("classifies list_files, read_file, and search_files as READ", () => {
    const policy = createPolicy();
    expect(policy.classify("list_files", undefined, undefined)).toBe("READ");
    expect(policy.classify("read_file", undefined, undefined)).toBe("READ");
    expect(policy.classify("search_files", undefined, undefined)).toBe("READ");
  });

  it("classifies write_file, edit_file, create_directory, and move_file as MODIFY", () => {
    const policy = createPolicy({ destructiveConfirmations: new Set() });
    expect(policy.classify("write_file", undefined, undefined)).toBe("MODIFY");
    expect(policy.classify("edit_file", undefined, undefined)).toBe("MODIFY");
    expect(policy.classify("create_directory", undefined, undefined)).toBe("MODIFY");
    expect(policy.classify("move_file", undefined, undefined)).toBe("MODIFY");
  });

  it("classifies run_command as EXECUTE", () => {
    const policy = createPolicy();
    expect(policy.classify("run_command", "pytest", undefined)).toBe("EXECUTE");
  });

  it("classifies delete_file as DESTRUCTIVE", () => {
    const policy = createPolicy();
    expect(policy.classify("delete_file", undefined, undefined)).toBe("DESTRUCTIVE");
  });

  it("classifies webFetch as EXTERNAL (lowercase)", () => {
    const policy = createPolicy();
    expect(policy.classify("webFetch", undefined, undefined)).toBe("EXTERNAL");
  });

  it("classifies webSearch as EXTERNAL", () => {
    const policy = createPolicy();
    expect(policy.classify("webSearch", undefined, undefined)).toBe("EXTERNAL");
  });

  it("classifies semSearch as EXTERNAL", () => {
    const policy = createPolicy();
    expect(policy.classify("semSearch", undefined, undefined)).toBe("EXTERNAL");
  });

  it("classifies mcp as EXTERNAL", () => {
    const policy = createPolicy();
    expect(policy.classify("mcp", undefined, undefined)).toBe("EXTERNAL");
  });

  it("classifies shell as EXECUTE", () => {
    const policy = createPolicy();
    expect(policy.classify("shell", undefined, undefined)).toBe("EXECUTE");
  });

  it("classifies edit as MODIFY", () => {
    const policy = createPolicy({ destructiveConfirmations: new Set() });
    expect(policy.classify("edit", undefined, undefined)).toBe("MODIFY");
  });

  it("classifies delete as DESTRUCTIVE by default", () => {
    const policy = createPolicy();
    expect(policy.classify("delete", undefined, undefined)).toBe("DESTRUCTIVE");
  });

  it("classifies applyAgentDiff as DESTRUCTIVE by default", () => {
    const policy = createPolicy();
    expect(policy.classify("applyAgentDiff", undefined, undefined)).toBe("DESTRUCTIVE");
  });

  it("classifies rm -rf as DESTRUCTIVE", () => {
    const policy = createPolicy();
    expect(policy.classify("shell", "rm -rf /", undefined)).toBe("DESTRUCTIVE");
  });

  it("classifies rm -f as DESTRUCTIVE", () => {
    const policy = createPolicy();
    expect(policy.classify("shell", "rm -f file.txt", undefined)).toBe("DESTRUCTIVE");
  });

  it("classifies git reset --hard as DESTRUCTIVE", () => {
    const policy = createPolicy();
    expect(policy.classify("shell", "git reset --hard", undefined)).toBe("DESTRUCTIVE");
  });

  it("classifies git clean as DESTRUCTIVE", () => {
    const policy = createPolicy();
    expect(policy.classify("shell", "git clean -fd", undefined)).toBe("DESTRUCTIVE");
  });

  it("classifies dd if=.*of= as DESTRUCTIVE", () => {
    const policy = createPolicy();
    expect(policy.classify("shell", "dd if=/dev/zero of=/dev/sda", undefined)).toBe("DESTRUCTIVE");
  });

  it("auto-allows READ operations", () => {
    const policy = createDefaultPermissionPolicy({ autoAllowRead: true });
    const request = {
      requestId: "r1",
      sessionId: "s1",
      category: "READ" as const,
      toolName: "read",
      description: "read file",
      destructive: false,
    };
    expect(policy.shouldAutoAllow(request)).toBe(true);
  });

  it("auto-allows EXTERNAL when configured", () => {
    const policy = createDefaultPermissionPolicy({ autoAllowExternal: true });
    const request = {
      requestId: "r1",
      sessionId: "s1",
      category: "EXTERNAL" as const,
      toolName: "webFetch",
      description: "fetch",
      destructive: false,
    };
    expect(policy.shouldAutoAllow(request)).toBe(true);
  });

  it("never auto-allows DESTRUCTIVE", () => {
    const policy = createDefaultPermissionPolicy();
    const request = {
      requestId: "r1",
      sessionId: "s1",
      category: "DESTRUCTIVE" as const,
      toolName: "delete",
      description: "delete",
      destructive: true,
    };
    expect(policy.shouldAutoAllow(request)).toBe(false);
  });

  it("never auto-allows MODIFY", () => {
    const policy = createDefaultPermissionPolicy();
    const request = {
      requestId: "r1",
      sessionId: "s1",
      category: "MODIFY" as const,
      toolName: "edit",
      description: "edit",
      destructive: false,
    };
    expect(policy.shouldAutoAllow(request)).toBe(false);
  });

  it("blocks non-READ in untrusted workspace", () => {
    const policy = createDefaultPermissionPolicy({ isWorkspaceTrusted: () => false });
    const request = {
      requestId: "r1",
      sessionId: "s1",
      category: "EXECUTE" as const,
      toolName: "shell",
      description: "shell",
      destructive: false,
    };
    expect(policy.isBlockedByTrust(request)).toBe(true);
  });

  it("allows READ in untrusted workspace", () => {
    const policy = createDefaultPermissionPolicy({ isWorkspaceTrusted: () => false });
    const request = {
      requestId: "r1",
      sessionId: "s1",
      category: "READ" as const,
      toolName: "read",
      description: "read",
      destructive: false,
    };
    expect(policy.isBlockedByTrust(request)).toBe(false);
  });

  it("does not block in trusted workspace", () => {
    const policy = createDefaultPermissionPolicy({ isWorkspaceTrusted: () => true });
    const request = {
      requestId: "r1",
      sessionId: "s1",
      category: "EXECUTE" as const,
      toolName: "shell",
      description: "shell",
      destructive: false,
    };
    expect(policy.isBlockedByTrust(request)).toBe(false);
  });

  it("getDisallowedToolNames includes delete and applyAgentDiff", () => {
    const policy = createDefaultPermissionPolicy();
    const disallowed = policy.getDisallowedToolNames();
    expect(disallowed).toContain("delete");
    expect(disallowed).toContain("applyAgentDiff");
  });

  it("getDisallowedToolNames includes external tools when autoAllowExternal is false", () => {
    const policy = createDefaultPermissionPolicy({ autoAllowExternal: false });
    const disallowed = policy.getDisallowedToolNames();
    expect(disallowed).toContain("webFetch");
    expect(disallowed).toContain("webSearch");
    expect(disallowed).toContain("semSearch");
    expect(disallowed).toContain("mcp");
  });

  it("getDisallowedToolNames does not include external tools when autoAllowExternal is true", () => {
    const policy = createDefaultPermissionPolicy({ autoAllowExternal: true });
    const disallowed = policy.getDisallowedToolNames();
    expect(disallowed).not.toContain("webFetch");
    expect(disallowed).not.toContain("webSearch");
    expect(disallowed).not.toContain("semSearch");
    expect(disallowed).not.toContain("mcp");
  });

  it("getDisallowedToolNames includes shell, edit, task, generateImage when untrusted", () => {
    const policy = createDefaultPermissionPolicy({ isWorkspaceTrusted: () => false });
    const disallowed = policy.getDisallowedToolNames();
    expect(disallowed).toContain("shell");
    expect(disallowed).toContain("edit");
    expect(disallowed).toContain("task");
    expect(disallowed).toContain("generateImage");
  });

  it("getDisallowedToolNames does not include shell etc when trusted", () => {
    const policy = createDefaultPermissionPolicy({ isWorkspaceTrusted: () => true });
    const disallowed = policy.getDisallowedToolNames();
    expect(disallowed).not.toContain("shell");
    expect(disallowed).not.toContain("edit");
    expect(disallowed).not.toContain("task");
    expect(disallowed).not.toContain("generateImage");
  });
});