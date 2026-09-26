# Architectural Decisions

## ADR-001 — Use Cursor SDK

Date: 2026-09-22
Status: accepted
Decision: Use `@cursor/sdk` as the agent runtime.
Reason: Cursor officially documents the TypeScript SDK and local agent runtime. This avoids reverse-engineering private APIs.
Alternatives: Reverse-engineer Cursor protocols; build a custom agent loop.
Consequences: The extension depends on Cursor's SDK/API contract. SDK versions must be tested before upgrades.

## ADR-002 — Bring Your Own API Key

Date: 2026-09-22
Status: accepted
Decision: The user supplies their Cursor API key through VS Code `SecretStorage`.
Reason: The API key belongs to the user and must never leave their machine or be sent to our backend.
Alternatives: Proxy requests through a server; bundle a shared key.
Consequences: Each user must authenticate separately. Key rotation is managed in the Cursor dashboard.

## ADR-003 — Local Agents Only in v1

Date: 2026-09-22
Status: accepted
Decision: Support Cursor local agents only.
Reason: Local agents run in the user process, keep files on disk, and simplify security and debugging.
Alternatives: Cloud agents; both local and cloud from day one.
Consequences: Multi-machine workflows and cloud persistence are deferred.

## ADR-004 — Violet/Purple Design System

Date: 2026-09-22
Status: accepted
Decision: Use neutral surfaces with violet/purple accent `#7C3AED`.
Reason: A single primary accent reduces visual noise and keeps the UI focused on agent activity.
Alternatives: Multi-color themes; Cursor UI clones.
Consequences: Semantic status colors remain subtle and accessible.

## ADR-005 — esbuild Bundling

Date: 2026-09-22
Status: accepted
Decision: Bundle the extension host with esbuild and keep `vscode` external.
Reason: esbuild is fast, supports CJS output, and aligns with VS Code bundling guidance.
Alternatives: webpack; no bundling.
Consequences: Native SDK binaries must be packaged alongside the bundle.

## ADR-006 — Strict TypeScript

Date: 2026-09-22
Status: accepted
Decision: Enable strict TypeScript and reject `any`.
Reason: Strict typing catches integration errors with the Cursor SDK and VS Code API early.
Alternatives: Moderate strictness; allow `any` for rapid prototyping.
Consequences: More type annotations are required, but runtime errors are reduced.

## ADR-007 — Workspace-Scoped Session Persistence

Date: 2026-09-22
Status: accepted
Decision: Persist agent sessions and the active session selection in VS Code `workspaceState`.
Reason: Sessions are tied to a workspace path and should not leak session history across unrelated projects.
Alternatives: Use `globalState`; store sessions only in memory.
Consequences: Session history is available after extension restarts within the same workspace, while interrupted runs are restored as `DISCONNECTED` rather than resumed.
