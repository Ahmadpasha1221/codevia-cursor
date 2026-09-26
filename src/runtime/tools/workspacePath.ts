import * as fs from "node:fs/promises";
import * as path from "node:path";

export function resolveWorkspacePath(workspacePath: string, requestedPath = "."): string {
  const root = path.resolve(workspacePath);
  const cleaned = requestedPath.trim().replace(/^['"]|['"]$/g, "");
  const normalized = path.normalize(cleaned.length > 0 ? cleaned : ".");
  const target = path.isAbsolute(normalized) ? normalized : path.resolve(root, normalized);
  if (!isInsideWorkspace(root, target)) {
    throw new Error(`Path is outside the workspace: ${requestedPath}`);
  }
  return target;
}

export function isInsideWorkspace(workspacePath: string, targetPath: string): boolean {
  const root = path.resolve(workspacePath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
