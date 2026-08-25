/**
 * 微阅快速批注 —— 核心交互管理器
 * ------------------------------------------------------------------
 * 基于截图「微阅快速批注」重构的批注交互层。
 *
 * 三种快捷创建方式：
 *  1. 快捷键 Alt+Ctrl+C（Mac: Alt+Cmd+C）：选中文字一键批注
 *  2. 拖动鼠标连续批注：按住修饰键拖选，连续创建
 *  3. 浮动工具栏：编辑器选中文字后弹出「批注」按钮
 *
 * 样式系统：
 *  - 7 色 × 5 线型 = 35 种下划线组合
 *  - 弹窗编辑器带富文本工具栏（B/I/U/高亮/列表/任务）
 *
 * 本模块不依赖 SiYuan SDK 细节，通过 IWhaleHost 接口桥接插件能力。
 */

import type { AnnotationItem, AnnotationStyle, AnnotationCategory, ANNOTATION_STYLES } from "./annotation-store.ts";
import { WHALE_COLORS } from "./annotation-store.ts";
import { requestEditSession, releaseEditSession } from "./edit-session.ts";
import { mountAnnEditor, DEFAULT_ANN_TOOLBAR, hasBlockTable, type AnnEditor } from "./ann-editor.ts";
import { confirmDelete } from "./whale-confirm.ts";
import { Disposables } from "../core/disposable.ts";
import { getLogger } from "../core/logger.ts";

// ============ 类型导出（避免循环依赖）============
export type { AnnotationItem, AnnotationStyle, AnnotationCategory };

/** 微阅批注颜色（复用 annotation-store 的 WHALE_COLORS，保持单一来源） */
export const WHALE_COLOR_LIST = WHALE_COLORS;

/** 微阅批注样式定义（2026-08-24 精简为 3 种：高亮 / 直线段 / 波浪线） */
export const WHALE_LINE_STYLES: Record<AnnotationStyle, { label: string; css: string; icon: string; preview: string; hint?: string }> = {
  highlight: { label: "高亮", css: "highlight", icon: "▮", preview: "background-color", hint: "背景标记" },
  solid:  { label: "直线段", css: "solid",  icon: "━", preview: "text-decoration: underline", hint: "一般笔记" },
  wavy:   { label: "波浪线", css: "wavy",  icon: "﹏", preview: "text-decoration-style: wavy", hint: "生词 / 不认识" },
};

/** 宿主接口（由 index.ts 实现） */
export interface IWhaleHost {
  /** 获取当前选中的文本 */
  getSelectionText(): { text: string; blockId: string; docId: string; sentence: string } | null;
  /** 创建/更新批注 */
  upsertAnnotation(params: {
    blockId: string; docId: string; sentence: string;
    selectedText: string; note: string;
    color?: string; style?: AnnotationStyle;
    scope?: "word" | "sentence" | "both";
    lineColor?: string;
    labels?: string[]; tags?: string[];
    category?: AnnotationCategory;
    id?: string;
  }): Promise<AnnotationItem>;
  /** 删除批注 */
  removeAnnotation(id: string): Promise<boolean>;
  /** 跳转到指定块 */
  jumpToBlock(blockId: string): void;
  /** 复制文本 */
  copyText(text: string): void;
  /** 显示通知 */
  showMessage(msg: string, type?: "info" | "success" | "error"): void;
  /** 自定义输入弹窗（替代思源 Electron 被禁用的 window.prompt）。返回输入值，取消返回 null */
  promptInput(message: string, defaultValue?: string): Promise<string | null>;
  /** 获取全部分类标签（2026-08-14 新增） */
  getLabels(): { id: string; name: string; color: string }[];
  /** 新建分类标签（2026-08-14 新增） */
  addLabel(name: string): Promise<{ id: string; name: string; color: string }>;
  /** 重命名分类标签（2026-08-15 新增） */
  renameLabel(id: string, name: string): Promise<void>;
  /** 删除分类标签定义（仅删定义，已标注数据保留，2026-08-15 新增） */
  removeLabel(id: string): Promise<void>;
  /** 循环更换标签颜色（从 LABEL_COLORS 轮转，2026-08-15 新增） */
  cycleLabelColor(id: string): Promise<string>;
  /** 打开标签管理弹窗（2026-08-15 新增） */
  manageLabels(): void;
  /** 获取 AI 设置（2026-08-22 新增,微阅 AI 助手用） */
  getAiSettings(): { apiKey: string; baseUrl: string; model: string; enabled: boolean; [k: string]: any };
  /** 打开 AI 设置弹窗（2026-08-22 新增,无 API Key 时引导用户去设置） */
  openAiSettings(): void;
  /**
   * 打开批注 AI 助手小窗（2026-08-22 新增;2026-08-22 改:parentDialog + 填回逻辑下放）。
   * 由 index.ts 注入(动态 import,避免 whale-manager 直接依赖 ai 模块)
   *   - parentDialog 原批注弹窗(AI 弹窗贴它旁边,原弹窗保持打开)
   *   - onFillBack 由调用方实现"AI 回复 → 编辑器"的填回策略
   */
  openAnnoAiDialog(opts: {
    selectedText: string;
    sentence: string;
    blockId: string;
    docId: string;
    existingNote?: string;
    parentDialog?: HTMLElement;
    onFillBack: (reply: string) => void;
  }): void;
}

/** 批注弹窗配置 */
export interface WhaleAnnotationDialogOptions {
  selectedText: string;
  sentence: string;
  blockId: string;
  docId: string;
  existing?: AnnotationItem;
  /**
   * 预填批注内容(2026-08-22 新增,AI 助手"填回批注"时由 index.ts 传回)。
   * 优先级: prefillNote > existing?.note > ""
   */
  prefillNote?: string;
}

/**
 * 2026-08-15 抽出：批注弹窗 HTML 模板生成（纯函数，便于单测）。
 * 设计要点：
 *  - 紧凑小窗口（外层 .whale-dlg-popup 由调用方包裹；本函数只生成 .whale-dlg 内部）
 *  - 已选原文区**只显示 selectedText**（不抽上下文），与用户期望对齐
 *  - 批注内容**默认空**（不预填 selectedText），placeholder 引导用户填写
 *  - 头部带 data-drag-handle 用于位置拖拽
 */
export function buildWhaleDialogHtml(
  opts: WhaleAnnotationDialogOptions,
  esc: (s: string) => string,
  /**
   * "框架样式"手风琴是否默认展开。
   *  - undefined / true → 渲染时带 `open` 属性（默认展开）
   *  - false → 渲染时**不带** `open` 属性（默认收起）
   * 2026-08-22 新增：解决"收起后重开又被默认展开"的记忆模式 bug。
   * 调用方应基于 `localStorage["hiword-whale-accordion-open"]` 计算后传入。
   */
  isAccordionOpen: boolean = true,
): string {
  const isEdit = !!opts.existing;
  const defaultColor = opts.existing?.color || WHALE_COLOR_LIST[2].value;
  const defaultStyle = opts.existing?.style || "highlight";
  // 2026-08-18 打磨：新建默认 both（高亮+下划线同时生效），视觉更显眼、一次标注即见样式
  const defaultScope = opts.existing?.scope || "both";
  const defaultLineColor = opts.existing?.lineColor || defaultColor;
  // 2026-08-15 改造：弹窗只显示选中词，不抽上下文
  const showSource = opts.selectedText || opts.sentence;
  // 2026-08-22 新增：批注内容预填优先级 prefillNote > existing?.note > ""
  // prefillNote 用于"AI 助手填回批注"时把 AI 生成内容带回编辑器
  const initNote = opts.prefillNote != null && opts.prefillNote !== "" ? opts.prefillNote : (opts.existing?.note || "");
  // 2026-08-15 双维度：高亮/线段独立开关（可只选其一或叠加）
  // 由 scope 反推：word=仅高亮；sentence=仅线段；both=叠加
  const defaultHasHighlight = defaultScope !== "sentence";
  const defaultHasLine = defaultScope === "sentence" || defaultScope === "both";

  return `
      <div class="whale-dlg whale-dlg--popup">
        <!-- 顶部：标题 + 删除（编辑态）/关闭（拖拽区） -->
        <div class="whale-dlg-head" data-drag-handle>
          <span class="whale-dlg-title">微阅批注</span>
          <div class="whale-dlg-head-right">
            ${isEdit ? `<button class="whale-dlg-trash" id="whale-dlg-delete" title="删除批注">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M10 11v6M14 11v6"/></svg>
            </button>` : ""}
            <button class="whale-dlg-close" id="whale-dlg-close" title="关闭">✕</button>
          </div>
        </div>

        <!-- 已选原文（紧凑显示 selectedText） -->
        <div class="whale-dlg-source">
          <span class="whale-dlg-source-icon">📋</span>
          <span class="whale-dlg-source-text whale-dlg-source-text--selected">${esc(showSource)}</span>
        </div>

        <!-- 编辑区：lite Protyle 编辑器（2026-08-17：思源原生格式/快捷键/粘贴零转换；
             选中文字自动唤起思源原生浮动工具栏，见 mountAnnProtyle 的 toolbar 配置） -->
        <div class="whale-dlg-editor-wrap">
          <div class="whale-dlg-editor" id="whale-dlg-editor"></div>
        </div>

        <!-- 框架样式（2026-08-17：合并原「快捷样式/自定义样式」手风琴；2026-08-18 打磨：默认展开，降低首次上色心智成本；2026-08-22 改：open 由参数 isAccordionOpen 控制，记忆模式生效） -->
        <details class="whale-dlg-accordion" id="whale-accordion-styles"${isAccordionOpen ? " open" : ""}>
          <summary class="whale-dlg-more-summary">框架样式</summary>
          <div class="whale-dlg-custom">
            <div class="whale-dlg-custom-row">
              <label class="whale-dlg-custom-toggle" title="启用背景高亮">
                <input type="checkbox" id="whale-dlg-has-highlight" ${defaultHasHighlight ? "checked" : ""} />
                <span>高亮</span>
              </label>
              <div class="whale-dlg-colors" id="whale-dlg-colors">
                ${WHALE_COLOR_LIST.map((c) => `
                  <button class="whale-dlg-color-swatch ${c.value === defaultColor ? "active" : ""}"
                          data-color="${c.value}" style="background:${c.value}" title="背景高亮 · ${c.name}"></button>
                `).join("")}
              </div>
            </div>
            <div class="whale-dlg-custom-row">
              <label class="whale-dlg-custom-toggle" title="启用下划线">
                <input type="checkbox" id="whale-dlg-has-line" ${defaultHasLine ? "checked" : ""} />
                <span>线段</span>
              </label>
              <div class="whale-dlg-style-btns" id="whale-dlg-style-btns">
                ${Object.entries(WHALE_LINE_STYLES).map(([key, val]) => `
                  <button class="whale-dlg-style-aa ${key === defaultStyle ? "active" : ""}"
                          data-style="${key}" title="${val.label} · ${val.hint || ""}">
                    <span style="${key === "highlight" ? `background:${defaultLineColor};color:#fff` : `text-decoration-line:underline;text-decoration-style:${val.css};text-decoration-color:${defaultLineColor};text-decoration-thickness:2px;color:${defaultLineColor}`}">Aa</span>
                  </button>
                `).join("")}
              </div>
              <div class="whale-dlg-colors" id="whale-dlg-line-colors">
                ${WHALE_COLOR_LIST.map((c) => `
                  <button class="whale-dlg-color-swatch ${c.value === defaultLineColor ? "active" : ""}"
                          data-line-color="${c.value}" style="background:${c.value}" title="线段颜色 · ${c.name}"></button>
                `).join("")}
              </div>
            </div>
            <div class="whale-dlg-custom-row">
              <span class="whale-dlg-section-label">标签</span>
              <div class="whale-dlg-tags" id="whale-dlg-tags"></div>
            </div>
          </div>
        </details>

        <!-- 底部：AI 助手 + 仅标注 + 保存（复制走原生右键/⌘C，2026-08-17 去底部复制按钮） -->
        <div class="whale-dlg-foot">
          <button class="whale-dlg-btn whale-dlg-btn--ai" id="whale-dlg-ai" title="用 AI 助手改进批注（弹小窗,可填回）">🤖 AI</button>
          <span class="whale-dlg-spacer"></span>
          <button class="whale-dlg-btn whale-dlg-btn--ghost" id="whale-dlg-annotate-only" title="只上色 / 画线 / 打标签，不写文字">只上色</button>
          <button class="whale-dlg-btn whale-dlg-btn--primary" id="whale-dlg-ok">${isEdit ? "保存修改" : "保存"}</button>
        </div>

        <!-- 2026-08-22 新增：底部 resize 手柄（拖动调整弹窗高度） -->
        <div class="whale-dlg-resize-handle" id="whale-dlg-resize-handle" title="拖动调整高度"></div>

        <input type="hidden" id="whale-dlg-id" value="${opts.existing?.id || ""}" />
        <input type="hidden" id="whale-dlg-block" value="${opts.blockId}" />
        <input type="hidden" id="whale-dlg-doc" value="${opts.docId}" />
        <input type="hidden" id="whale-dlg-sentence" value="${esc(opts.sentence)}" />
        <input type="hidden" id="whale-dlg-selected" value="${esc(opts.selectedText)}" />
        <input type="hidden" id="whale-dlg-note-init" value="${esc(initNote)}" />
      </div>
    `;
}

/**
 * 微阅批注管理器
 * ---------------
 * 管理浮动工具栏、快捷键绑定、弹窗编辑器、样式选择器。
 */
export class WhaleAnnotationManager {
  /** 批注编辑器打开标志（弹窗 + 汇总面板编辑态共用）：原生工具栏钩子据此跳过，防嵌套「批注」入口（2026-08-17） */
  static editorOpen = false;
  private host: IWhaleHost;
  private floatingToolbar: HTMLElement | null = null;
  private activeDialog: HTMLElement | null = null;
  /** 批注 note 编辑器：lite Protyle 封装（2026-08-17 接入思源原生编辑器） */
  private annEditor: AnnEditor | null = null;
  private isDragging = false;
  private dragStartPos = { x: 0, y: 0 };
  private dragAnnotations: string[] = []; // 拖动批注队列
  private styleMenuOpen = false; // 样式菜单打开状态
  private _styleMenuCloseHandler: ((e: MouseEvent) => void) | null = null; // 样式菜单外部点击关闭的全局监听
  /** 生命周期托管：统一释放全局监听（根因修复 #2） */
  private disposables = new Disposables();

  constructor(host: IWhaleHost) {
    this.host = host;
  }

  /**
   * 初始化：绑定全局事件（快捷键、选区变化、拖动）
   * 在 plugin.onload() 中调用一次。
   */
  init(): void {
    this.bindGlobalShortcut();
    this.bindSelectionChange();
    this.bindDragAnnotation();
    getLogger().info("[REword-MicroRead] 微阅批注管理器已初始化");
  }

  // ==================== 1. 快捷键创建 ====================

  /** 绑定全局快捷键 Alt+Ctrl+C / Alt+Cmd+C */
  private bindGlobalShortcut(): void {
    this.disposables.addEventListener(document, "keydown", (e: KeyboardEvent) => {
      // Alt + Ctrl/Cmd + C
      if (e.altKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        e.stopPropagation();
        this.createFromSelection();
      }
    });
  }

  // ==================== 2. 浮动工具栏 ====================

  /** 监听思源编辑器内的 mouseup，显示/隐藏浮动工具栏 */
  private bindSelectionChange(): void {
    this.disposables.addEventListener(document, "mouseup", (e: MouseEvent) => {
      // 延迟一帧等 selection 更新
      requestAnimationFrame(() => {
        this.handleSelection(e);
      });
    });

    // 点击其他区域隐藏工具栏
    this.disposables.addEventListener(document, "mousedown", (e: MouseEvent) => {
      if (this.floatingToolbar && !this.floatingToolbar.contains(e.target as Node)) {
        this.hideFloatingToolbar();
      }
    });
  }

  private handleSelection(_e: MouseEvent): void {
    // v3：whale 浮动工具栏整体停用。
    //  - 思源编辑器内选字 → 思源原生 Protyle 工具栏已含「查词典/提取/批注」
    //    三个 RE word 按钮，无需重复工具栏，避免重叠冲突；
    //  - 插件自身面板（批注/词库）内选字 → 无法定位思源块
    //    （getSelectionBlockId 只认 .protyle-wysiwyg），创建批注无意义。
    // 因此这里始终隐藏，保留 createFloatingToolbar 仅为兼容旧调用。
    this.hideFloatingToolbar();
  }

  /** 显示浮动工具栏（在选区上方） */
  private showFloatingToolbar(rect: DOMRect, _text: string): void {
    if (!this.floatingToolbar) {
      this.createFloatingToolbar();
    }
    if (!this.floatingToolbar) return;

    // 定位：选区上方居中
    const x = rect.left + rect.width / 2 - 100; // 工具栏宽度约 200px
    const y = rect.top - 48; // 工具栏上方

    this.floatingToolbar.style.left = `${Math.max(8, x)}px`;
    this.floatingToolbar.style.top = `${Math.max(8, y)}px`;
    this.floatingToolbar.classList.add("whale-toolbar--visible");
  }

  private hideFloatingToolbar(): void {
    this.floatingToolbar?.classList.remove("whale-toolbar--visible");
  }

  /** 创建浮动工具栏 DOM（只创建一次） */
  private createFloatingToolbar(): void {
    const toolbar = document.createElement("div");
    toolbar.className = "whale-toolbar";
    toolbar.id = "whale-floating-toolbar";
    toolbar.innerHTML = `
      <button class="whale-toolbar-btn" id="whale-tb-copy" title="复制">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        复制
      </button>
      <div class="whale-toolbar-divider"></div>
      <button class="whale-toolbar-btn whale-toolbar-btn--primary" id="whale-tb-annotate" title="添加批注">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        批注
      </button>
      <button class="whale-toolbar-btn" id="whale-tb-style" title="快速样式">
        <span class="whale-style-preview" id="whale-tb-style-preview">━</span>
        <span>样式</span>
        <span class="whale-toolbar-arrow">▾</span>
      </button>
    `;
    document.body.appendChild(toolbar);
    this.floatingToolbar = toolbar;

    // 绑定按钮事件
    toolbar.querySelector("#whale-tb-copy")?.addEventListener("click", () => {
      const text = window.getSelection()?.toString().trim() || "";
      if (text) this.host.copyText(text);
      this.hideFloatingToolbar();
    });

    toolbar.querySelector("#whale-tb-annotate")?.addEventListener("click", () => {
      this.createFromSelection();
      this.hideFloatingToolbar();
    });

    // 快速样式子菜单
    const styleBtn = toolbar.querySelector("#whale-tb-style");
    styleBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.styleMenuOpen) {
        this.hideStyleMenu();
        this.styleMenuOpen = false;
      } else {
        this.showQuickStyleMenu(styleBtn as HTMLElement);
        this.styleMenuOpen = true;
      }
    });
  }

  // ==================== 3. 样式选择器 ====================

  /** 显示快速样式子菜单（7×5 颜色×线型矩阵的精简版） */
  private showQuickStyleMenu(anchor: HTMLElement): void {
    // 移除已有菜单
    this.hideStyleMenu();

    const menu = document.createElement("div");
    menu.className = "whale-style-menu";
    menu.id = "whale-style-menu";

    // 线性行
    const styles = Object.entries(WHALE_LINE_STYLES).map(([key, val]) => `
      <button class="whale-style-line-btn ${key === "solid" ? "active" : ""}" data-style="${key}" title="${val.label}">
        <span class="whale-style-line-icon">${val.icon}</span>
        <span>${val.label}</span>
      </button>
    `).join("");

    menu.innerHTML = `
      <div class="whale-style-menu-header">下划线样式</div>
      <div class="whale-style-lines">${styles}</div>
      <div class="whale-style-menu-header">颜色</div>
      <div class="whale-style-colors">
        ${WHALE_COLOR_LIST.map((c, i) =>
          `<button class="whale-style-color-dot ${i === 2 ? 'active' : ''}" data-color="${c.value}" style="background:${c.value}" title="${c.name}"></button>`
        ).join("")}
      </div>
    `;

    document.body.appendChild(menu);

    // 定位到锚点下方
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;

    // 点击外部关闭（经 disposables 托管，卸载时可靠移除；同时记录 handler 以便任何关闭路径都能移除，根因修复 #2）
    const closeMenu = () => {
      document.removeEventListener("mousedown", closeMenu);
      this._styleMenuCloseHandler = null;
      this.hideStyleMenu();
      this.styleMenuOpen = false;
    };
    this._styleMenuCloseHandler = closeMenu;
    const menuTimer = setTimeout(() => {
      this.disposables.addEventListener(document, "mousedown", closeMenu, { once: true });
    }, 10);
    this.disposables.addTimer(menuTimer);

    // 线型选择
    menu.querySelectorAll(".whale-style-line-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        menu.querySelectorAll(".whale-style-line-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const style = (btn as HTMLElement).dataset.style || "solid";
        this.updateStylePreview(style);
      });
    });

    // 颜色选择
    menu.querySelectorAll(".whale-style-color-dot").forEach((btn) => {
      btn.addEventListener("click", () => {
        menu.querySelectorAll(".whale-style-color-dot").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
  }

  private hideStyleMenu(): void {
    const menu = document.getElementById("whale-style-menu");
    menu?.remove();
    // 任何关闭路径都顺手移除外部点击监听，避免跨重载累积（根因修复 #2）
    if (this._styleMenuCloseHandler) {
      document.removeEventListener("mousedown", this._styleMenuCloseHandler);
      this._styleMenuCloseHandler = null;
    }
  }

  private updateStylePreview(_style: string): void {
    const preview = document.getElementById("whale-tb-style-preview");
    if (preview) {
      // TODO: 根据 style 更新预览图标
    }
  }

  // ==================== 4. 弹窗编辑器（微阅风格） ====================

  /**
   * 从当前选区发起批注（入口方法）
   * 由快捷键 / 浮动工具栏 / 外部调用触发。
   */
  createFromSelection(): void {
    const sel = this.host.getSelectionText();
    if (!sel) {
      this.host.showMessage("请先框选要批注的内容", "info");
      return;
    }

    this.showWhaleDialog({
      selectedText: sel.text,
      sentence: sel.sentence,
      blockId: sel.blockId,
      docId: sel.docId,
    });
  }

  /**
   * 显示微阅风格批注弹窗（截图 1 对齐版）
   * 布局：
   *  - 头部：标题「批注」+ 5 个 Aa 线型按钮（当前选中紫色边框）+ 红色垃圾桶
   *  - 编辑区：contenteditable 富文本（支持列表 / 加粗等）
   *  - 更多选项（折叠）：快捷预设 6 套 → 颜色 → 标签
   *  - 底部：左下角 [复制][粘贴格式][清除格式] + 右下角 [保存]
   */
  showWhaleDialog(opts: WhaleAnnotationDialogOptions): void {
    // 2026-08-18（D8）：先关旧弹窗（释放其 dialog 会话），再申请新会话；
    // 若面板/浮层正在编辑（持有非 dialog 会话），requestEditSession 返回 false → 拦截重复编辑。
    if (this.activeDialog) this.closeDialog();
    if (!requestEditSession("dialog")) {
      this.host?.showMessage("已在别处编辑，请先完成当前编辑", "info");
      return;
    }
    // 批注编辑器打开标志改由 requestEditSession 统一维护（D6/D8），此处不再直接赋值

    // 2026-08-22 改：前移 localStorage 读取，"框架样式"手风琴状态作为模板参数传入，
    // 模板首次渲染即正确状态，无视觉闪烁，杜绝"收起后重开被默认展开"的 race bug。
    const ACCORDION_KEY = "hiword-whale-accordion-open";
    const isAccordionOpen = (() => {
      try { return localStorage.getItem(ACCORDION_KEY) !== "false"; }
      catch { return true; }
    })();

    const dlg = document.createElement("div");
    // 2026-08-15 改造：外层用 whale-dlg-popup（fixed 定位紧凑窗口，仿查词悬浮弹窗）。
    // 旧 .whale-dlg-overlay（全屏遮罩中央弹窗）已废弃，仅 .whale-dlg-label-mgmt-overlay 等保留。
    dlg.className = "whale-dlg-popup";
    dlg.id = "whale-annotation-dialog";
    dlg.innerHTML = buildWhaleDialogHtml(opts, (s) => this.escapeHtml(s), isAccordionOpen);

    document.body.appendChild(dlg);
    this.activeDialog = dlg;

    // 2026-08-17：弹窗入场动画使用 transform（创建 containing block），
    // 会让思源原生浮动工具栏（position:fixed）错误地相对弹窗定位并被 overflow 裁剪。
    // 动画结束后移除 transform + animation，恢复工具栏相对视口定位。
    const dlgInner = dlg.querySelector(".whale-dlg") as HTMLElement | null;
    dlgInner?.addEventListener("animationend", () => {
      dlgInner.style.transform = "none";
      dlgInner.style.animation = "none";
    }, { once: true });

    // 2026-08-15 新增：浮动定位 + 拖拽绑定（仿查词悬浮弹窗）
    this.positionWhalePopup(dlg);
    this.bindWhalePopupDrag(dlg);
    // 2026-08-15 新增：边缘/四角缩放（8 把手 + 拖拽改尺寸，内容不变形）
    this.bindWhalePopupResize(dlg);

    // 状态（2026-08-15：defaultXxx 从 buildWhaleDialogHtml 内部计算移到这里复用，
    // 避免模板和状态两端重复，且 HTML 渲染与事件绑定共用同一份默认值）
    const isEdit = !!opts.existing;
    const defaultColor = opts.existing?.color || WHALE_COLOR_LIST[2].value;
    const defaultStyle = opts.existing?.style || "highlight";
    // 2026-08-18 打磨：与 buildWhaleDialogHtml 对齐，新建默认 both
    const defaultScope = opts.existing?.scope || "both";
    const defaultLineColor = opts.existing?.lineColor || defaultColor;
    const defaultLabels = opts.existing?.labels || [];
    const defaultTags = opts.existing?.tags || [];

    let selectedColor = defaultColor;
    let selectedStyle: AnnotationStyle = defaultStyle as AnnotationStyle;
    let selectedLineColor = defaultLineColor;
    const selectedLabels = new Set<string>(defaultLabels);
    const selectedTags = new Set<string>(defaultTags);

    // 2026-08-15 双维度：高亮/线段独立开关（checkbox 实时读取，保存时据此算 scope）
    const computeScope = (): "word" | "sentence" | "both" => {
      const h = (dlg.querySelector("#whale-dlg-has-highlight") as HTMLInputElement | null)?.checked ?? true;
      const l = (dlg.querySelector("#whale-dlg-has-line") as HTMLInputElement | null)?.checked ?? true;
      if (h && l) return "both";
      if (l) return "sentence";
      return "word";
    };

    // 2026-08-17：挂载 lite Protyle 编辑器（思源原生快捷键/工具栏/粘贴零转换）。
    // 延迟到弹窗可见（有尺寸）后挂载，内部带重试；失败自动回退 contenteditable。
    this.mountAnnProtyle(dlg);

    const editor = dlg.querySelector("#whale-dlg-editor") as HTMLElement;

    // ====== 线型 Aa 按钮（线段颜色上色） ======
    const refreshAaStyles = () => {
      dlg.querySelectorAll(".whale-dlg-style-aa").forEach((b) => {
        const el = b as HTMLElement;
        const st = el.dataset.style || "solid";
        el.classList.toggle("active", st === selectedStyle);
        const span = el.querySelector("span") as HTMLElement | null;
        if (span) {
          span.style.color = selectedLineColor;
          span.style.textDecorationColor = selectedLineColor;
          span.style.textDecorationStyle =
            st === "wavy" ? "wavy" : "solid";
        }
      });
    };
    dlg.querySelectorAll("#whale-dlg-style-btns .whale-dlg-style-aa").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedStyle = (btn as HTMLElement).dataset.style as AnnotationStyle || "highlight";
        refreshAaStyles();
      });
    });

    // ====== 背景色（高亮） ======
    dlg.querySelectorAll("#whale-dlg-colors .whale-dlg-color-swatch").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedColor = (btn as HTMLElement).dataset.color || defaultColor;
        dlg.querySelectorAll("#whale-dlg-colors .whale-dlg-color-swatch").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        refreshAaStyles();
      });
    });

    // ====== 线段颜色（独立于背景色，2026-08-15 新增） ======
    dlg.querySelectorAll("#whale-dlg-line-colors .whale-dlg-color-swatch").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedLineColor = (btn as HTMLElement).dataset.lineColor || defaultLineColor;
        dlg.querySelectorAll("#whale-dlg-line-colors .whale-dlg-color-swatch").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        refreshAaStyles();
      });
    });

    // ====== 标签多选（2026-08-14 改：分类标签 chips，host.getLabels 数据驱动）======
    const renderLabelChips = () => {
      const wrap = dlg.querySelector("#whale-dlg-tags");
      if (!wrap) return;
      const labels = this.host.getLabels() || [];
      const chips = labels
        .map((l) => `<button type="button" class="whale-dlg-tag-chip ${selectedLabels.has(l.id) ? "active" : ""}" data-label="${l.id}" style="--tag-color:${l.color || "#9ca3af"}">#${l.name}</button>`)
        .join("");
      const addBtn = `<button type="button" class="whale-dlg-tag-chip whale-dlg-tag-add" id="whale-dlg-label-add">+ 新建标签</button>`;
      wrap.innerHTML = `<span class="whale-dlg-section-label">标签</span>${chips}${addBtn}`;
      // 重新绑定 chips 点击
      wrap.querySelectorAll("[data-label]").forEach((b) => {
        b.addEventListener("click", () => {
          const id = (b as HTMLElement).dataset.label || "";
          if (selectedLabels.has(id)) { selectedLabels.delete(id); b.classList.remove("active"); }
          else { selectedLabels.add(id); b.classList.add("active"); }
        });
      });
      // 新建标签
      wrap.querySelector("#whale-dlg-label-add")?.addEventListener("click", async () => {
        const name = await this.host.promptInput("新标签名称（如 口语 / 作文素材）：", "");
        if (!name || !name.trim()) return;
        const created = await this.host.addLabel(name.trim());
        if (created) {
          selectedLabels.add(created.id);
          renderLabelChips(); // 重渲染并自动选中
        }
      });
    };
    renderLabelChips();

    // ====== 2026-08-22 改：框架样式手风记忆模式（2026-08-22 bug 修复）======
    // 旧实现"先 render 再 removeAttribute"导致视觉闪烁 + 偶尔 race。
    // 新实现：localStorage 在 buildHtml 之前就读好，作为模板参数传入，
    // 模板首次渲染即正确状态；这里只保留 toggle 监听，每次切换时写回。
    const accordion = dlg.querySelector("#whale-accordion-styles") as HTMLDetailsElement | null;
    accordion?.addEventListener("toggle", () => {
      try {
        localStorage.setItem(ACCORDION_KEY, accordion.open ? "true" : "false");
      } catch {
        /* 隐私模式等 localStorage 不可用时静默忽略 */
      }
    });

    // ====== 2026-08-22 新增：底部 resize 手柄（拖动调整编辑区高度）======
    const resizeHandle = dlg.querySelector("#whale-dlg-resize-handle") as HTMLElement | null;
    const innerDlg = dlg.querySelector(".whale-dlg") as HTMLElement | null;
    if (resizeHandle && innerDlg) {
      let resizing = false;
      let startY = 0;
      let startHeight = 0;
      const startResize = (e: MouseEvent) => {
        e.preventDefault();
        resizing = true;
        startY = e.clientY;
        startHeight = innerDlg!.offsetHeight;
        resizeHandle!.classList.add("active");
        document.body.classList.add("hiword-resizing");
      };
      const onMove = (e: MouseEvent) => {
        if (!resizing) return;
        const dy = e.clientY - startY;
        const newH = Math.max(200, startHeight + dy); // 最小 200px
        innerDlg!.style.height = `${newH}px`;
        innerDlg!.style.maxHeight = "none";
        innerDlg!.style.overflowY = "auto";
      };
      const onUp = () => {
        if (!resizing) return;
        resizing = false;
        resizeHandle!.classList.remove("active");
        document.body.classList.remove("hiword-resizing");
      };
      resizeHandle.addEventListener("mousedown", startResize);
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      (dlg as any).__resizeClean = () => {
        resizeHandle.removeEventListener("mousedown", startResize);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
    }

    // ====== 关闭 / 删除 ======
    dlg.querySelector("#whale-dlg-close")?.addEventListener("click", () => this.closeDialog());
    // 2026-08-15 改造：弹窗不再是全屏遮罩，移除 mousedown 关闭逻辑（避免误触）。
    // 改为 ESC 关闭 + 关闭按钮。
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.body.contains(dlg)) this.closeDialog();
    };
    document.addEventListener("keydown", escHandler);
    (dlg as any).__escHandler = escHandler; // 关闭时清理
    dlg.querySelector("#whale-dlg-delete")?.addEventListener("click", async () => {
      const id = (dlg.querySelector("#whale-dlg-id") as HTMLInputElement)?.value;
      if (!id) {
        this.host.showMessage("未找到批注 ID，无法删除", "error");
        return;
      }
      // v4：自定义确认弹窗，防误删
      const ok = await confirmDelete("确定删除这条批注？");
      if (!ok) return;
      try {
        const removed = await this.host.removeAnnotation(id);
        if (removed) {
          this.host.showMessage("批注已删除", "success");
          this.closeDialog();
        } else {
          this.host.showMessage("删除失败：批注不存在或已删除", "error");
        }
      } catch (e: any) {
        this.host.showMessage(`删除失败：${e?.message || e}`, "error");
      }
    });

    // ====== 保存 ======
    // 公共保存函数（2026-08-15 抽出，供「保存」与「仅标注」共用）
    const doSave = async (note: string) => {
      try {
        await this.host.upsertAnnotation({
          id: (dlg.querySelector("#whale-dlg-id") as HTMLInputElement)?.value || undefined,
          blockId: (dlg.querySelector("#whale-dlg-block") as HTMLInputElement)?.value,
          docId: (dlg.querySelector("#whale-dlg-doc") as HTMLInputElement)?.value || opts.docId,
          sentence: (dlg.querySelector("#whale-dlg-sentence") as HTMLInputElement)?.value || opts.sentence,
          selectedText: (dlg.querySelector("#whale-dlg-selected") as HTMLInputElement)?.value || opts.selectedText,
          note,
          color: selectedColor,
          style: selectedStyle,
          scope: computeScope(), // 2026-08-15：按高亮/线段开关算 word/sentence/both
          lineColor: selectedLineColor,
          labels: [...selectedLabels],
          tags: [...selectedTags],
        });
        this.host.showMessage(isEdit ? "批注已更新" : "批注已添加", "success");
        this.closeDialog();
      } catch (err: any) {
        this.host.showMessage(`保存失败：${err?.message || err}`, "error");
      }
    };

    dlg.querySelector("#whale-dlg-ok")?.addEventListener("click", async () => {
      // 2026-08-17：Protyle 模式用 BlockDOM2Md 序列化为 Kramdown 入库（思源原生格式），
      // 渲染端用 Lute 渲染；回退 contenteditable 保持旧 innerHTML + sanitizeHtml 兼容。
      const note = this.readAnnEditorContent(dlg);
      if (!note || !note.replace(/<[^>]*>/g, "").trim()) {
        // 序列化后纯文本为空（如只有空标签）→ 视为未填
        this.host.showMessage("批注内容不能为空（或点「仅标注」只上色不写文字）", "info");
        const el = this.annEditor?.el || (dlg.querySelector("#whale-dlg-editor") as HTMLElement | null);
        el?.focus();
        return;
      }
      await doSave(note);
    });

    // ====== 仅标注（2026-08-15 新增：只上色/画线/打标签，不写文字）======
    dlg.querySelector("#whale-dlg-annotate-only")?.addEventListener("click", async () => {
      await doSave(""); // note 空 = 纯颜色标注
    });

    // ====== AI 助手（2026-08-22 新增；2026-08-22 改：原批注弹窗保留,不就关）======
    // 设计要点：
    //  - 点击 AI 按钮 → 不关闭批注弹窗(用户可继续观察/编辑)
    //  - AI 弹窗出现在批注弹窗旁边(anno-ai-dialog 内部用 parentDialog 定位)
    //  - AI 弹窗"填回批注" → 就地写编辑器(AnnEditor.write),原批注弹窗保持打开
    //  - 关闭 AI 弹窗(×/ESC/复制/取消)→ 原批注弹窗保持打开
    const readCurrentNote = () => this.readAnnEditorContent(dlg);
    dlg.querySelector("#whale-dlg-ai")?.addEventListener("click", () => {
      const currentNote = readCurrentNote();
      // 闭包捕获 activeDialog(若用户在 AI 弹窗期间手动关了批注弹窗,后续 setNoteContent 安全降级)
      const capturedDialog = this.activeDialog;
      try {
        this.host.openAnnoAiDialog({
          selectedText: opts.selectedText,
          sentence: opts.sentence,
          blockId: opts.blockId,
          docId: opts.docId,
          existingNote: currentNote,
          // 2026-08-22 改：原批注弹窗保持打开,传给 AI 弹窗用于定位
          parentDialog: dlg,
          onFillBack: (reply: string) => {
            // 2026-08-22 改：就地写编辑器,不再关闭/重开批注弹窗
            if (!capturedDialog || !document.body.contains(capturedDialog)) {
              this.host.showMessage("批注弹窗已关闭,无法填回", "error");
              return;
            }
            const ok = this.setNoteContent(reply);
            if (ok) {
              this.host.showMessage("AI 回复已填入批注", "success");
            } else {
              this.host.showMessage("填回批注失败：编辑器未就绪", "error");
            }
          },
        });
      } catch (e: any) {
        this.host.showMessage(`打开 AI 助手失败: ${e?.message || e}`, "error");
      }
    });

    // Ctrl/Cmd + Enter 快捷保存（capture 阶段，Protyle 可能 stopPropagation）
    editor?.addEventListener("keydown", (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        (dlg.querySelector("#whale-dlg-ok") as HTMLElement)?.click();
      }
    }, true);
  }

  /** 关闭并销毁弹窗 */
  closeDialog(): void {
    // 2026-08-17：先销毁 lite Protyle 编辑器（清理观察器/内核监听，避免 detached 元素崩溃）
    this.destroyAnnProtyle();
    // 2026-08-18（D6/D8）：释放全局编辑会话（仅当持有 dialog 会话时生效，避免误清面板编辑态）
    releaseEditSession("dialog");
    // 清理可能挂在 dialog 上的 ESC 监听 + 拖拽监听 + 缩放监听（2026-08-15 新增 resize）
    if (this.activeDialog) {
      const eh = (this.activeDialog as any).__escHandler;
      if (eh) document.removeEventListener("keydown", eh);
      const dc = (this.activeDialog as any).__dragClean;
      if (dc) dc();
      const rc = (this.activeDialog as any).__resizeClean;
      if (rc) rc();
    }
    this.activeDialog?.remove();
    this.activeDialog = null;
  }

  // ==================== 2026-08-17：lite Protyle 编辑器（思源原生文本样式）====================

  /**
   * 挂载 lite Protyle 作为批注 note 编辑器（委托 AnnEditor，2026-08-17 抽公共组件）。
   *  - 复用思源 Protyle 引擎：快捷键（⌘B/⌘I/⌘U…）、粘贴富文本零转换、块引用/标签/公式等原生支持；
   *  - 元素需进入布局且有尺寸才能挂载（隐藏容器零尺寸会崩），AnnEditor 内部 rAF 重试；
   *  - 构造失败回退 contenteditable（保持旧行为）。
   */
  private mountAnnProtyle(dlg: HTMLElement): void {
    const el = dlg.querySelector("#whale-dlg-editor") as HTMLElement | null;
    if (!el) return;

    const app = (window as any).siyuan?.ws?.app;
    const initial = (dlg.querySelector("#whale-dlg-note-init") as HTMLInputElement | null)?.value || "";
    // 2026-08-19：含表格的批注在 lite 编辑态下仅支持单元格文本编辑，给出能力提示
    if (hasBlockTable(initial)) {
      const hint = document.createElement("div");
      hint.className = "ann-table-edit-hint";
      hint.textContent = "表格支持单元格文字编辑；增删行列请在文档中编辑。";
      el.insertAdjacentElement("beforebegin", hint);
    }
    this.annEditor = mountAnnEditor(el, {
      app,
      initial,
      // 2026-08-19：统一用 DEFAULT_ANN_TOOLBAR（含 heading/color/text/strong/em 等），
      // 选中文字自动唤起思源原生浮动栏；REword 按钮经 editorOpen 守卫跳过，不会出现在批注编辑区。
      // 注：原 (window).siyuan?.config?.editor?.toolbar 字段实际不存在，属死代码。
      toolbar: DEFAULT_ANN_TOOLBAR,
      onEmptyChange: (empty) => el.classList.toggle("whale-dlg-editor--empty", empty),
    });
  }

  /** 销毁批注 Protyle（弹窗关闭时调用，AnnEditor 内部清理 MutationObserver 与内核监听） */
  private destroyAnnProtyle(): void {
    this.annEditor?.destroy();
    this.annEditor = null;
  }

  /**
   * 读取批注编辑器内容（委托 AnnEditor）：
   *  - Protyle 模式：BlockDOM2Md 序列化为 Kramdown（思源原生，含块引用/标签/公式）；
   *  - 回退 contenteditable：innerHTML → sanitizeHtml（旧行为）。
   */
  private readAnnEditorContent(dlg: HTMLElement): string {
    if (this.annEditor) return this.annEditor.read();
    const el = dlg.querySelector("#whale-dlg-editor") as HTMLElement | null;
    return el?.innerText?.trim() || "";
  }

  /**
   * 2026-08-22 新增：就地写入批注编辑器（AI 助手「填回批注」用）。
   * 不重建 Protyle,只调 AnnEditor.write() 替换内容；
   * 弹窗保持打开,用户可在 AI 回复基础上继续手改。
   * @returns 是否写入成功
   */
  setNoteContent(note: string): boolean {
    if (!this.activeDialog) return false;
    if (this.annEditor) {
      this.annEditor.write(note);
      return true;
    }
    // 回退 contenteditable 模式（旧实现兼容）
    const el = this.activeDialog.querySelector("#whale-dlg-editor") as HTMLElement | null;
    if (!el) return false;
    el.innerHTML = this.escapeHtml(note);
    return true;
  }

  /**
   * 2026-08-22 改：批注弹窗浮动定位。避让选区本身，依次尝试 4 个方位：
   *   右 → 下 → 上 → 左 → 居中
   * 设计要点：
   *  - 弹窗不再压在选区上（之前 `left = anchorRect.right - width + 10` 会盖住选区）
   *  - 优先右侧（用户视觉上"原选区 + 弹窗"从左到右）
   *  - 都不够时居中偏上兜底
   * 不依赖外部 anchor 参数，直接读 window.getSelection() 的 Range。
   */
  private positionWhalePopup(popup: HTMLElement): void {
    const sel = window.getSelection();
    let anchorRect: DOMRect | null = null;
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const rects = range.getClientRects();
      anchorRect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
    }
    const width = Math.min(440, window.innerWidth - 20);
    const dlgHeight = 360; // 估算高度（实际渲染后会自适应）
    const margin = 12; // 与选区的间距
    popup.style.width = `${width}px`;

    if (anchorRect) {
      // 四个方向的可视空间
      const spaceRight = window.innerWidth - anchorRect.right - margin;
      const spaceLeft = anchorRect.left - margin;
      const spaceBottom = window.innerHeight - anchorRect.bottom - margin;
      const spaceTop = anchorRect.top - margin;

      let left = 0;
      let top = 0;
      let placed = false;

      // 1) 优先右侧
      if (spaceRight >= width) {
        left = anchorRect.right + margin;
        top = Math.max(margin, anchorRect.top);
        placed = true;
      }
      // 2) 选区下方
      else if (spaceBottom >= dlgHeight) {
        left = anchorRect.left;
        top = anchorRect.bottom + margin;
        placed = true;
      }
      // 3) 选区上方
      else if (spaceTop >= dlgHeight) {
        left = anchorRect.left;
        top = anchorRect.top - dlgHeight - margin;
        placed = true;
      }
      // 4) 选区左侧
      else if (spaceLeft >= width) {
        left = anchorRect.left - width - margin;
        top = Math.max(margin, anchorRect.top);
        placed = true;
      }

      if (placed) {
        // 边界保护（防止极端窄屏溢出）
        left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
        top = Math.max(margin, Math.min(top, window.innerHeight - dlgHeight - margin));
        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
        // 清除之前可能残留的 transform（之前无选区兜底设了 translateX(-50%)）
        popup.style.transform = "none";
      } else {
        // 都不够 → 居中偏上
        popup.style.left = "50%";
        popup.style.transform = "translateX(-50%)";
        popup.style.top = "80px";
      }
    } else {
      // 无选区：居中偏上
      popup.style.left = "50%";
      popup.style.transform = "translateX(-50%)";
      popup.style.top = "80px";
    }
    popup.style.maxHeight = `${Math.min(560, window.innerHeight - 40)}px`;
  }

  /**
   * 2026-08-15 新增：批注弹窗拖拽。
   *  - 仅 [data-drag-handle] 元素（弹窗头部）可拖，避免误拖正文工具栏/按钮；
   *  - 拖拽时统一用 left/top 定位（清除可能存在的 transform/bottom）；
   *  - 视口边界限制：不拖出屏幕；
   *  - 拖拽期间 document 级 user-select:none 防止文字选中污染选区。
   */
  private bindWhalePopupDrag(popup: HTMLElement): void {
    const handle = popup.querySelector("[data-drag-handle]") as HTMLElement | null;
    if (!handle) return;
    handle.style.cursor = "move";
    let dragging = false;
    let startX = 0, startY = 0;
    let originLeft = 0, originTop = 0;
    const startDrag = (e: MouseEvent) => {
      // 仅头部按钮（如关闭）不触发拖拽
      if ((e.target as HTMLElement).closest("button")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = popup.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      // 切换到 left/top 定位
      popup.style.left = `${originLeft}px`;
      popup.style.top = `${originTop}px`;
      popup.style.transform = "none";
      popup.style.bottom = "auto";
      document.body.classList.add("hiword-dragging");
      e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const popupW = popup.offsetWidth;
      const popupH = popup.offsetHeight;
      const maxLeft = window.innerWidth - popupW - 6;
      const maxTop = window.innerHeight - popupH - 6;
      popup.style.left = `${Math.max(6, Math.min(maxLeft, originLeft + dx))}px`;
      popup.style.top = `${Math.max(6, Math.min(maxTop, originTop + dy))}px`;
    };
    const onUp = () => {
      dragging = false;
      document.body.classList.remove("hiword-dragging");
    };
    handle.addEventListener("mousedown", startDrag);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    // 关闭时清理拖拽监听
    (popup as any).__dragClean = () => {
      handle.removeEventListener("mousedown", startDrag);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }

  /**
   * 2026-08-15 新增：批注弹窗边缘/四角缩放。
   * - 8 把手（4 边 + 4 角），鼠标光标按方向变化（n / e / s / w / ne / nw / se / sw）
   * - mousedown 在把手上 → mousemove 改 width/height + left/top（保持视觉边）
   * - 不影响内部元素：弹窗内部用普通 HTML 布局 + 字体自适应宽度 + 固定尺寸控件（图标/按钮），
   *   缩放过程中文字自然换行不变形、图标不拉伸
   * - 边界限制：最小 320x200，最大 视口 - 40
   * - 不与拖拽头部冲突：把手指针 events:auto，但 mousemove 不阻止头部拖拽（只阻止自身）
   */
  private bindWhalePopupResize(popup: HTMLElement): void {
    const HANDLES: Array<["n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw", string]> = [
      ["n", "ns-resize"], ["s", "ns-resize"],
      ["w", "ew-resize"], ["e", "ew-resize"],
      ["ne", "nesw-resize"], ["nw", "nwse-resize"],
      ["se", "nwse-resize"], ["sw", "nesw-resize"],
    ];
    for (const [dir, cursor] of HANDLES) {
      const h = document.createElement("div");
      h.className = `whale-resize-handle whale-resize-${dir}`;
      h.dataset.resize = dir;
      h.style.cursor = cursor;
      popup.appendChild(h);
    }
    const MIN_W = 320;
    const MIN_H = 200;
    let activeDir: string | null = null;
    let startX = 0, startY = 0;
    let startW = 0, startH = 0, startL = 0, startT = 0;

    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const dir = t.dataset.resize;
      if (!dir) return;
      // 阻止冒泡到头部 drag 处理
      e.preventDefault();
      e.stopPropagation();
      activeDir = dir;
      startX = e.clientX;
      startY = e.clientY;
      const rect = popup.getBoundingClientRect();
      startW = rect.width;
      startH = rect.height;
      startL = rect.left;
      startT = rect.top;
      // 清除 transform（如果有），确保用 left/top 定位
      popup.style.transform = "none";
      popup.style.bottom = "auto";
      document.body.classList.add("hiword-resizing");
    };
    const onMove = (e: MouseEvent) => {
      if (!activeDir) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const MAX_W = window.innerWidth - 40;
      const MAX_H = window.innerHeight - 40;
      let newW = startW, newH = startH, newL = startL, newT = startT;
      if (activeDir.includes("e")) newW = Math.max(MIN_W, Math.min(MAX_W, startW + dx));
      if (activeDir.includes("s")) newH = Math.max(MIN_H, Math.min(MAX_H, startH + dy));
      if (activeDir.includes("w")) {
        const right = startL + startW;
        newW = Math.max(MIN_W, Math.min(MAX_W, startW - dx));
        newL = right - newW;
      }
      if (activeDir.includes("n")) {
        const bottom = startT + startH;
        newH = Math.max(MIN_H, Math.min(MAX_H, startH - dy));
        newT = bottom - newH;
      }
      popup.style.width = `${newW}px`;
      popup.style.height = `${newH}px`;
      popup.style.left = `${newL}px`;
      popup.style.top = `${newT}px`;
    };
    const onUp = () => {
      if (!activeDir) return;
      activeDir = null;
      document.body.classList.remove("hiword-resizing");
    };
    popup.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    (popup as any).__resizeClean = () => {
      popup.removeEventListener("mousedown", onDown);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }

  // ==================== 5. 拖动连续批注 ====================

  /** 绑定拖动批注（按住 Alt 键拖选时连续创建批注） */
  private bindDragAnnotation(): void {
    // TODO: 实现拖动连续批注逻辑
    // 思路：
    // 1. mousedown 时检测 Alt 键按下 → 进入拖动模式
    // 2. mouseup 时获取选区 → 自动创建批注（使用默认样式）
    // 3. 不关闭弹窗，允许继续拖动下一段
  }

  // ==================== 工具方法 ====================

  private escapeHtml(s: string): string {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** 销毁（卸载插件时调用） */
  destroy(): void {
    this.disposables.dispose(); // 移除全部全局监听（根因修复 #2）
    this.floatingToolbar?.remove();
    this.floatingToolbar = null;
    this.activeDialog?.remove();
    this.activeDialog = null;
    this.hideStyleMenu();
    WhaleAnnotationManager.editorOpen = false;
  }
}
