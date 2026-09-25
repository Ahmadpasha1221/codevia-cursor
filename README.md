# Codevia Cursor

Codevia Cursor is an independent VS Code extension that provides an AI coding-agent experience inside VS Code. It can run against:

* Cursor local agents through the official TypeScript SDK (`@cursor/sdk`)
* Local models already installed on your machine through [Ollama](https://ollama.com)
* OpenAI-compatible local servers such as LM Studio

This extension is not affiliated with Cursor. Cursor is a trademark of Cursor, Inc.

## Features

* Chat with Ollama models from the Codevia sidebar (for example `qwen2.5:0.5b-instruct`)
* Optional Cursor agent integration through `@cursor/sdk`
* Secure Cursor API key storage with VS Code `SecretStorage`
* Mock runtime for UI testing without a network model
* Typed webview messaging and strict CSP
* Session and task management
* Chat transcripts persist across restarts — history is restored from local storage without re-sending it to the model, so restoring costs zero tokens
* Permission handling for destructive operations

## Requirements

* VS Code 1.95.0 or later
* Node.js 22.13 or later

For **local models**:

* [Ollama](https://ollama.com) installed and running
* At least one pulled model, for example `ollama pull qwen2.5:0.5b-instruct`

For **Cursor**:

* A Cursor user API key from https://cursor.com/dashboard/api
* A Cursor plan that includes the Cursor SDK

## Installation

1. Install the extension from a VSIX or the marketplace.
2. Open the Command Palette and run `Codevia Cursor: Open Agent`.
3. Open **Settings** in the Codevia sidebar.
4. Choose a provider:
   * **Local AI** → Ollama. Codevia lists models from `http://127.0.0.1:11434` and chats with the selected model.
   * **Cursor** → paste your API key, then Save and connect.
   * **Mock / Test** → exercise the UI without a model.

## Local Ollama

1. Start Ollama (`ollama serve` if it is not already running).
2. Pull a model: `ollama pull qwen2.5:0.5b-instruct`.
3. In Codevia Settings, set **AI provider** to **Local AI** and **Local provider** to **Ollama**.
4. Click **Refresh models**, select a model, then **Use this model**.
5. Return to chat and send a prompt.

Codevia talks to the local Ollama HTTP API only. It does not upload those prompts to Cursor.

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

Cursor API keys are stored only in VS Code `SecretStorage`. They are never logged, committed, or sent to any server except Cursor when you choose the Cursor provider. See `docs/SECURITY.md` for details.

## Troubleshooting

* **Ollama not connected**: confirm `ollama list` works and `http://127.0.0.1:11434/api/tags` responds.
* **No models detected**: pull a model, then click Refresh models.
* Cursor SDK errors: see `docs/TROUBLESHOOTING.md`.

## License

MIT
