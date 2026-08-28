import { logSwallow } from "../core/safe.ts";
/**
 * 阅读器 - 独立 Tab 控制器
 * ---------------------------------------------------------------
 * 把「阅读」从 Dock 面板升级为思源原生 Tab（像打开文档一样）：
 * - onload 时注册自定义 Tab 类型（plugin.addTab），书架点书 → openTab 打开独立 Tab
 * - 多开：每本书一个 Tab，可同时开多本
 * - 去重：同一本书已开 → 聚焦已有 Tab，不重复开
 * - 生命周期：Tab 关闭 → destroy → 销毁 Svelte 组件（触发 view.close + 进度/时长落盘）
 */

// @ts-ignore - Svelte 组件
import ReaderView from "./ReaderView.svelte";
import { openTab } from "siyuan";
import type { BookshelfStore } from "./bookshelf-store";
import type { ReaderSettingsStore } from "./reader-settings";
import type { FontStore } from "./reader-fonts";

export const READER_TAB_TYPE = "reader";

interface TabRecord {
  tab: any; // Tab
  comp: any; // Svelte 组件
}

export class ReaderTabController {
  private openTabs = new Map<string, TabRecord>(); // bookId -> { tab, comp }
  private opening = new Set<string>(); // bookId -> 正在打开中（防重入竞态导致重复 openTab）
  private registered = false;

  constructor(
    private plugin: any,
    private stores: {
      store: BookshelfStore;
      settingsStore: ReaderSettingsStore;
      fontStore: FontStore;
    },
    private getLabel?: (id: string) => { name: string; color: string } | null
  ) {}

  /** 注册自定义 Tab 类型（必须在 onload 同步阶段调用） */
  register(): void {
    if (this.registered) return;
    this.registered = true;
    const self = this;
    this.plugin.addTab({
      type: READER_TAB_TYPE,
      init: function (this: any) {
        const custom = this;
        const bookId = custom.data?.bookId;
        if (!bookId) return;
        // 2026-08-24 修复（方案 B）：custom.element 用 flex 撑满，
        // holder 改为相对 flex 子项，不再使用 absolute inset:0。
        // 避免 holder 成为覆盖整个 Tab 的命中层，从而拦截思源顶栏"管理"菜单。
        custom.element.style.display = "flex";
        custom.element.style.flexDirection = "column";
        custom.element.style.minHeight = "0";
        custom.element.style.position = "relative";
        custom.element.style.overflow = "hidden";
        const holder = document.createElement("div");
        holder.style.cssText =
          "position:relative;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;";
        custom.element.append(holder);
        let comp: any = null;
        try {
          comp = new ReaderView({
            target: holder,
            props: {
              bookId,
              store: self.stores.store,
              settingsStore: self.stores.settingsStore,
              fontStore: self.stores.fontStore,
              onCloseTab: () => {
                try {
                  custom.tab?.close?.();
                } catch (__swallowErr) { logSwallow(__swallowErr, "reader-tab.ts · onCloseTab", "debug"); }
              },
              onTitleChange: (t: string) => {
                try {
                  custom.tab?.updateTitle?.(t);
                } catch (__swallowErr) { logSwallow(__swallowErr, "reader-tab.ts · onTitleChange", "debug"); }
              },
              // 阅读器划词工具栏委托插件能力：朗读 / 发送笔记本 / 翻译
              onSpeak: (t: string) => { try { self.plugin?.speakText?.(t); } catch (__swallowErr) { logSwallow(__swallowErr, "reader-tab.ts · onSpeak", "debug"); } },
              onSendToNote: (opts: { markdown: string; title: string }) =>
                self.plugin?.sendReaderSelection?.(opts) ?? undefined,
              onInsertToCurrentDoc: (markdown: string) =>
                self.plugin?.insertReaderSelectionToCurrentDoc?.({ markdown }) ?? undefined,
              // 2026-08-27：翻译按钮发送到 AI 精读面板（自动打开）；悬浮取词「加入词库」委托 vocabStore
              onTranslateToAi: (t: string) => self.plugin?.translateToAi?.(t),
              // 2026-08-27：双语段落批量翻译（按书缓存，引擎链兜底）
              onTranslateBatch: (texts: string[], from: string, to: string) =>
                self.plugin?.translateBatch?.(texts, from, to, bookId) ?? Promise.resolve([]),
              isTranslationConfigured: () => !!self.plugin?.isTranslationConfigured?.(),
              onAddToVocab: (w: string) => self.plugin?.getVocabStore?.()?.addWord?.(w),
              // 2026-08-27：阅读器词典弹窗「侧边栏」按钮 → 复用主插件 openWordInSidebar
              onOpenInSidebar: (w: string) => self.plugin?.openWordInSidebar?.(w),
              onRemoveFromVocab: (w: string) => self.plugin?.getVocabStore?.()?.removeWord?.(w),
              isInVocab: (w: string) => !!self.plugin?.getVocabStore?.()?.hasWord?.(w),
              getLabel: self.getLabel,
              // v1.3.0：本书前提上下文（用户手写背景/人物/译法，注入 AI 翻译 prompt）
              primerStore: (self.plugin as any)?.bookPrimer,
              // v1.3.0：本书累计 Token 统计（读/重置）
              getTokenUsage: (bid: string) =>
                (self.plugin as any)?.getBookTokenUsage?.(bid) ?? { total: 0, prompt: 0, completion: 0 },
              resetTokenUsage: (bid: string) => (self.plugin as any)?.resetBookTokenUsage?.(bid),
              // v1.3.0：最近一次翻译 token 用量（修复原裸 plugin 引用未定义）
              getLastUsage: () => (self.plugin as any)?.lastTranslationUsage ?? null,
              // 2026-08-28：翻译缓存统计 / 清空（按书；UI 展示已缓存条数 + 清空按钮）
              getTranslationCacheStats: (bid: string) =>
                (self.plugin as any)?.getTranslationCacheStats?.(bid) ?? Promise.resolve({ count: 0 }),
              clearTranslationCache: (bid: string) => (self.plugin as any)?.clearTranslationCache?.(bid),
              // 2026-08-28：列出所有有翻译缓存的书籍（bookId + 书名），供「选择书籍」下拉
              listCachedBooks: () =>
                (self.plugin as any)?.listCachedBooks?.() ?? Promise.resolve([]),
              // 2026-08-28：翻译成功入缓存后回传「节」序号（1-based），用于 UI「第 X-Y 页缓存成功」
              recordCachedSections: (bid: string, sections: number[]) =>
                (self.plugin as any)?.recordCachedSections?.(bid, sections),
              // 批注/高亮保存后固定阅读 Tab：官方 tab.pin() 防数量超限回收顶掉
              onProtectTab: () => {
                try {
                  const t = self.openTabs.get(bookId)?.tab;
                  t?.pin?.();
                } catch (__swallowErr) { logSwallow(__swallowErr, "reader-tab.ts · onProtectTab", "debug"); }
              },
            },
          });
        } catch (e) {
          console.warn("[REword] 阅读 Tab 挂载失败:", e);
          return;
        }
        self.openTabs.set(bookId, { tab: custom.tab, comp });
        // 2026-08-24 修复（问题3）：立即给阅读 Tab 一个稳定标题，避免被思源当成
        // "无名空白 Tab" 参与「在当前页签中打开 → 替换未修改页签」的回收逻辑。
        // 书名异步加载完成后 ReaderView 会经 onTitleChange 再次更新为 "书名 · 章节"。
        // 自定义 Tab 本身不参与文档页签的替换判定，但明确命名可彻底排除误判。
        try {
          custom.tab?.updateTitle?.(custom.data?.title || "阅读");
        } catch (__swallowErr) { logSwallow(__swallowErr, "reader-tab.ts · onProtectTab", "debug"); }
      },
      destroy: function (this: any) {
        const custom = this;
        const bookId = custom.data?.bookId;
        if (!bookId) return;
        const rec = self.openTabs.get(bookId);
        if (rec) {
          try {
            rec.comp?.$destroy?.();
          } catch (__swallowErr) { logSwallow(__swallowErr, "reader-tab.ts · onProtectTab", "debug"); }
          self.openTabs.delete(bookId);
        }
      },
    });
  }

  /** 打开一本书的阅读 Tab；已打开则聚焦（不重复开），未打开则新建并激活 */
  async openBookTab(bookId: string, title?: string): Promise<void> {
    const existing = this.openTabs.get(bookId);
    if (existing?.tab) {
      try {
        existing.tab.parent?.switchTab?.(existing.tab.headElement);
      } catch (__swallowErr) { logSwallow(__swallowErr, "reader-tab.ts · openBookTab", "debug"); }
      return;
    }
    // 2026-08-24 修复（问题3）：防重入。书架连点/并发调用时，init 尚未把 tab 写回
    // openTabs，第二次调用会再 openTab 一次，造成重复 custom Tab，思源可能把先开的
    // 无名 Tab 当作「未修改」回收。用 opening 锁挡住并发的重复打开。
    if (this.opening.has(bookId)) return;
    this.opening.add(bookId);
    console.log("[REword] openBookTab 调 openTab", { bookId });
    try {
      // 思源 openTab 路由：custom.id 必须精确等于 addTab 注册的工厂 key
      // 实测 = plugin.name + tab.type 直接拼接（无分隔符）：
      // "siyuan-plugin-reword" + "reader" = "siyuan-plugin-rewordreader"
      const tab = await openTab({
        app: (window as any).siyuan?.ws?.app,
        custom: {
          id: `${this.plugin.name}${READER_TAB_TYPE}`,
          type: READER_TAB_TYPE,
          // 2026-08-27 修复（pin 后空白胶囊）：原用 "iconBook"，但该图标 ID 在当前版本
          // 思源桌面端不存在（grep 全量 JS 为 0 引用）→ <use href="#iconBook"> 空引用。
          // 平时 tab 有 title 文本看不出问题；一旦批注保存触发 pin()，思源会隐藏文本只显
          // 图标 → 34px 空白胶囊且被移到标签栏最前（用户看到的"左上角没信息的小页签"）。
          // 改用插件自身已注入 DOM 的 SVG symbol（onload addIcons 注册），保证 pin 态可见。
          icon: "iconREwordReader",
          title: title || "阅读",
          data: { bookId, title },
        } as any,
        keepCursor: false,
        openNewTab: true,
        afterOpen: () => {
          // 打开后显式切换到新书页签，确保界面自动跳转定位到阅读窗口
          // addTab 的 init 已把 tab 记录到 openTabs，因此从 map 中取最可靠
          try {
            const opened = this.openTabs.get(bookId)?.tab;
            if (opened) {
              opened.parent?.switchTab?.(opened.headElement);
            }
          } catch (__swallowErr) { logSwallow(__swallowErr, "reader-tab.ts · afterOpen", "debug"); }
        },
      });
      console.log("[REword] openBookTab openTab 返回", { tabExists: !!tab, tabType: (tab as any)?.type });
      if (tab) {
        this.openTabs.set(bookId, { tab, comp: this.openTabs.get(bookId)?.comp ?? null });
        // 兜底：若 afterOpen 因时序未触发，立即再切一次
        try {
          tab.parent?.switchTab?.(tab.headElement);
        } catch (__swallowErr) { logSwallow(__swallowErr, "reader-tab.ts · afterOpen", "debug"); }
      }
    } catch (e) {
      console.warn("[REword] 打开阅读 Tab 失败:", e);
    } finally {
      // 无论成功失败都释放锁，避免异常时永久卡住该书无法再开
      this.opening.delete(bookId);
    }
  }

  /** 插件卸载：关闭所有阅读 Tab */
  dispose(): void {
    for (const rec of this.openTabs.values()) {
      try {
        rec.tab?.close?.();
      } catch (__swallowErr) { logSwallow(__swallowErr, "reader-tab.ts · dispose", "debug"); }
    }
    this.openTabs.clear();
  }

  /**
   * C 跳转定位：打开（或聚焦）书的阅读 Tab，并让 ReaderView 跳转到指定 cfi 弹查看气泡。
   * 由 index.ts 侧边栏阅读批注「原文」点击触发。
   */
  async focusAnnotation(bookId: string, cfi: string): Promise<void> {
    if (!bookId || !cfi) return;
    try {
      await this.openBookTab(bookId);
    } catch (e) {
      console.warn("[REword] focusAnnotation 打开阅读 Tab 失败:", e);
    }
    // openBookTab 后 comp（ReaderView 实例）同步写入 openTabs（init 内 new ReaderView 后立即 set）。
    // 对未开过的书，openTab 异步挂载可能略有延迟，这里短暂轮询等待 comp.focusAnnotation 可用。
    let comp: any = null;
    for (let i = 0; i < 12; i++) {
      comp = this.openTabs.get(bookId)?.comp;
      if (comp?.focusAnnotation) break;
      await new Promise((r) => setTimeout(r, 120));
    }
    if (comp?.focusAnnotation) {
      try {
        await comp.focusAnnotation(cfi);
      } catch (e) {
        console.warn("[REword] focusAnnotation 调用 ReaderView 失败:", e);
      }
    } else {
      console.warn("[REword] focusAnnotation 未找到 ReaderView 实例，无法跳转", { bookId });
    }
  }
}
