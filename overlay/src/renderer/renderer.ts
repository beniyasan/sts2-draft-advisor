import { GameState, RendererState } from "../shared/protocol";
import { Live2DAdapter } from "./live2d";

const state: RendererState & { streaming?: boolean } = { game: null, messages: [], busy: false, connected: false, model: null, modelOptions: [], error: null, streaming: false };
const messages = document.getElementById("messages")!;
const input = document.getElementById("input") as HTMLTextAreaElement;
const context = document.getElementById("context")!;
const status = document.getElementById("status")!;
const model = document.getElementById("model")!;
const avatar = new Live2DAdapter(document.getElementById("avatar")!);
function render(): void {
  messages.replaceChildren(...state.messages.map(message => { const item = document.createElement("div"); item.className = `message ${message.role}`; item.textContent = message.text; return item; }));
  messages.scrollTop = messages.scrollHeight;
  if (state.game) { const g = state.game; context.textContent = `${g.player.character} / デッキ ${g.player.deck.length}枚 / レリック ${g.player.relics.length}個 / ${g.screen.kind}`; }
  model.textContent = state.model ? `(${state.model})` : ""; status.textContent = state.error ? `エラー: ${state.error}` : state.connected ? (state.busy ? "相談中…" : "接続中") : "ゲーム接続待ち"; avatar.setState(state.error ? "error" : state.busy ? (state.streaming ? "speaking" : "thinking") : "idle");
}
window.draftAdvisor.onState((game: GameState) => { state.game = game; state.connected = true; render(); });
window.draftAdvisor.onDelta((delta: string) => { state.busy = true; state.streaming = true; avatar.pulseSpeaking(); const last = state.messages[state.messages.length - 1]; if (!last || last.role !== "assistant") state.messages.push({ role: "assistant", text: delta }); else last.text += delta; render(); });
window.draftAdvisor.onChatDone(() => { state.busy = false; state.streaming = false; render(); });
window.draftAdvisor.onStatus(update => { Object.assign(state, update); render(); });
document.getElementById("form")!.addEventListener("submit", async event => { event.preventDefault(); const question = input.value.trim(); if (!question || state.busy) return; input.value = ""; state.messages.push({ role: "user", text: question }); state.busy = true; state.error = null; state.streaming = false; render(); try { await window.draftAdvisor.ask(question); } catch (error) { state.busy = false; state.streaming = false; state.messages.push({ role: "system", text: String(error) }); render(); } });
document.getElementById("refresh")!.addEventListener("click", () => void window.draftAdvisor.refreshState());
document.getElementById("login")!.addEventListener("click", async () => {
  try { await window.draftAdvisor.login(); }
  catch (error) { state.error = String(error instanceof Error ? error.message : error); render(); }
});
document.getElementById("close")!.addEventListener("click", () => void window.draftAdvisor.minimize());
render();
