import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource } from "./load-source.mjs";

const { CodexContextService } = await loadSource(["./src/services/codexContext.ts"]);

test("context resolves a game ID alias through the localized collection search", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(String(url));
    if (url.includes("/api/cards/card_blood_letting?"))
      return new Response("not found", { status: 404 });
    if (url.includes("/api/cards?search="))
      return Response.json([{ id: "bloodletting", name: "瀉血" }]);
    if (url.includes("/api/cards/bloodletting?"))
      return Response.json({ id: "BLOODLETTING", name: "瀉血", description: "Gain energy." });
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    const service = new CodexContextService();
    const prompt = await service.buildPrompt("瀉血を取るべき？", {
      type: "game_state", version: 1, runId: "run", timestamp: 0,
      screen: { kind: "Reward", offers: [{ id: "CARD_BLOOD_LETTING", displayName: "瀉血", isRelic: false, isCursed: false }] },
      player: { character: "ironclad", deck: [], relics: [] },
    });
    assert.match(prompt, /BLOODLETTING/);
    assert.equal(requests.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
