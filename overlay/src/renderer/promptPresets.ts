export interface PromptPreset {
  id: string;
  name: string;
  text: string;
  builtIn?: boolean;
}

export const DEFAULT_PROMPT_PRESETS: PromptPreset[] = [
  { id: "deck-pick", name: "デッキに合う選択", text: "このデッキで、提示されたカードの中から何を取るべき？理由と代替案も教えて。", builtIn: true },
  { id: "compare-offers", name: "提示カードを比較", text: "提示されたカードを、このデッキとの相性・将来性・リスクで比較して。", builtIn: true },
  { id: "card-detail", name: "カード単体を相談", text: "このカードを取るべきか、現在のデッキと今後の方針を踏まえて詳しく教えて。", builtIn: true },
];

const STORAGE_KEY = "draft-advisor.prompt-presets.v1";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class PromptPresetStore {
  private custom: PromptPreset[];
  private readonly storage?: StorageLike;

  constructor(storage?: StorageLike) {
    this.storage = storage ?? getStorage();
    this.custom = this.loadCustom();
  }

  list(): PromptPreset[] {
    return [...DEFAULT_PROMPT_PRESETS, ...this.custom];
  }

  save(name: string, text: string): PromptPreset | null {
    const cleanName = name.trim();
    const cleanText = text.trim();
    if (!cleanName || !cleanText) return null;
    const preset: PromptPreset = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: cleanName.slice(0, 40),
      text: cleanText.slice(0, 2000),
    };
    this.custom.push(preset);
    this.persist();
    return preset;
  }

  remove(id: string): boolean {
    const before = this.custom.length;
    this.custom = this.custom.filter(preset => preset.id !== id);
    if (this.custom.length === before) return false;
    this.persist();
    return true;
  }

  private loadCustom(): PromptPreset[] {
    if (!this.storage) return [];
    try {
      const parsed = JSON.parse(this.storage.getItem(STORAGE_KEY) ?? "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is PromptPreset =>
        !!item && typeof item.id === "string" && item.id.startsWith("custom-") &&
        typeof item.name === "string" && typeof item.text === "string" &&
        item.name.trim().length > 0 && item.text.trim().length > 0,
      ).slice(0, 30);
    } catch {
      return [];
    }
  }

  private persist(): void {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.custom)); } catch { /* storage can be disabled */ }
  }
}

function getStorage(): StorageLike | undefined {
  try {
    return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}
