/**
 * 阅读器 - Dock 集成控制器（书架容器）
 * ---------------------------------------------------------------
 * Dock 面板只承载「书架」（书库管理：导入/删除/编辑/续读标记）；
 * 点书 → 由 ReaderTabController 打开思源原生 Tab 阅读（支持多开）。
 * - 阅读样式设置（ReaderSettingsStore）与字体（FontStore）随 Dock 共享给 Tab
 * - 记忆上次阅读书籍：仅用于书架标记，不再自动弹 Tab（避免打扰）
 */

// @ts-ignore - Svelte 组件
import BookshelfView from "./BookshelfView.svelte";
import { BookshelfStore } from "./bookshelf-store";
import { ReaderSettingsStore } from "./reader-settings";
import { FontStore } from "./reader-fonts";
import { ReaderTabController } from "./reader-tab";
import { isSupportedBookFile } from "./book-adapters";

export const READER_FEATURE_ID = "reader";

export function createReaderFeature(iconId: string) {
  return {
    id: READER_FEATURE_ID,
    title: "阅读器",
    icon: iconId,
    defaultSlot: "combined" as const,
  };
}

export class ReaderDockController {
  private store: BookshelfStore;
  private settingsStore: ReaderSettingsStore;
  private fontStore: FontStore;
  private tabs: ReaderTabController;
  private comp: any = null;

  constructor(private plugin: any) {
    this.store = new BookshelfStore(plugin);
    this.settingsStore = new ReaderSettingsStore(plugin);
    this.fontStore = new FontStore(plugin);
    this.tabs = new ReaderTabController(plugin, {
      store: this.store,
      settingsStore: this.settingsStore,
      fontStore: this.fontStore,
    }, (id: string) => this.plugin?.resolveAnnotationLabel?.(id) ?? null);
    // addTab 必须在 onload 同步阶段注册
    this.tabs.register();
  }

  /** 初始化（书架索引 + 阅读设置 + 字体注册表） */
  async init(): Promise<void> {
    await this.store.load();
    await this.settingsStore.load();
    await this.fontStore.load();
  }

  get storeRef(): BookshelfStore {
    return this.store;
  }

  get tabController(): ReaderTabController {
    return this.tabs;
  }

  /** 渲染书架面板（组合栏 Tab / 独立 Dock 共用入口） */
  render(dockElement: HTMLElement): void {
    const contentEl = dockElement.querySelector(
      "#hiword-dock-content"
    ) as HTMLElement | null;
    const target = contentEl ?? dockElement;
    // 销毁旧组件与旧视图，避免重复挂载泄漏
    try {
      this.comp?.$destroy?.();
    } catch {
      /* ignore */
    }
    this.comp = null;
    target.innerHTML = "";
    this.mountShelf(target);
  }

  /** 书架视图（点书 → 打开独立阅读 Tab） */
  private mountShelf(target: HTMLElement): void {
    this.comp = new BookshelfView({
      target,
      props: {
        store: this.store,
        onOpen: (bookId: string) => {
          const meta = this.store.get(bookId);
          void this.tabs.openBookTab(bookId, meta?.title);
        },
      },
    });
  }

  /** 卸载清理：销毁书架组件 + 关闭所有阅读 Tab */
  dispose(): void {
    try {
      this.comp?.$destroy?.();
    } catch {
      /* ignore */
    }
    this.comp = null;
    try {
      this.tabs.dispose();
    } catch {
      /* ignore */
    }
  }

  /** 编程式导入书籍（工具栏/命令可复用） */
  async importBook(file: File): Promise<boolean> {
    if (!isSupportedBookFile(file.name)) return false;
    try {
      await this.store.importBook(file);
      return true;
    } catch (e) {
      console.warn("[REword] 导入书籍失败:", e);
      return false;
    }
  }
}
