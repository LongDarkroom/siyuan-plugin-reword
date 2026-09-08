/**
 * 阅读器统一状态（R0 骨架 · Readest 蓝本）
 * ---------------------------------------------------------------
 * 对齐 Readest readerStore（initViewState 编排「书架 ID → 渲染态」）：
 * 提供阅读器全局状态的单一锚点。
 *
 * R0 仅状态契约（不接 UI、不改现有 reader-tab 的 Tab 管理）；
 * R1+ ReaderShell 与书库/安全恢复逐步迁入消费。
 */
import { writable } from "svelte/store";
import type { BookRendition } from "./book-doc.ts";

export interface ReaderViewState {
  /** 当前活跃书（无活跃书为 null） */
  bookId: string | null;
  /** 当前书版式（未开书为 null） */
  rendition: BookRendition | null;
  /** 阅读流向（与 reader-settings 的 flow 同语义） */
  flow: "paginated" | "scrolled";
}

export const readerStore = writable<ReaderViewState>({
  bookId: null,
  rendition: null,
  flow: "paginated",
});

export function setActiveBook(bookId: string, rendition: BookRendition): void {
  readerStore.update((s) => ({ ...s, bookId, rendition }));
}

export function setReaderFlow(flow: "paginated" | "scrolled"): void {
  readerStore.update((s) => ({ ...s, flow }));
}

export function clearActiveBook(): void {
  readerStore.update((s) => ({ ...s, bookId: null, rendition: null }));
}
