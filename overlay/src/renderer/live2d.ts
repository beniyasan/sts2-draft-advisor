export type AvatarState = "idle" | "thinking" | "speaking" | "error";

/** Placeholder boundary for a licensed Cubism Web model. */
export class Live2DAdapter {
  constructor(private readonly element: HTMLElement) { this.setState("idle"); }
  setState(state: AvatarState): void {
    this.element.dataset.state = state;
    this.element.textContent = state === "thinking" ? "考え中…" : state === "speaking" ? "分析中" : "Draft Advisor";
  }
}
