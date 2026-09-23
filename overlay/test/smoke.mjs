import assert from "node:assert/strict";

globalThis.fetch = async url => ({
  ok: true,
  async json() { return { id: String(url), name: "テストカード", description: "テスト説明" }; },
});

const { CodexContextService } = await import("../dist/services/codexContext.js");
const service = new CodexContextService();
const prompt = await service.buildPrompt("Bashの効果と、このカードを取るべきか検索して", {
  type: "game_state", version: 1, runId: "test", timestamp: 0,
  screen: { kind: "card_reward", offers: [{ id: "BASH", displayName: "Bash", isRelic: false, isCursed: false }] },
  player: { character: "ironclad", deck: [{ id: "STRIKE", upgraded: false }], relics: [] },
});
assert.match(prompt, /キャラクター: ironclad/);
assert.match(prompt, /BASH/);
assert.match(prompt, /Spire Codex検索結果/);
assert.match(prompt, /ユーザーの質問/);
console.log("overlay smoke tests passed");
