const esbuild = require("esbuild");

const isWatch = process.argv.includes("--watch");

async function run() {
  if (isWatch) {
    const ctx = await esbuild.context({
      entryPoints: ["src/extension.ts"],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      outfile: "dist/extension.js",
      external: ["vscode", "@cursor/sdk", "bun:sqlite"],
      sourcemap: true,
      logLevel: "info",
    });
    await ctx.watch();
    console.log("Watching extension...");
    return;
  }

  const result = await esbuild.build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: "dist/extension.js",
      external: ["vscode", "@cursor/sdk", "bun:sqlite"],
    sourcemap: true,
    metafile: true,
    logLevel: "info",
  });

  if (result.metafile) {
    console.log(JSON.stringify(result.metafile, null, 2));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
