import { contextBridge, ipcRenderer } from "electron";
import { GameState, OverlayApi, RendererStatus } from "./shared/protocol";

const api: OverlayApi = {
  onState: listener => { const fn = (_event: unknown, value: GameState) => listener(value); ipcRenderer.on("game-state", fn); return () => ipcRenderer.removeListener("game-state", fn); },
  onDelta: listener => { const fn = (_event: unknown, value: string) => listener(value); ipcRenderer.on("chat-delta", fn); return () => ipcRenderer.removeListener("chat-delta", fn); },
  onChatDone: listener => { const fn = () => listener(); ipcRenderer.on("chat-done", fn); return () => ipcRenderer.removeListener("chat-done", fn); },
  onStatus: listener => { const fn = (_event: unknown, value: RendererStatus) => listener(value); ipcRenderer.on("codex-status", fn); ipcRenderer.on("connection-status", fn); return () => { ipcRenderer.removeListener("codex-status", fn); ipcRenderer.removeListener("connection-status", fn); }; },
  rendererReady: () => ipcRenderer.invoke("renderer-ready"),
  ask: question => ipcRenderer.invoke("ask", question), login: () => ipcRenderer.invoke("login"), refreshState: () => ipcRenderer.invoke("refresh-state"), minimize: () => ipcRenderer.invoke("minimize-window"),
};
contextBridge.exposeInMainWorld("draftAdvisor", api);
