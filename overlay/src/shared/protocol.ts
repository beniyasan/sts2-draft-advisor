export interface CardState { id: string; upgraded: boolean; }
export interface OfferState { id: string; displayName: string; isRelic: boolean; isCursed: boolean; }
export interface GameState {
  type: "game_state"; version: number; runId: string; timestamp: number;
  screen: { kind: string; offers: OfferState[] };
  player: { character: string; deck: CardState[]; relics: string[] };
}
export interface ChatMessage { role: "user" | "assistant" | "system"; text: string; }
export interface RendererState {
  game: GameState | null; messages: ChatMessage[]; busy: boolean; connected: boolean;
  model: string | null; modelOptions: string[]; error: string | null;
}
export interface OverlayApi {
  onState(listener: (state: GameState) => void): () => void;
  onDelta(listener: (delta: string) => void): () => void;
  onChatDone(listener: () => void): () => void;
  onStatus(listener: (status: Partial<RendererState>) => void): () => void;
  ask(question: string): Promise<void>; login(): Promise<void>; refreshState(): Promise<void>; minimize(): Promise<void>;
}
declare global { interface Window { draftAdvisor: OverlayApi; } }
