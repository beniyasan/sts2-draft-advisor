import { contextBridge, ipcRenderer } from "electron";
import { OverlayApi } from "./shared/protocol";

const api: OverlayApi = {
  onState: listener => { const fn = (_event: unknown, value: any) => listener(value); ipcRenderer.on("game-state", fn); return () => ipcRenderer.removeListener("game-state", fn); },
  onDelta: listener => { const fn = (_event: unknown, value: string) => listener(value); ipcRenderer.on("chat-delta", fn); return () => ipcRenderer.removeListener("chat-delta", fn); },
  onChatDone: listener => { const fn = () => listener(); ipcRenderer.on("chat-done", fn); return () => ipcRenderer.removeListener("chat-done", fn); },
  onStatus: listener => { const fn = (_event: unknown, value: any) => listener(value); ipcRenderer.on("codex-status", fn); ipcRenderer.on("connection-status", fn); return () => { ipcRenderer.removeListener("codex-status", fn); ipcRenderer.removeListener("connection-status", fn); }; },
  ask: question => ipcRenderer.invoke("ask", question), login: () => ipcRenderer.invoke("login"), refreshState: () => ipcRenderer.invoke("refresh-state"), minimize: () => ipcRenderer.invoke("minimize-window"),
};
contextBridge.exposeInMainWorld("draftAdvisor", api);
