# Architecture

## System overview

Codevia Cursor is a VS Code extension that provides an AI coding-agent experience using the official Cursor TypeScript SDK (`@cursor/sdk`). The extension host runs the agent orchestration; the webview renders a read-only presentation of agent state and user input.

```
VS Code UI
   ↓
Webview (inline HTML/CSS/JS)
   ↓ typed messages
MessageRouter
   ↓
Extension Host
   ↓
AgentManager
   ↓
SessionStore
   ↓
VS Code workspace state
   ↓
Cursor SDK Adapter
   ↓
@cursor/sdk
   ↓
Cursor Local Agent
   ↓
User workspace
```

## Extension Host architecture

- `extension.ts` activates the extension and registers commands, the authentication provider, and the webview view provider.
- `AgentManager` owns agent lifecycle, sessions, task start/cancel, event publishing, and session persistence coordination.
- `SessionStore` serializes sessions and active-session selection into VS Code `workspaceState` (`Memento`).
- `CursorClient` wraps `@cursor/sdk` (`Agent.create`, `Agent.resume`, `agent.send`, `run.stream`, `run.cancel`, `run.wait`, `Agent.list`).
- `AgentViewProvider` renders the webview; `MessageRouter` validates and routes typed messages to `AgentManager`.
- `SecretStorage` wraps VS Code `SecretStorage` for API keys.
- `Logger` writes structured logs without secrets.

## Authentication

- `CursorAuthProvider` implements `vscode.AuthenticationProvider` and is registered in `extension.ts`.
- `CursorAuthError` carries an `exitCode` for authentication failures.
- `SecretStorage` abstracts `vscode.SecretStorage`; `VSCodeSecretStorageAdapter` is the production implementation.
- API keys are stored only in VS Code `SecretStorage` and never logged or exposed to the webview.

## Webview architecture

- The webview is created by `AgentViewProvider` and contributes `codeviaCursor.agent`.
- `AgentViewProvider` subscribes to `AgentManager.onDidPublishEvent` and forwards events to the webview as typed `ExtensionMessage`s.
- `MessageRouter` validates incoming `WebviewMessage`s from the webview and routes to `AgentManager`.
- `MessageRouter.toExtensionMessage` converts all `AgentEvent` types to `ExtensionMessage`s for webview rendering.
- The webview renders a structured UI: status bar, scrollable message area (with styling for thinking, error, and tool events), and input with Send/Cancel controls.
- Scripts are loaded from bundled files using a nonce-based CSP.
- The webview never executes privileged operations directly.

## Session management and persistence

- Sessions are stored in VS Code `workspaceState`, scoped to the current workspace, rather than in global extension state.
- `SessionStore` converts `AgentSession` objects to JSON-safe records, including ISO timestamps, and validates records before restoring them.
- `AgentManager.restoreSessions()` repopulates the in-memory session map on activation. Non-terminal sessions (`IDLE`, `STARTING`, `READY`, `RUNNING`, `CANCELLING`) become `DISCONNECTED`; terminal sessions retain their status.
- The most recently selected valid session is restored as the active session. `createSession`, `selectSession`, `deleteSession`, and state updates enqueue persisted writes.
- The webview exposes session listing, selection, and creation through `LIST_SESSIONS`, `SELECT_SESSION`, and `NEW_SESSION` messages.

## Agent lifecycle

```
IDLE → STARTING → READY → RUNNING → COMPLETED
                     ↘ CANCELLED
                     ↘ FAILED
                     ↘ DISCONNECTED (after extension restart)
```

## Cursor SDK integration

The extension uses `Agent.create`, `Agent.resume`, `agent.send`, `run.stream`, `run.cancel`, `run.wait`, and `Agent.list` from `@cursor/sdk`. No Cursor private APIs are used. API keys are supplied by the user and stored in VS Code `SecretStorage`.

`@cursor/sdk` is marked as external in `esbuild.js` because it depends on `bun:sqlite` and internal modules that esbuild cannot bundle.

## Persistence

- Session records and active-session selection are stored in VS Code `workspaceState`; API keys and authentication tokens remain in `SecretStorage`.
- Session persistence is JSON-safe and validates stored records before restoration.
- API keys are never persisted outside secret storage.
