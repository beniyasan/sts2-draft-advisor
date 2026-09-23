import { GameState } from "../shared/protocol";

const BASE = "https://spire-codex.com";
export class CodexContextService {
  private cache = new Map<string, { expires: number; value: unknown }>();
  async buildPrompt(question: string, state: GameState): Promise<string> {
    const relicIds = new Set([...state.player.relics, ...state.screen.offers.filter(offer => offer.isRelic).map(offer => offer.id)]);
    const offerNames = new Map(state.screen.offers.map(offer => [this.canonicalId(offer.id), offer.displayName]));
    // Keep the current choices first. A normal deck can exceed the context cap;
    // dropping an offered card while retaining only the first deck entries made
    // the assistant report "no data" for the card the player was asking about.
    const refs: Array<{ id: string; displayName?: string }> = [...state.screen.offers.map(offer => ({ id: offer.id, displayName: offer.displayName })),
      ...state.player.deck.map(card => ({ id: card.id })),
      ...state.player.relics.map(id => ({ id }))]
      .filter((ref, index, all) => all.findIndex(other => this.canonicalId(other.id) === this.canonicalId(ref.id)) === index)
      .slice(0, 18);
    const details = await Promise.all(refs.map(ref => this.entity(
      ref.id, relicIds.has(ref.id), ref.displayName || offerNames.get(this.canonicalId(ref.id))
    )));
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
  private async entity(id: string, isRelic: boolean, displayName = ""): Promise<unknown> {
    const type = isRelic ? "relics" : "cards";
    const slug = id.trim().toLowerCase();
    const direct = await this.fetchCached(`${type}:${slug}`, `${BASE}/api/${type}/${encodeURIComponent(slug)}?lang=jpn`);
    if (!this.isUnavailable(direct)) return direct;

    // Game model IDs are not guaranteed to use the same spelling as Codex IDs
    // (for example a prefix or an underscore can be present). Offers also carry
    // a localized title, so use the documented collection search as a fallback.
    if (displayName && (direct as any)?.status === 404) {
      const found = await this.lookup(type, displayName);
      const resolvedId = this.resultId(found, displayName);
      if (resolvedId) {
        const resolved = await this.fetchCached(
          `${type}:${resolvedId.toLowerCase()}`,
          `${BASE}/api/${type}/${encodeURIComponent(resolvedId.toLowerCase())}?lang=jpn`,
        );
        if (!this.isUnavailable(resolved)) return resolved;
      }
    }
    return { unavailable: true, requestedId: id, displayName, status: (direct as any)?.status };
  }
  private async lookup(type: string, displayName: string): Promise<unknown> {
    const url = `${BASE}/api/${type}?search=${encodeURIComponent(displayName.slice(0, 120))}&lang=jpn`;
    return this.fetchCached(`lookup:${type}:${displayName}`, url);
  }
  private resultId(value: unknown, displayName: string): string | null {
    const rows = Array.isArray(value) ? value : (value as any)?.results ?? (value as any)?.items ?? (value as any)?.data ?? [];
    if (!Array.isArray(rows)) return null;
    const exact = rows.find((item: any) => item && typeof item.id === "string" &&
      [item.name, item.title, item.display_name].some((name: unknown) => name === displayName));
    const row = exact ?? rows.find((item: any) => item && typeof item.id === "string");
    return row?.id ?? null;
  }
  private isUnavailable(value: unknown): boolean {
    return !!value && typeof value === "object" && (value as any).unavailable === true;
  }
  private canonicalId(id: string): string {
    const value = id.split(":").pop()?.replace(/^CARD_|^RELIC_/i, "") ?? id;
    return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
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
