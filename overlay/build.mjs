import { cp, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
await rm("dist", { recursive: true, force: true });
await run(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "-p", "tsconfig.json"]);
await mkdir("dist/renderer", { recursive: true });
await cp("src/renderer/index.html", "dist/renderer/index.html");
await cp("src/renderer/renderer.css", "dist/renderer/renderer.css");
