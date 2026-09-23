import { GameState } from "../shared/protocol";

const BASE = "https://spire-codex.com";
export class CodexContextService {
  private cache = new Map<string, { expires: number; value: unknown }>();
  async buildPrompt(question: string, state: GameState): Promise<string> {
    const relicIds = new Set([...state.player.relics, ...state.screen.offers.filter(offer => offer.isRelic).map(offer => offer.id)]);
    const ids = [...state.player.deck.map(card => card.id), ...state.player.relics, ...state.screen.offers.map(offer => offer.id)].slice(0, 18);
    const details = await Promise.all(ids.map(id => this.entity(id, relicIds.has(id))));
    const search = await this.search(question);
    const offers = state.screen.offers.map(offer => `${offer.id}${offer.displayName ? `(${offer.displayName})` : ""}${offer.isCursed ? "【呪い】" : ""}`);
    return [
      "あなたはSlay the Spire 2のニュートラルな分析アシスタントです。",
      "日本語で、結論を先に短く答え、カード名・レリック名を根拠として示してください。",
      "ゲームを操作したり、勝利を保証したりせず、選択肢とトレードオフを説明してください。",
      `キャラクター: ${state.player.character}`,
      `デッキ: ${state.player.deck.map(card => `${card.id}${card.upgraded ? "+" : ""}`).join(", ") || "なし"}`,
      `レリック: ${state.player.relics.join(", ") || "なし"}`,
      `現在の画面: ${state.screen.kind}`,
      `提示中: ${offers.join(", ") || "なし"}`,
      `Spire Codexの関連データ: ${JSON.stringify(details)}`,
      `Spire Codex検索結果: ${JSON.stringify(search)}`,
      `ユーザーの質問: ${question}`,
    ].join("\n");
  }
  private async entity(id: string, isRelic: boolean): Promise<unknown> {
    const type = isRelic ? "relics" : "cards"; const slug = id.toLowerCase();
    return this.fetchCached(`${type}:${slug}`, `${BASE}/api/${type}/${encodeURIComponent(slug)}?lang=jpn`);
  }
  private async search(question: string): Promise<unknown> {
    if (!/[カードレリック効果説明検索おすすめ]|card|relic|effect|search/i.test(question)) return null;
    return this.fetchCached(`search:${question}`, `${BASE}/api/search?q=${encodeURIComponent(question.slice(0, 120))}&lang=jpn`);
  }
  private async fetchCached(key: string, url: string): Promise<unknown> {
    const cached = this.cache.get(key); if (cached && cached.expires > Date.now()) return cached.value;
    try { const response = await fetch(url, { headers: { "User-Agent": "sts2-draft-advisor-overlay/0.1" } }); if (!response.ok) return { unavailable: true, status: response.status }; const value = await response.json(); this.cache.set(key, { value, expires: Date.now() + 5 * 60 * 1000 }); return value; }
    catch (error) { return { unavailable: true, error: String(error) }; }
  }
}
