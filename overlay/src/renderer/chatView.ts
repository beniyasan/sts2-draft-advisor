import { ChatState } from "./chatState";
import { PromptPreset } from "./promptPresets";

export interface ChatElements {
  messages: HTMLElement;
  input: HTMLTextAreaElement;
  context: HTMLElement;
  status: HTMLElement;
  model: HTMLElement;
  form: HTMLFormElement;
  clear: HTMLElement;
  presetSelect: HTMLSelectElement;
  presetUse: HTMLElement;
  presetName: HTMLInputElement;
  presetSave: HTMLElement;
  presetDelete: HTMLElement;
  refresh: HTMLElement;
  login: HTMLElement;
  close: HTMLElement;
}

/** Keeps existing message nodes intact while the current answer grows. */
export class ChatView {
  constructor(readonly elements: ChatElements) {}

  renderPresets(presets: PromptPreset[], selectedId = ""): void {
    const options = [`<option value="">定型文を選択</option>`, ...presets.map(preset =>
      `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`)].join("");
    this.elements.presetSelect.innerHTML = options;
    this.elements.presetSelect.value = selectedId;
  }

  render(state: ChatState): void {
    const { messages, context, model, status } = this.elements;
    let messagesChanged = false;
    if (messages.children.length > state.messages.length) {
      const keep = Array.from(messages.children).slice(0, state.messages.length);
      messages.replaceChildren(...keep);
      messagesChanged = true;
      if (state.messages.length === 0) messages.scrollTop = 0;
    }
    state.messages.forEach((message, index) => {
      let item = messages.children[index] as HTMLElement | undefined;
      if (!item) {
        item = messages.ownerDocument.createElement("div");
        messages.appendChild(item);
        messagesChanged = true;
      }
      const className = `message ${message.role}`;
      if (item.className !== className) item.className = className;
      if (item.dataset.markdown !== message.text) {
        const rendered = message.role === "assistant"
          ? renderMarkdown(message.text)
          : escapeHtml(message.text).replace(/\n/g, "<br>");
        if ("innerHTML" in item) item.innerHTML = rendered;
        else (item as any).textContent = message.text;
        item.dataset.markdown = message.text;
        messagesChanged = true;
      }
    });
    if (messagesChanged) messages.scrollTop = messages.scrollHeight;

    const game = state.game;
    if (game) setText(context, `${game.player.character} / デッキ ${game.player.deck.length}枚 / レリック ${game.player.relics.length}個 / ${game.screen.kind}`);
    setText(model, state.model ? `(${state.model})` : "");
    setText(status, state.error
      ? `エラー: ${state.error}`
      : state.connected ? (state.busy ? "相談中…" : "接続中") : "ゲーム接続待ち");
  }
}

/** Render the response subset of Markdown without allowing arbitrary HTML. */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }

    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
      output.push(`<pre class="md-code"><code${language}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index++;
      continue;
    }
    if (/^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
      output.push("<hr>"); index++; continue;
    }

    if (index + 1 < lines.length && line.includes("|") && isTableDivider(lines[index + 1])) {
      const headers = tableCells(line).map(cell => `<th>${inlineMarkdown(cell)}</th>`).join("");
      const rows: string[] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(`<tr>${tableCells(lines[index]).map(cell => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`);
        index++;
      }
      output.push(`<table><thead><tr>${headers}</tr></thead><tbody>${rows.join("")}</tbody></table>`);
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index++].replace(/^\s*>\s?/, ""));
      }
      output.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
      continue;
    }

    const list = line.match(/^\s*([-+*])\s+(.+)$/) ?? line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (list) {
      const ordered = /^\d/.test(list[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-+*]\s+(.+)$/);
        if (!item) break;
        items.push(`<li>${inlineMarkdown(item[1])}</li>`); index++;
      }
      output.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }

    const paragraph: string[] = [line];
    index++;
    while (index < lines.length && lines[index].trim() &&
      !/^\s*(#{1,6})\s+/.test(lines[index]) && !/^\s*```/.test(lines[index]) &&
      !/^\s*(?:[-+*]|\d+[.)])\s+/.test(lines[index]) && !/^\s*>/.test(lines[index])) {
      paragraph.push(lines[index++]);
    }
    output.push(`<p>${paragraph.map(inlineMarkdown).join("<br>")}</p>`);
  }
  return output.join("");
}

function inlineMarkdown(value: string): string {
  let text = escapeHtml(value);
  const code: string[] = [];
  text = text.replace(/`([^`\n]+)`/g, (_match, body: string) => {
    const token = `\u0000${code.length}\u0000`;
    code.push(`<code>${body}</code>`);
    return token;
  });
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+['"]([^'"]*)['"])?\)/g,
    (_match, label: string, url: string, title?: string) => {
      const safe = /^(?:https?:|mailto:)/i.test(unescapeHtml(url)) ? url : "#";
      const titleAttr = title ? ` title="${title}"` : "";
      return `<a href="${safe}" target="_blank" rel="noreferrer"${titleAttr}>${label}</a>`;
    });
  text = text.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `<strong>${a ?? b}</strong>`);
  text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  text = text.replace(/\*([^*\n]+)\*|_([^_\n]+)_/g, (_m, a, b) => `<em>${a ?? b}</em>`);
  return text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => code[Number(i)]);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

function unescapeHtml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function isTableDivider(value: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(value);
}

function tableCells(value: string): string[] {
  return value.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}
