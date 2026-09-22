# Codevia Cursor

Codevia Cursor is an independent VS Code extension that provides an AI coding-agent experience inside VS Code using the official Cursor TypeScript SDK (`@cursor/sdk`).

This extension is not affiliated with Cursor. Cursor is a trademark of Cursor, Inc. The extension uses Cursor's documented public SDK and the user's own API key.

## Features

* Local Cursor agent integration through `@cursor/sdk`
* Secure API key storage with VS Code `SecretStorage`
* Typed webview messaging and strict CSP
* Session and task management
* Workspace context gathering
* Permission handling for destructive operations
* Structured logging and cancellation

## Requirements

* VS Code 1.95.0 or later
* Node.js 22.13 or later
* A Cursor user API key from https://cursor.com/dashboard/api

## Installation

1. Install the extension from the VS Code Marketplace or from a VSIX.
2. Open the Command Palette and run `Codevia Cursor: Open Agent`.
3. Provide your Cursor API key when prompted.

## Development setup

```bash
pnpm install
pnpm run compile
pnpm run test
```

## Testing

* Unit tests: `pnpm run test`
* Integration tests: `pnpm run test:integration`

## Security

API keys are stored only in VS Code `SecretStorage`. They are never logged, committed, or sent to any server. See `docs/SECURITY.md` for details.

## Troubleshooting

See `docs/TROUBLESHOOTING.md`.

## License

MIT
