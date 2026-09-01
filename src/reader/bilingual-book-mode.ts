import { logSwallow } from "../core/safe.ts";

/**
 * 双语翻译「按书记忆」存储（Task A，2026-08-31）
 * ------------------------------------------------------------------
 * 背景：全局默认 bilingualDefaultMode="ask" 时，每次点「双语」都弹询问窗，
 * 体验割裂；而同一本书用户往往想沿用上次的选法。
 *
 * 方案：按 bookId 持久化用户为「这本书」选定的翻译模式
 * （"whole-book" 整书预翻译 / "progressive" 渐进式），落盘
 * bilingual-book-modes.json。
 * - 点「双语」且全局默认=ask 时，先查本书是否已记忆：
 *     已记忆 → 直接套用（不再弹窗）；未记忆 → 弹窗询问，选定后写回本书记忆。
 * - 中途切换模式不会清除已译缓存：缓存按 bookId+原文 hash 键存，
 *   模式只决定「未来如何取 / 补译」，与既有译文互不干扰（pretranslateAll
 *   默认跳过已缓存段）。故本模块只管「记住选法」，不碰缓存。
 *
 * 只存 whole-book / progressive，绝不存 "ask"——ask 是「每次都问」的全局默认态，
 * 持久化为某书记忆会永久覆盖全局默认，不符合直觉。
 */

export type RememberedBookMode = "whole-book" | "progressive";

const STORAGE_KEY = "bilingual-book-modes.json";

export class BookModeStore {
  private plugin: any;
  /** bookId → 记忆的模式 */
  private mem: Map<string, RememberedBookMode> = new Map();
  private loaded = false;

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  /** 懒加载整份记忆表（小文件，一次读全；内存缓存避免反复读盘） */
  private async ensureLoaded(): Promise<Map<string, RememberedBookMode>> {
    if (this.loaded) return this.mem;
    this.loaded = true;
    try {
      const raw = await this.plugin.loadData(STORAGE_KEY);
      if (raw && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (k && (v === "whole-book" || v === "progressive")) {
            this.mem.set(k, v as RememberedBookMode);
          }
        }
      }
    } catch (__swallowErr) {
      logSwallow(__swallowErr, "bilingual-book-mode.ts · load", "debug");
    }
    return this.mem;
  }

  /** 读取某本书被记住的模式；从未选过 / 非法值返回 null */
  async getMode(bookId: string): Promise<RememberedBookMode | null> {
    if (!bookId) return null;
    const m = await this.ensureLoaded();
    return m.get(bookId) ?? null;
  }

  /** 记住某本书的选法（仅 whole-book / progressive 有效；其余值忽略不写） */
  async setMode(bookId: string, mode: RememberedBookMode): Promise<void> {
    if (!bookId) return;
    if (mode !== "whole-book" && mode !== "progressive") return;
    const m = await this.ensureLoaded();
    if (m.get(bookId) === mode) return; // 无变化不写盘
    m.set(bookId, mode);
    await this.persist();
  }

  /** 清除某本书的记忆（用户想重新选择 / 切回「每次询问」时调用） */
  async clearMode(bookId: string): Promise<void> {
    if (!bookId) return;
    const m = await this.ensureLoaded();
    if (!m.has(bookId)) return;
    m.delete(bookId);
    await this.persist();
  }

  /** 列出全部已记忆的（bookId, mode），供设置面板管理 / 重置 */
  async listModes(): Promise<Array<{ bookId: string; mode: RememberedBookMode }>> {
    const m = await this.ensureLoaded();
    return [...m.entries()].map(([bookId, mode]) => ({ bookId, mode }));
  }

  private async persist(): Promise<void> {
    try {
      const obj: Record<string, RememberedBookMode> = {};
      for (const [k, v] of this.mem) obj[k] = v;
      await this.plugin.saveData(STORAGE_KEY, obj);
    } catch (__swallowErr) {
      logSwallow(__swallowErr, "bilingual-book-mode.ts · persist", "debug");
    }
  }
}
