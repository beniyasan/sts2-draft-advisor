// Downloads the official zundamon Live2D sample model + Cubism Core for Web.
// Model/runtime files are licensed material and stay out of git (assets/ and
// vendor/ are gitignored).
//
//   node scripts/fetch-model.mjs          # prompts for license agreement
//   node scripts/fetch-model.mjs --agree  # non-interactive
//
// Before using the model, read and agree to:
//   - 無償提供マテリアルの使用許諾契約書
//     https://www.live2d.com/eula/live2d-free-material-license-agreement_ja.html
//   - Live2D Cubism サンプルデータ利用条件
//     https://www.live2d.com/learn/sample/model-terms/
//   - 東北ずん子・ずんだもんプロジェクト「キャラクター利用の手引き」
//     https://zunko.jp/con_illust.html

import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { cp, mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_URL = process.env.ZUNDAMON_ZIP_URL ?? "https://cubism.live2d.com/sample-data/bin/zundamon/zundamon_ja.zip";
const CORE_URL = process.env.CUBISM_CORE_URL ?? "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";
const assetsDir = join(root, "assets", "live2d");
const modelDir = join(assetsDir, "zundamon");
const vendorDir = join(root, "vendor");

async function agreed() {
  if (process.argv.includes("--agree")) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("上記の利用条件に同意しますか？ [y/N] ");
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function download(url, dest) {
  const response = await fetch(url, { headers: { "User-Agent": "sts2-draft-advisor-overlay/0.1" } });
  if (!response.ok) throw new Error(`download failed: ${url} -> ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(dest, bytes);
  return bytes.length;
}

if (!(await agreed())) {
  console.log("キャンセルしました。同意する場合は --agree を付けて再実行してください。");
  process.exit(1);
}

const work = await mkdtemp(join(tmpdir(), "zundamon-"));
try {
  await mkdir(modelDir, { recursive: true });
  await mkdir(vendorDir, { recursive: true });

  const zipPath = join(work, "zundamon.zip");
  console.log(`Downloading model: ${MODEL_URL}`);
  console.log(`  ${await download(MODEL_URL, zipPath)} bytes`);

  // Windows ships bsdtar (zip-capable) as tar.exe; unix uses unzip.
  if (process.platform === "win32") execFileSync("tar", ["-xf", zipPath, "-C", work]);
  else execFileSync("unzip", ["-q", "-o", zipPath, "-d", work]);
  await cp(join(work, "runtime"), modelDir, { recursive: true });
  try { await cp(join(work, "ReadMe.txt"), join(modelDir, "ReadMe.txt")); } catch { }

  const modelFile = (await readdir(modelDir)).find(f => f.endsWith(".model3.json"));
  if (!modelFile) throw new Error("*.model3.json not found in the downloaded archive");

  console.log(`Downloading Cubism Core: ${CORE_URL}`);
  const coreBytes = await download(CORE_URL, join(vendorDir, "live2dcubismcore.min.js"));
  console.log(`  ${coreBytes} bytes`);

  await writeFile(join(assetsDir, "manifest.json"),
    JSON.stringify({ model: `zundamon/${modelFile}` }, null, 2) + "\n");
  console.log(`Done. Model: zundamon/${modelFile}`);
  console.log("Live2D サンプルデータの利用条件に従って使用してください。");
} finally {
  await rm(work, { recursive: true, force: true });
}
