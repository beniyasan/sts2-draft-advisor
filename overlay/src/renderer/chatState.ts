import { GameState, RendererState, RendererStatus } from "../shared/protocol";
import type { AvatarState } from "./live2d";

/** State transitions shared by IPC and user actions, independent of the DOM. */
export class ChatState implements RendererState {
  game: GameState | null = null;
  messages: RendererState["messages"] = [];
  busy = false;
  connected = false;
  model: string | null = null;
  modelOptions: string[] = [];
  error: string | null = null;
  streaming = false;
  private suppressStreaming = false;
  private suppressCompletion = false;

  setGame(game: GameState): void {
    this.game = game;
    this.connected = true;
  }

  begin(question: string): boolean {
    if (!question.trim() || this.busy) return false;
    this.messages.push({ role: "user", text: question.trim() });
    this.busy = true;
    this.streaming = false;
    this.suppressStreaming = false;
    this.suppressCompletion = false;
    this.error = null;
    return true;
  }

  appendDelta(delta: string): boolean {
    if (!this.busy || this.suppressStreaming || !delta) return false;
    const last = this.messages[this.messages.length - 1];
    if (this.streaming && last?.role === "assistant") last.text += delta;
    else this.messages.push({ role: "assistant", text: delta });
    this.streaming = true;
    return true;
  }

  finish(): void {
    this.busy = false;
    this.streaming = false;
    this.suppressStreaming = false;
    this.suppressCompletion = false;
  }

  clear(): void {
    this.messages = [];
    this.error = null;
    this.streaming = false;
    // An in-flight request cannot be cancelled through the renderer API. Hide
    // its late deltas so clearing the window remains effective.
    this.suppressStreaming = this.busy;
    this.suppressCompletion = this.busy;
  }

  fail(error: unknown): void {
    const suppressed = this.suppressCompletion;
    this.finish();
    if (!suppressed) this.messages.push({ role: "system", text: errorMessage(error) });
  }

  applyStatus(status: RendererStatus): void {
    if (status.connected !== undefined) this.connected = status.connected;
    if (status.model !== undefined) this.model = status.model;
    if (status.modelOptions !== undefined) this.modelOptions = status.modelOptions;
    if (status.error !== undefined) this.error = status.error;
  }

  get avatarState(): AvatarState {
    if (this.error) return "error";
    if (!this.busy) return "idle";
    return this.streaming ? "speaking" : "thinking";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
