import { GameState } from "../shared/protocol";

/** Buffers the latest game state until the renderer has installed its listeners. */
export class GameStateRelay {
  private state: GameState | null = null;
  private connected = false;
  private rendererReady = false;

  constructor(
    private readonly send: (channel: string, value: unknown) => void,
    private readonly requestState: () => void,
  ) {}

  publishState(state: GameState): void {
    this.state = state;
    if (this.rendererReady) this.send("game-state", state);
  }

  publishConnection(connected: boolean): void {
    this.connected = connected;
    if (!connected) this.state = null;
    if (this.rendererReady) this.send("connection-status", { connected });
  }

  markRendererReady(): void {
    this.rendererReady = true;
    this.send("connection-status", { connected: this.connected });
    if (this.state) this.send("game-state", this.state);
    else if (this.connected) this.requestState();
  }
}
