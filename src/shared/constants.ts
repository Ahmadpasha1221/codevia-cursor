export const EXTENSION_ID = "codevia-cursor";
export const EXTENSION_NAME = "Codevia Cursor";

export const COMMANDS = {
  openAgent: "codeviaCursor.openAgent",
  openSettings: "codeviaCursor.openSettings",
} as const;

export const BRAND_COLOR = "#7C3AED";

export const PERMISSION_DEFAULT_TIMEOUT_MS = 120000;

export const DESTRUCTIVE_CONFIRMATIONS: ReadonlySet<string> = new Set([
  "delete",
  "applyAgentDiff",
  "rm",
  "rmdir",
  "git reset --hard",
  "git clean",
  "mkfs",
  "dd if=.*of=",
]);

export const PERMISSION_CATEGORIES = {
  READ: "READ",
  MODIFY: "MODIFY",
  EXECUTE: "EXECUTE",
  EXTERNAL: "EXTERNAL",
  DESTRUCTIVE: "DESTRUCTIVE",
} as const;
