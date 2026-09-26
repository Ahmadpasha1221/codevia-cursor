export interface DiffLine {
  readonly type: "context" | "add" | "del";
  readonly text: string;
  readonly oldLine?: number;
  readonly newLine?: number;
}

export interface DiffHunk {
  readonly header: string;
  readonly lines: readonly DiffLine[];
}

const CONTEXT_LINES = 3;
const MAX_HUNKS = 20;
const MAX_LINES_PER_HUNK = 400;

export interface ComputeDiffOptions {
  readonly maxHunks?: number;
  readonly maxLinesPerHunk?: number;
}

/**
 * Unified-style line diff built on an LCS table. Used both to render review
 * cards in the webview and to construct the reverse edit for "Reject".
 */
export function computeLineDiff(before: string, after: string, options: ComputeDiffOptions = {}): DiffHunk[] {
  const maxHunks = options.maxHunks ?? MAX_HUNKS;
  const maxLinesPerHunk = options.maxLinesPerHunk ?? MAX_LINES_PER_HUNK;

  const oldLines = splitLines(before);
  const newLines = splitLines(after);

  // Skip the common prefix/suffix so the LCS table stays small for edits.
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start += 1;
  }
  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld -= 1;
    endNew -= 1;
  }

  const middle = lcsDiff(
    oldLines.slice(start, endOld),
    newLines.slice(start, endNew),
  );

  const raw: DiffLine[] = [
    ...oldLines.slice(0, start).map((text, index) => ({ type: "context" as const, text, oldLine: index + 1, newLine: index + 1 })),
    ...middle.map((line) => ({
      ...line,
      ...(line.oldLine !== undefined ? { oldLine: line.oldLine + start } : {}),
      ...(line.newLine !== undefined ? { newLine: line.newLine + start } : {}),
    })),
    ...oldLines
      .slice(endOld)
      .map((text, index) => ({
        type: "context" as const,
        text,
        oldLine: endOld + index + 1,
        newLine: endNew + index + 1,
      })),
  ];

  return groupHunks(raw, maxHunks, maxLinesPerHunk);
}

function lcsDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const rows = oldLines.length;
  const cols = newLines.length;

  if (rows === 0) {
    return newLines.map((text, index) => ({ type: "add" as const, text, newLine: index + 1 }));
  }
  if (cols === 0) {
    return oldLines.map((text, index) => ({ type: "del" as const, text, oldLine: index + 1 }));
  }

  // Guard against pathological inputs: fall back to replace-all beyond this size.
  if (rows * cols > 4_000_000) {
    return [
      ...oldLines.map((text, index) => ({ type: "del" as const, text, oldLine: index + 1 })),
      ...newLines.map((text, index) => ({ type: "add" as const, text, newLine: index + 1 })),
    ];
  }

  const table = new Uint32Array((rows + 1) * (cols + 1));
  const at = (row: number, col: number): number => row * (cols + 1) + col;
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      table[at(row, col)] = oldLines[row] === newLines[col]
        ? table[at(row + 1, col + 1)] + 1
        : Math.max(table[at(row + 1, col)], table[at(row, col + 1)]);
    }
  }

  const lines: DiffLine[] = [];
  let row = 0;
  let col = 0;
  while (row < rows && col < cols) {
    if (oldLines[row] === newLines[col]) {
      lines.push({ type: "context", text: oldLines[row], oldLine: row + 1, newLine: col + 1 });
      row += 1;
      col += 1;
    } else if (table[at(row + 1, col)] >= table[at(row, col + 1)]) {
      lines.push({ type: "del", text: oldLines[row], oldLine: row + 1 });
      row += 1;
    } else {
      lines.push({ type: "add", text: newLines[col], newLine: col + 1 });
      col += 1;
    }
  }
  while (row < rows) {
    lines.push({ type: "del", text: oldLines[row], oldLine: row + 1 });
    row += 1;
  }
  while (col < cols) {
    lines.push({ type: "add", text: newLines[col], newLine: col + 1 });
    col += 1;
  }
  return lines;
}

function groupHunks(lines: readonly DiffLine[], maxHunks: number, maxLinesPerHunk: number): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffLine[] = [];
  let firstOld: number | undefined;
  let lastOld: number | undefined;

  const flush = (): void => {
    // A hunk must contain at least one real change; skip context-only runs.
    if (current.length === 0 || !current.some((line) => line.type !== "context")) {
      current = [];
      return;
    }
    const header = `@@ -${firstOld ?? 0},${lastOld !== undefined ? lastOld - firstOld! + 1 : 0} +${firstOld ?? 0} @@`;
    hunks.push({
      header,
      lines: current.length > maxLinesPerHunk ? [...current.slice(0, maxLinesPerHunk), { type: "context", text: "… diff truncated …" }] : current,
    });
    current = [];
  };

  let contextBudget = 0;
  for (const line of lines) {
    if (line.type === "context") {
      if (current.length === 0) {
        // Leading context before the first change in a hunk.
        if (contextBudget < CONTEXT_LINES) {
          contextBudget += 1;
          current.push(line);
          firstOld ??= line.oldLine;
          lastOld = line.oldLine;
        } else {
          flush();
          firstOld = undefined;
          lastOld = undefined;
        }
      } else {
        // Trailing context: close the hunk after enough quiet lines.
        if (contextBudget >= CONTEXT_LINES) {
          flush();
          firstOld = undefined;
          lastOld = undefined;
          continue;
        }
        contextBudget += 1;
        current.push(line);
        lastOld = line.oldLine;
      }
    } else {
      if (current.length === 0) {
        firstOld = line.oldLine;
        contextBudget = 0;
      }
      current.push(line);
      if (line.type === "del" && line.oldLine !== undefined) {
        lastOld = line.oldLine;
      }
      contextBudget = 0;
    }
    if (hunks.length >= maxHunks) {
      flush();
      break;
    }
  }
  flush();
  return hunks;
}

export function diffStats(hunks: readonly DiffHunk[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") {
        additions += 1;
      } else if (line.type === "del") {
        deletions += 1;
      }
    }
  }
  return { additions, deletions };
}

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.split(/\r\n|\r|\n/);
  // A trailing newline terminates the last line; it does not start a new one.
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}
