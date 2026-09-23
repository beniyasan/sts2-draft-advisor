import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });

// Main process + preload: Node CJS bundles (electron stays external).
// Services are also emitted individually so the smoke test can import them.
await build({
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  entryPoints: ["src/main.ts", "src/preload.ts", "src/services/codexContext.ts", "src/services/codexAppServer.ts", "src/shared/protocol.ts"],
  outdir: "dist",
});

// Renderer: single self-contained browser bundle — the page has no `require`.
await build({
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome126",
  entryPoints: ["src/renderer/renderer.ts"],
  outfile: "dist/renderer/renderer.js",
});

await mkdir("dist/renderer", { recursive: true });
await cp("src/renderer/index.html", "dist/renderer/index.html");
await cp("src/renderer/renderer.css", "dist/renderer/renderer.css");
