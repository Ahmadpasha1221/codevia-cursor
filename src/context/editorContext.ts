import type * as vscode from "vscode";
import {
  createContextPosition,
  createContextRange,
  EditorContext,
  isSensitiveFilePath,
  redactSensitiveText,
  truncateText,
} from "./contextTypes";

export interface EditorContextOptions {
  readonly maxSelectedTextLength?: number;
  readonly includeSelectedText?: boolean;
}

export function collectEditorContext(
  editor: vscode.TextEditor | undefined,
  options: EditorContextOptions = {},
): EditorContext | undefined {
  if (!editor) {
    return undefined;
  }

  const document = editor.document;
  const filePath = document.uri.fsPath || document.uri.toString();
  const selection = editor.selection;
  const includeSelectedText = options.includeSelectedText ?? true;
  const selectedText = !selection.isEmpty && includeSelectedText && !isSensitiveFilePath(filePath)
    ? truncateText(
      redactSensitiveText(document.getText(selection)),
      options.maxSelectedTextLength ?? 4000,
    )
    : undefined;

  return {
    filePath,
    languageId: document.languageId,
    cursorPosition: createContextPosition(selection.active.line, selection.active.character),
    selection: createContextRange(selection.start, selection.end),
    selectedText,
  };
}
