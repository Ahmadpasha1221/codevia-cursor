const { defineConfig } = require("@vscode/test-cli");

module.exports = defineConfig({
  files: "out/test/integration/**/*.test.js",
  version: "stable",
  workspaceFolder: "./test/fixtures",
  launchArgs: ["--disable-extensions"],
});
