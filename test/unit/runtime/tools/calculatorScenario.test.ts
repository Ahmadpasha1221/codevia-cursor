import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runInferenceAgentLoop, type ChatCompletion, type CompleteChat } from "../../../../src/runtime/tools/inferenceAgentLoop";
import { ToolRouter } from "../../../../src/runtime/tools/toolRouter";
import { WorkspaceToolExecutor } from "../../../../src/runtime/tools/workspaceToolExecutor";
import { buildAgentSystemPrompt } from "../../../../src/runtime/tools/localToolDefinitions";
import type { CodeviaSession, RuntimeEvent, RuntimeSendRequest } from "../../../../src/runtime/runtimeTypes";

describe("calculator scenario (architecture item 11)", () => {
  it("writes index.html, styles.css, app.py to disk, then finishes — no code dump", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codevia-calc-"));
    const session: CodeviaSession = {
      sessionId: "s1",
      provider: "ollama",
      workspacePath: root,
      status: "READY",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Scripted "model": three write_file selections, then finish. The model
    // chooses every tool; the test only scripts the model side.
    const completions: ChatCompletion[] = [
      { content: "", nativeToolCalls: [{ id: "1", name: "write_file", input: { path: "index.html", content: "<h1>Calculator</h1>" } }] },
      { content: "", nativeToolCalls: [{ id: "2", name: "write_file", input: { path: "styles.css", content: "body { font-family: sans-serif; }" } }] },
      { content: "", nativeToolCalls: [{ id: "3", name: "write_file", input: { path: "app.py", content: "def add(a, b):\n    return a + b\n" } }] },
      { content: "", nativeToolCalls: [{ id: "4", name: "finish", input: { summary: "Calculator created successfully." } }] },
    ];
    let completionIndex = 0;
    const completeChat: CompleteChat = async (messages) => {
      // The system prompt must carry the workspace-action guidance (item 5).
      expect(messages[0]?.role).toBe("system");
      expect(messages[0]?.content).toContain("use the appropriate registered tool");
      expect(messages[0]?.content).toContain("actually call write_file");
      // Tool results must return to the model (item 6): each call after the
      // first sees the previous structured result in history.
      const toolTurns = messages.filter((turn) => turn.role === "tool");
      expect(toolTurns).toHaveLength(completionIndex);
      return completions[completionIndex++];
    };

    const executor = new WorkspaceToolExecutor();
    const router = new ToolRouter(executor);
    const events: RuntimeEvent[] = [];

    const request: RuntimeSendRequest = {
      sessionId: "s1",
      workspacePath: root,
      prompt: "Create HTML, CSS and Python files for a calculator app where the user can enter numbers and calculate.",
      // Permission checks live in RuntimeManager (covered by its own tests);
      // here we exercise registry validation → execution → structured result.
      onToolCall: (call) => router.route(call, { session }, async () => ({ allowed: true })),
    };

    await runInferenceAgentLoop(request, [], completeChat, async (event) => {
      events.push(event);
    }, { nativeTools: true });

    // The files physically exist in the workspace.
    expect(await fs.readFile(path.join(root, "index.html"), "utf8")).toContain("Calculator");
    expect(await fs.readFile(path.join(root, "styles.css"), "utf8")).toContain("font-family");
    expect(await fs.readFile(path.join(root, "app.py"), "utf8")).toContain("def add");

    // Loop lifecycle: three tool calls, three results, then finish stops it.
    const toolCalls = events.filter((event) => event.type === "tool_call");
    expect(toolCalls.map((event) => (event.type === "tool_call" ? event.toolCall.name : ""))).toEqual(["write_file", "write_file", "write_file", "finish"]);
    expect(events.filter((event) => event.type === "tool_result")).toHaveLength(4);

    // Final response is the finish summary, never a code dump: assistant
    // text carries the summary only (tool arguments live in protocol events,
    // which the UI renders as progress lines, not chat text).
    const assistant = events.filter((event) => event.type === "assistant_message").map((event) => (event.type === "assistant_message" ? event.message : ""));
    expect(assistant).toEqual(["Calculator created successfully."]);
    expect(assistant.join("\n")).not.toContain("def add");
    expect(assistant.join("\n")).not.toContain("<h1>");

    // Cleanup.
    await fs.rm(root, { recursive: true, force: true });
  });

  it("system prompt forbids chat-only code responses for workspace changes", () => {
    const prompt = buildAgentSystemPrompt("qwen2.5:0.5b-instruct");
    expect(prompt).toContain("Do not merely provide code in chat when the user has requested a workspace change");
    expect(prompt).toContain("actually call write_file");
    expect(prompt).toContain("actually call edit_file");
  });
});
