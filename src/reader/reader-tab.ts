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

/** 阅读 Tab 会话持久化键（记录关机前打开的书，重启后自动恢复） */
export const READER_SESSION_KEY = "hiword-reader-session.json";

interface TabRecord {
  tab: any; // Tab
  comp: any; // Svelte 组件
  title: string; // 书名（用于恢复时传 title，避免先显「阅读」再闪一下）
}

export class ReaderTabController {
  private openTabs = new Map<string, TabRecord>(); // bookId -> { tab, comp, title }
  private opening = new Set<string>(); // bookId -> 正在打开中（防重入竞态导致重复 openTab）
  private registered = false;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null; // 会话持久化防抖

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
        // 2026-08-29：思源自定义协议（siyuan://plugins/…?data=…）开页签时，
        // data 可能是已解析的对象，也可能是原始 JSON 字符串（内核版本差异）。
        // 统一兜底解析一次，保证深链场景下 bookId 一定能取到，不会开出空白页签。
        let rawData: any = custom.data;
        if (typeof rawData === "string") {
          try {
            rawData = JSON.parse(rawData);
          } catch (__swallowErr) { logSwallow(__swallowErr, "reader-tab.ts · parse custom.data", "debug"); }
        }
        const bookId = rawData?.bookId;
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
              // 2026-08-28：连续朗读控制器设置透传（get 读 / save 写，结构 = reader-tts 的 RewordTtsSettings）
              getTtsSettings: () => (self.plugin as any)?.getTtsSettings?.() ?? null,
              saveTtsSettings: (s: any) => (self.plugin as any)?.saveTtsSettings?.(s) ?? Promise.resolve(),
              onSendToNote: (opts: { markdown: string; title: string }) =>
                self.plugin?.sendReaderSelection?.(opts) ?? undefined,
              onInsertToCurrentDoc: (markdown: string) =>
                self.plugin?.insertReaderSelectionToCurrentDoc?.({ markdown }) ?? undefined,
              // 2026-08-27：翻译按钮发送到 AI 精读面板（自动打开）；悬浮取词「加入词库」委托 vocabStore
              onTranslateToAi: (t: string) => self.plugin?.translateToAi?.(t),
              // 2026-08-27：双语段落批量翻译（按书缓存，引擎链兜底）
              // 2026-08-30：透传 extra（model/overwrite/signal）以支持整书预翻译细化选项
              // 2026-08-30 修复：ctxBefore（前文参考）+ meta（书籍元数据）必须透传，
              //   否则 AI 翻译拿不到前文语境，专有名词一致性（v1.3.0）失效
              //   meta 兜底用 plugin.getBookMeta(bookId) 现场取；ctxBefore 由调用方（bilingual.ts）传入
              onTranslateBatch: (
                texts: string[],
                from: string,
                to: string,
                ctxBefore?: (string | null)[],
                meta?: { title?: string; author?: string; language?: string; toc?: string } | null,
                extra?: any
              ) => {
                const finalMeta = meta ?? (self.plugin as any)?.getBookMeta?.(bookId) ?? null;
                return (
                  self.plugin?.translateBatch?.(texts, from, to, bookId, ctxBefore, finalMeta, extra) ??
                  Promise.resolve([])
                );
              },
              // 2026-08-30 详细翻译（回传 provider / fromCache）供成本与引擎统计
              // 2026-08-30 修复：同 onTranslateBatch，ctxBefore/meta 透传
              onTranslateBatchDetailed: (
                texts: string[],
                from: string,
                to: string,
                ctxBefore?: (string | null)[],
                meta?: { title?: string; author?: string; language?: string; toc?: string } | null,
                extra?: any
              ) => {
                const finalMeta = meta ?? (self.plugin as any)?.getBookMeta?.(bookId) ?? null;
                return (
                  self.plugin?.translateBatchDetailed?.(texts, from, to, bookId, ctxBefore, finalMeta, extra) ??
                  Promise.resolve({ texts: [], providers: [], fromCache: [] })
                );
              },
              // 2026-08-30：整书预翻译弹窗「已缓存统计」——按书查询每段缓存命中，返回同序 boolean[]
              onCheckCache: (texts: string[]) =>
                self.plugin?.checkTranslationCacheHits?.(bookId, texts) ?? Promise.resolve(new Array(texts.length).fill(false)),
              isTranslationConfigured: () => !!self.plugin?.isTranslationConfigured?.(),
              getAiSettings: () => (self.plugin as any)?.getAiSettings?.() ?? null,
              onSaveTencentLock: (chars: number) => (self.plugin as any)?.saveTencentCharsLock?.(chars) ?? Promise.resolve(),
              onSaveAiSettings: (partial: any) => (self.plugin as any)?.updateAiSettings?.(partial) ?? Promise.resolve(),
              // 2026-08-31 Phase 4：打开「双语翻译设置」独立 Tab（替换原内联弹窗）
              onOpenBilingualSettingsTab: () => (self.plugin as any)?.openBilingualSettingsTab?.(),
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
              // 2026-08-31 Phase 3：术语表（读写全局词条；改动会让相关译文失效重译）
              getGlossaryTerms: () => (self.plugin as any)?.getGlossaryTerms?.() ?? [],
              setGlossaryTerms: (terms: any[]) =>
                (self.plugin as any)?.setGlossaryTerms?.(terms) ?? Promise.resolve(),
              // 2026-08-28：翻译缓存统计 / 清空（按书；UI 展示已缓存条数 + 清空按钮）
              getTranslationCacheStats: (bid: string) =>
                (self.plugin as any)?.getTranslationCacheStats?.(bid) ?? Promise.resolve({ count: 0 }),
              clearTranslationCache: (bid: string) => (self.plugin as any)?.clearTranslationCache?.(bid),
              // 2026-08-28：列出所有有翻译缓存的书籍（bookId + 书名），供「选择书籍」下拉
              listCachedBooks: () =>
                (self.plugin as any)?.listCachedBooks?.() ?? Promise.resolve([]),
              // 2026-08-30：清理「孤儿」翻译缓存（书架已删除书籍对应的缓存文件）
              cleanOrphanCaches: () =>
                (self.plugin as any)?.cleanOrphanTranslationCaches?.() ?? Promise.resolve(0),
              // 2026-08-31 Task A：双语翻译「按书记忆」模式（读 / 写）
              // 点「双语」且全局默认=ask 时，先查本书是否已有记忆；有则直接套用不弹窗。
              getBilingualBookMode: (bid: string) =>
                (self.plugin as any)?.getBilingualBookMode?.(bid) ?? Promise.resolve(null),
              setBilingualBookMode: (bid: string, mode: "whole-book" | "progressive") =>
                (self.plugin as any)?.setBilingualBookMode?.(bid, mode) ?? Promise.resolve(),
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
        self.openTabs.set(bookId, { tab: custom.tab, comp, title: (rawData?.title as string) || "阅读" });
        // 思源自定义 Tab 不随布局自动恢复，需在插件侧记录会话，重启后由 restoreSession 重开
        self.persistSession();
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
          // Tab 关闭即从会话移除（用户主动关 → 重启不再恢复）
          self.persistSession();
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
        this.openTabs.set(bookId, { tab, comp: this.openTabs.get(bookId)?.comp ?? null, title: title || "阅读" });
        // 记录会话：重启思源后自动恢复该阅读 Tab
        this.persistSession();
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

  /**
   * 持久化当前打开的阅读 Tab 列表（bookId + 书名）。
   * 思源不会自动恢复自定义插件 Tab，关机/重启后这些 Tab 会丢失；
   * 这里把「关机前还开着的书」记到插件数据，等 restart 后由 restoreSession 重开。
   * 防抖写入，避免开/关连续触发时频繁 IO。
   */
  private persistSession(): void {
    if (!this.plugin?.saveData) return;
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = setTimeout(() => {
      this.sessionTimer = null;
      try {
        const open = Array.from(this.openTabs.entries()).map(([bookId, rec]) => ({
          bookId,
          title: rec.title || "",
        }));
        this.plugin.saveData(READER_SESSION_KEY, { openTabs: open }).catch(() => {});
      } catch (__e) { logSwallow(__e, "reader-tab.ts · persistSession", "debug"); }
    }, 200);
  }

  /**
   * 重启思源后恢复上次打开的阅读 Tab（由插件 onLayoutReady 调用）。
   * - 仅当设置「重启后恢复阅读 Tab」开启；关闭时清理会话，下次不恢复。
   * - 跳过书架已删除的书（避免开出空白页签）。
   * - 与思源自带布局恢复幂等：若思源已重建该 Tab（init 已写入 openTabs），
   *   openBookTab 会直接聚焦、不重复开。
   */
  async restoreSession(): Promise<void> {
    if (!this.plugin?.loadData) return;
    let saved: any = null;
    try {
      saved = await this.plugin.loadData(READER_SESSION_KEY);
    } catch (__e) { logSwallow(__e, "reader-tab.ts · loadSession", "debug"); }
    const open = Array.isArray(saved?.openTabs) ? saved.openTabs : [];

    // 读开关：默认开（字段缺失视为开，兼容旧配置）
    let enabled = true;
    try {
      enabled = (this.stores.settingsStore.get() as any)?.layout?.restoreTabsOnLaunch ?? true;
    } catch (__e) { logSwallow(__e, "reader-tab.ts · readRestoreFlag", "debug"); }

    if (!enabled) {
      // 用户关掉了恢复：清掉会话，下次启动不再重开
      try { await this.plugin.saveData(READER_SESSION_KEY, { openTabs: [] }); } catch (__e) {}
      return;
    }

    if (open.length === 0) return;

    // 顺序重开（Map 插入序 = 当初打开序，最后一本是最后聚焦的）
    for (const item of open) {
      if (!item?.bookId) continue;
      // 书已被删除则跳过
      try {
        const meta = this.stores.store.get?.(item.bookId);
        if (!meta) continue;
      } catch (__e) { logSwallow(__e, "reader-tab.ts · checkBook", "debug"); }
      try {
        await this.openBookTab(item.bookId, item.title || undefined);
      } catch (e) {
        console.warn("[REword] 恢复阅读 Tab 失败:", e);
      }
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
