# Spider

<p align="center">
  <img src="assets/icon.png" alt="Spider" width="120">
</p>

<h3 align="center">An AI coding agent for VS Code</h3>

<p align="center">
  Build, edit, explore, and work with your codebase directly from VS Code.
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#providers">Providers</a> ·
  <a href="#how-spider-works">How it works</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#development">Development</a>
</p>

---

## What is Spider?

Spider is an independent AI coding-agent extension for VS Code.

It brings an agent-style development workflow directly into your editor. Instead of only generating code in a chat window, Spider can understand your workspace, inspect files, search your codebase, make changes, run commands, and continue working based on the results.

Spider is designed around a provider-independent runtime, so you can choose how the AI is powered:

- Local models through **Ollama**
- OpenAI-compatible local servers such as **LM Studio**
- Cloud models through **OpenRouter**
- Cursor agents through the official `@cursor/sdk`
- Mock runtime for UI and development testing

Spider is independent and is not affiliated with Cursor. Cursor is a trademark of Cursor, Inc.

---

## Features

### AI Coding Agent

Spider can work with your actual workspace instead of only returning code in chat.

The agent can:

- Explore your project
- List files and directories
- Read files
- Search across the codebase
- Create directories
- Create and write files
- Edit existing files
- Move files
- Delete files
- Run terminal commands
- Continue working after receiving tool results
- Finish tasks with a clear completion response

The agent decides when a tool is required and the runtime handles the execution and result flow.

---

### Tool Calling

Spider has a centralized tool system rather than letting individual providers implement their own tool execution.

The tool pipeline is:

```text
User
  ↓
Spider Agent
  ↓
Model
  ↓
Tool Call
  ↓
Tool Router
  ↓
Permission / Validation
  ↓
Tool Executor
  ↓
Workspace / Terminal
  ↓
Tool Result
  ↓
Agent
  ↓
Model