# Development Resources

## Official documentation

* Cursor TypeScript SDK: https://cursor.com/docs/sdk/typescript
* VS Code Extension API: https://code.visualstudio.com/api
* VS Code Webviews: https://code.visualstudio.com/api/extension-guides/webview
* VS Code SecretStorage: https://code.visualstudio.com/api/references/vscode-api#SecretStorage
* VS Code Testing Extensions: https://code.visualstudio.com/api/working-with-extensions/testing-extension
* VS Code Bundling Extensions: https://code.visualstudio.com/api/working-with-extensions/bundling-extension
* VS Code Publishing Extensions: https://code.visualstudio.com/api/working-with-extensions/publishing-extension

## YouTube research

| Title | Channel | URL | What was learned | Architecture adopted | Intentionally not copied |
|-------|---------|-----|------------------|----------------------|--------------------------|
| AI in VSCode: Walkthrough of GitHub Copilot, Cline & Roo Code | Christine Payton | https://youtube.com/watch?v=-k-HQV3wbi4 | Agent webview and controller patterns | Webview provider -> controller -> task layers | Proprietary agent logic |
| Your Ultimate AI Coding Agent: Roo Code + VS Code | Datacrypt | https://youtube.com/watch?v=hRxjMTyB-GA | Roo Code command palette and sidebar | Sidebar session list and composer | Roo Code-specific UI details |
| 5 Must-Know Roo Code Features | AI-Driven Coder | https://youtube.com/watch?v=rg_g3BPv4uQ | Streaming output and permission handling | Permission request UI | Roo Code implementation details |
| The Ultimate Agent Mode Tutorial in VS Code | Visual Studio Code | https://youtube.com/watch?v=5NxGqnTazR8 | VS Code agent mode concepts | Typed message architecture | Microsoft UI specifics |
| Kilo Code VS Code Extension – Full Tutorial | Code With Yousaf | https://youtube.com/watch?v=sjvbvfUxfYE | Extension packaging and setup | Project structure | Tutorial-specific shortcuts |

## Architecture references

* Cline overview: https://github.com/cline/cline/blob/main/.clinerules/cline-overview.md
* Continue architecture map: https://ggprompts.com/architecture/continue/index.html
* Harness engineering paper: https://arxiv.org/abs/2609.00006
* Agent Skills specification: https://agentskills.io/specification
