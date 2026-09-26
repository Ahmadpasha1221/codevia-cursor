# Security

## API key storage

* Cursor API keys are stored in VS Code `SecretStorage`.
* The extension never logs API keys, authorization headers, or secrets.
* API keys are never stored in `settings.json`, workspace files, logs, telemetry, Git, React state persisted to disk, `localStorage`, or webview HTML.

## Webview security

* Webviews use a strict Content Security Policy with nonce-based scripts.
* Local resources are loaded through `webview.asWebviewUri` with restricted `localResourceRoots`.
* Every message from the webview is validated against typed schemas before processing.
* The webview cannot execute shell commands or privileged operations directly.

## Workspace trust

* The extension respects VS Code workspace trust.
* Destructive operations are blocked in untrusted workspaces.
* Users receive clear explanations when functionality is restricted.

## Command execution risks

* Shell commands requested by the agent require explicit user approval.
* Destructive commands require stronger confirmation.
* Commands are executed through platform-aware process handling.
* No arbitrary shell execution is performed without permission.

## MCP risks

* MCP servers are treated as external services.
* MCP tool results are displayed as untrusted data.
* MCP configuration is documented and user-controlled.

## Prompt injection

* Repositories are treated as potentially hostile input.
* Agent prompts include workspace context but do not blindly trust repository instructions.
* Sensitive files such as `.env` are excluded from context gathering by default.

## Cancellation and sandboxing

* Long-running agent runs support cancellation through `Run.cancel`.
* Local agent sandboxing follows Cursor SDK capabilities and documented limitations.
