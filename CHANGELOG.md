# Changelog

## [Unreleased]

### Changed

* Agent/tool selection now follows the Continue/Roo production pattern end to end: the model receives tool schemas generated from the Tool Registry and selects every tool itself. No keyword or intent routing exists anywhere in the codebase.
* The Tool Registry is the single source of truth: tool names, descriptions, argument schemas, example arguments, permission groups, native provider schemas, and the system-prompt fallback contract are all generated from it (previously duplicated in `localToolDefinitions.ts`).
* Introduced the current available-tool set (`toolAvailability.ts`): agent mode exposes all registered tools; ask and plan modes are restricted to read/search tools. The loop hides unavailable tools from the model, recovers out-of-set selections with structured feedback, and the router refuses to execute them. No modes are surfaced in the UI yet — the architecture is ready for them.
* Unknown-tool errors returned to the model now list the current available-tool set so it can retry (e.g. `Unknown tool: create_file` → full tool list), and are never shown to the user as chat text.
* The agent system prompt now explicitly forbids answering workspace-change requests with chat-only code: file creation/modification must go through `write_file`/`edit_file` tool calls.

### Added

* New unit tests: mode-based tool availability, ask-mode enforcement (loop filter + router refusal), and the calculator scenario end-to-end (write_file → index.html/styles.css/app.py on disk → finish, no code dump as final response).

* Persistent chat transcripts: conversations are stored as append-only JSONL files in extension global storage and restored when a session is reopened, even after a VS Code restart. Restoring history never re-sends it to the model, so it costs zero tokens.
* `GET_TRANSCRIPT` / `TRANSCRIPT` webview messages for on-demand transcript loading.

* Project skeleton using VS Code Extension API and TypeScript.
* Build system with esbuild, ESLint, Prettier, and Vitest.
* Extension activation and command registration.
* Documentation for architecture, security, development, release, troubleshooting, API, and UX.
* Official Cursor icon as extension icon.

## [0.1.0] - 2026-09-22

### Added

* Initial release scaffolding.
