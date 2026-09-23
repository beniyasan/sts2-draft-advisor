import { build } from "esbuild";

// Exercise TypeScript source directly without adding test-only production bundles.
export async function loadSource(files, plugins = []) {
  const result = await build({
    stdin: {
      contents: files.map(file => `export * from ${JSON.stringify(file)};`).join("\n"),
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
