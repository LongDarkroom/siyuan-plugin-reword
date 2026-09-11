/**
 * 词书导入向导（2026-09-11 新增）
 * ------------------------------------------------------------------
 * 4 步状态机：选源 → 解析 → 预览/编辑 → 校验入库
 *
 * 选源（step 0）：
 *   - 思源块（单/多块 ID）
 *   - 思源文档（docId）
 *   - 粘贴文本（手动粘 markdown）
 *   - 文件（CSV / TXT / JSON，走 FileReader）
 *
 * 解析（step 1）：
 *   - 调 autoParse() 自动 detect 格式
 *   - 显示识别结果（format + 词数 + skipped 报告）
 *   - 不可识别 → 提示切换源
 *
 * 预览/编辑（step 2）：
 *   - 前 20 条 + 全量统计
 *   - 每行可勾选/取消
 *   - 不可编辑（保持简洁）
 *
 * 校验入库（step 3）：
 *   - 输入词书名（默认 "导入词书 N"）
 *   - 设 dailyGoal（默认 10）
 *   - 选目标单词本（新建/已有）
 *   - 调 verifyBook 触发持久化
 *
 * 不引入 Svelte 组件，复用 index.ts 的 innerHTML 模式
 */

import { getLogger } from "../core/logger.ts";
import { autoParse } from "./parser/index.ts";
import type { CleanedResult, ParsedWord, ParserFormat } from "./parser/types.ts";
import type { VocabStore } from "./vocab-store.ts";
import type { VocabBook } from "../types.ts";
import { BookSource, BookStatus } from "../types.ts";

/** 4 步定义 */
type Step = 0 | 1 | 2 | 3;
const STEP_TITLES = ["选源", "解析", "预览", "校验入库"];

export interface ImportDialogOptions {
  vocabStore: VocabStore;
  /** 获取块 kramdown（默认调 siyuan API，可注入便于测试） */
  getBlockKramdown?: (id: string) => Promise<string>;
  /** 获取块 kramdown 批量 */
  getBlockKramdowns?: (ids: string[]) => Promise<string[]>;
  /** 获取整篇文档（默认调 siyuan API） */
  getDoc?: (id: string) => Promise<{ content?: string; [k: string]: unknown } | null>;
  /** 关闭回调 */
  onClose?: () => void;
  /** 完成回调（词书已校验入库） */
  onComplete?: (book: VocabBook) => void;
}

/** 内部状态 */
interface State {
  step: Step;
  source: "block" | "doc" | "paste" | "file" | null;
  sourceIds: string[];            // 块 ID 列表（多块导入）
  sourceDocId?: string;          // 文档 ID
  pastedText?: string;            // 粘贴文本
  fileName?: string;              // 文件名
  format: ParserFormat | null;
  words: ParsedWord[];            // 清洗后
  rawCount: number;               // 原始行数
  skipped: CleanedResult["skipped"];
  bookName: string;
  dailyGoal: number;
  targetBookId: string;          // "new" | 已有 book id
}

export class ImportDialog {
  private overlay: HTMLElement | null = null;
  private state: State = {
    step: 0,
    source: null,
    sourceIds: [],
    format: null,
    words: [],
    rawCount: 0,
    skipped: [],
    bookName: "",
    dailyGoal: 10,
    targetBookId: "new",
  };

  constructor(private opts: ImportDialogOptions) {}

  /** 打开弹窗 */
  open(): void {
    if (this.overlay) return;
    this.overlay = document.createElement("div");
    this.overlay.className = "hiword-import-dialog-overlay";
    this.overlay.innerHTML = this.render();
    document.body.appendChild(this.overlay);
    this.bindEvents();
    getLogger().info("[REword][import-dialog] 打开");
  }

  /** 销毁 */
  destroy(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    this.opts.onClose?.();
  }

  // ============ 渲染 ============
  private render(): string {
    return `
      <div class="hiword-import-dialog">
        <div class="hiword-import-header">
          <h3>📥 导入词书</h3>
          <div class="hiword-import-steps">
            ${STEP_TITLES.map((t, i) => `
              <span class="hiword-import-step ${i === this.state.step ? "active" : ""} ${i < this.state.step ? "done" : ""}">
                ${i + 1}. ${t}
              </span>
            `).join("<span class='hiword-import-step-sep'>›</span>")}
          </div>
          <button class="hiword-import-close" data-action="close">×</button>
        </div>
        <div class="hiword-import-body">
          ${this.renderStep()}
        </div>
        <div class="hiword-import-footer">
          ${this.state.step > 0 ? '<button class="hiword-btn" data-action="back">← 上一步</button>' : ""}
          ${this.renderFooterBtn()}
        </div>
      </div>
    `;
  }

  private renderStep(): string {
    switch (this.state.step) {
      case 0: return this.renderStep0();
      case 1: return this.renderStep1();
      case 2: return this.renderStep2();
      case 3: return this.renderStep3();
    }
  }

  private renderStep0(): string {
    return `
      <div class="hiword-import-step0">
        <p class="hiword-import-hint">选择词书来源（5 种解析格式自动检测：plain / doubledot / table / tsv / yaml）</p>
        <div class="hiword-import-source-grid">
          <div class="hiword-import-source-card" data-source="block">
            <div class="hiword-import-source-icon">📦</div>
            <div class="hiword-import-source-name">思源块</div>
            <div class="hiword-import-source-desc">单/多块 ID（粘贴用逗号分隔）</div>
          </div>
          <div class="hiword-import-source-card" data-source="doc">
            <div class="hiword-import-source-icon">📄</div>
            <div class="hiword-import-source-name">思源文档</div>
            <div class="hiword-import-source-desc">整篇文档（按段落）</div>
          </div>
          <div class="hiword-import-source-card" data-source="paste">
            <div class="hiword-import-source-icon">📋</div>
            <div class="hiword-import-source-name">粘贴文本</div>
            <div class="hiword-import-source-desc">手动粘 markdown / 表格</div>
          </div>
          <div class="hiword-import-source-card" data-source="file">
            <div class="hiword-import-source-icon">📁</div>
            <div class="hiword-import-source-name">本地文件</div>
            <div class="hiword-import-source-desc">CSV / TXT / JSON 拖入</div>
          </div>
        </div>
        <div class="hiword-import-source-input" id="hiword-import-source-input"></div>
      </div>
    `;
  }

  private renderStep1(): string {
    const fmt = this.state.format;
    if (!fmt) {
      return `
        <div class="hiword-import-error">
          <h4>❌ 未识别格式</h4>
          <p>5 种内置格式都不匹配。请检查输入：</p>
          <ul>
            <li><b>plain</b>：每行一个英文词</li>
            <li><b>doubledot</b>：<code>word :: 释义</code></li>
            <li><b>table</b>：markdown 表格（首行表头 + 次行分隔）</li>
            <li><b>tsv</b>：Tab 分隔（可带表头）</li>
            <li><b>yaml</b>：YAML frontmatter + 列表</li>
          </ul>
        </div>
      `;
    }
    return `
      <div class="hiword-import-step1">
        <h4>✅ 识别为 <code>${fmt}</code> 格式</h4>
        <div class="hiword-import-stats">
          <div class="hiword-import-stat"><div class="hiword-import-stat-v">${this.state.words.length}</div><div class="hiword-import-stat-l">有效词</div></div>
          <div class="hiword-import-stat"><div class="hiword-import-stat-v">${this.state.rawCount}</div><div class="hiword-import-stat-l">原始行</div></div>
          <div class="hiword-import-stat"><div class="hiword-import-stat-v">${this.state.skipped.length}</div><div class="hiword-import-stat-l">跳过</div></div>
        </div>
        ${this.state.skipped.length > 0 ? `
          <details class="hiword-import-skipped">
            <summary>跳过的行（${this.state.skipped.length}）</summary>
            <ul>
              ${this.state.skipped.slice(0, 20).map((s: CleanedResult["skipped"][number]) => `<li>行 ${s.line}: ${s.reason} — <code>${s.raw.slice(0, 60)}</code></li>`).join("")}
              ${this.state.skipped.length > 20 ? `<li>... 还有 ${this.state.skipped.length - 20} 条</li>` : ""}
            </ul>
          </details>
        ` : ""}
      </div>
    `;
  }

  private renderStep2(): string {
    const preview = this.state.words.slice(0, 20);
    return `
      <div class="hiword-import-step2">
        <p>共 <b>${this.state.words.length}</b> 个词，预览前 ${preview.length}：</p>
        <table class="hiword-import-preview">
          <thead><tr><th>词</th><th>音标</th><th>释义</th><th>例句</th></tr></thead>
          <tbody>
            ${preview.map(w => `
              <tr>
                <td><b>${this.esc(w.word)}</b></td>
                <td>${this.esc(w.phonetic ?? "")}</td>
                <td>${this.esc(w.meaning ?? "")}</td>
                <td>${this.esc((w.example ?? "").slice(0, 50))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        ${this.state.words.length > 20 ? `<p class="hiword-import-hint">还有 ${this.state.words.length - 20} 词未预览</p>` : ""}
      </div>
    `;
  }

  private renderStep3(): string {
    const books = this.opts.vocabStore.getBooks();
    return `
      <div class="hiword-import-step3">
        <div class="hiword-import-field">
          <label>词书名：</label>
          <input type="text" id="hiword-import-bookname" value="${this.esc(this.state.bookName)}" placeholder="如：TOEFL 核心词" />
        </div>
        <div class="hiword-import-field">
          <label>每日配额：</label>
          <input type="number" id="hiword-import-dailygoal" value="${this.state.dailyGoal}" min="0" max="999" />
          <span class="hiword-import-hint">0 = 不限</span>
        </div>
        <div class="hiword-import-field">
          <label>目标单词本：</label>
          <select id="hiword-import-target">
            <option value="new">＋ 新建单词本</option>
            ${books.filter(b => b.id !== "__all__").map(b => `
              <option value="${b.id}">${this.esc(b.name)} (${b.themes.reduce((n, t) => n + t.words.length, 0)} 词)</option>
            `).join("")}
          </select>
        </div>
        <p class="hiword-import-hint">⚠ 草稿本不会自动进入复习，需要时手动「✓ 校验」</p>
      </div>
    `;
  }

  private renderFooterBtn(): string {
    switch (this.state.step) {
      case 0: return '<button class="hiword-btn" data-action="back" disabled>← 上一步</button>';
      case 1:
        return this.state.format
          ? '<button class="hiword-btn hiword-btn-primary" data-action="next">下一步 →</button>'
          : '<button class="hiword-btn" data-action="back">← 重新选源</button>';
      case 2: return '<button class="hiword-btn hiword-btn-primary" data-action="next">下一步 →</button>';
      case 3: return '<button class="hiword-btn hiword-btn-primary" data-action="confirm">✓ 确认入库</button>';
    }
  }

  // ============ 事件 ============
  private bindEvents(): void {
    if (!this.overlay) return;
    this.overlay.addEventListener("click", e => {
      const target = e.target as HTMLElement;
      const action = target.dataset.action;
      if (action === "close") return this.destroy();
      if (action === "back") return this.goBack();
      if (action === "next") return this.goNext();
      if (action === "confirm") return this.confirm();
      // 选源卡片
      const sourceCard = target.closest("[data-source]") as HTMLElement | null;
      if (sourceCard) {
        const source = sourceCard.dataset.source as State["source"];
        this.handleSourceSelect(source);
      }
    });
    // 拖入文件
    this.overlay.addEventListener("dragover", e => e.preventDefault());
    this.overlay.addEventListener("drop", e => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) this.handleFile(file);
    });
  }

  // ============ 状态转换 ============
  private goBack(): void {
    if (this.state.step > 0) {
      this.state.step = (this.state.step - 1) as Step;
      this.rerender();
    }
  }

  private goNext(): void {
    if (this.state.step < 3) {
      this.state.step = (this.state.step + 1) as Step;
      this.rerender();
    }
  }

  private handleSourceSelect(source: State["source"]): void {
    this.state.source = source;
    const input = this.overlay?.querySelector("#hiword-import-source-input");
    if (!input) return;
    if (source === "block") {
      input.innerHTML = `
        <label>块 ID（多个用逗号/空格分隔）：</label>
        <textarea id="hiword-import-blocks" rows="3" placeholder="20260813120000-abcdef"></textarea>
        <button class="hiword-btn hiword-btn-primary" data-action="parse-blocks">解析</button>
      `;
      input.querySelector('[data-action="parse-blocks"]')?.addEventListener("click", () => {
        const raw = (input.querySelector("#hiword-import-blocks") as HTMLTextAreaElement)?.value ?? "";
        const ids = raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
        this.parseBlocks(ids);
      });
    } else if (source === "doc") {
      input.innerHTML = `
        <label>文档 ID：</label>
        <input type="text" id="hiword-import-docid" placeholder="20240101000000-xxxxx" />
        <button class="hiword-btn hiword-btn-primary" data-action="parse-doc">解析</button>
      `;
      input.querySelector('[data-action="parse-doc"]')?.addEventListener("click", () => {
        const id = (input.querySelector("#hiword-import-docid") as HTMLInputElement)?.value.trim();
        if (id) this.parseDoc(id);
      });
    } else if (source === "paste") {
      input.innerHTML = `
        <label>粘贴 markdown / 表格 / 词列表：</label>
        <textarea id="hiword-import-paste" rows="8" placeholder="abandon :: 放弃
benevolent :: 仁慈
..."></textarea>
        <button class="hiword-btn hiword-btn-primary" data-action="parse-paste">解析</button>
      `;
      input.querySelector('[data-action="parse-paste"]')?.addEventListener("click", () => {
        const text = (input.querySelector("#hiword-import-paste") as HTMLTextAreaElement)?.value ?? "";
        this.parseText(text);
      });
    } else if (source === "file") {
      input.innerHTML = `
        <label>选择文件（CSV / TXT / JSON）：</label>
        <input type="file" id="hiword-import-file" accept=".csv,.txt,.json" />
        <p class="hiword-import-hint">或直接拖入文件到弹窗</p>
      `;
      input.querySelector("#hiword-import-file")?.addEventListener("change", (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) this.handleFile(file);
      });
    }
  }

  private async parseBlocks(ids: string[]): Promise<void> {
    try {
      const fetcher = this.opts.getBlockKramdowns;
      if (!fetcher) {
        this.showError("缺少 getBlockKramdowns 注入");
        return;
      }
      const contents = await fetcher(ids);
      const merged = contents.filter(Boolean).join("\n");
      this.parseText(merged);
    } catch (e) {
      getLogger().warn("[REword][import-dialog] parseBlocks 失败:", { error: e });
      this.showError("块读取失败");
    }
  }

  private async parseDoc(id: string): Promise<void> {
    try {
      const fetcher = this.opts.getDoc;
      if (!fetcher) {
        this.showError("缺少 getDoc 注入");
        return;
      }
      const doc = await fetcher(id);
      const content = (doc as { content?: string })?.content ?? "";
      this.parseText(content);
    } catch (e) {
      getLogger().warn("[REword][import-dialog] parseDoc 失败:", { error: e });
      this.showError("文档读取失败");
    }
  }

  private async handleFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      this.state.fileName = file.name;
      this.parseText(text);
    } catch (e) {
      this.showError("文件读取失败");
    }
  }

  private parseText(text: string): void {
    if (!text.trim()) {
      this.showError("内容为空");
      return;
    }
    const result = autoParse(text);
    if (!result) {
      this.state.format = null;
      this.state.words = [];
      this.state.skipped = [];
      this.state.rawCount = text.split(/\r?\n/).length;
    } else {
      this.state.format = result.result.format;
      this.state.words = result.result.words;
      this.state.rawCount = result.result.rawLineCount;
      this.state.skipped = result.cleaned.skipped;
    }
    this.state.step = 1;
    this.state.bookName = this.state.fileName?.replace(/\.[^.]+$/, "") ?? `导入词书 ${new Date().toLocaleDateString()}`;
    this.rerender();
  }

  private async confirm(): Promise<void> {
    // 收集表单
    const bookName = (this.overlay?.querySelector("#hiword-import-bookname") as HTMLInputElement)?.value.trim();
    const dailyGoal = parseInt((this.overlay?.querySelector("#hiword-import-dailygoal") as HTMLInputElement)?.value ?? "10", 10) || 10;
    const targetBookId = (this.overlay?.querySelector("#hiword-import-target") as HTMLSelectElement)?.value ?? "new";
    if (!bookName) {
      this.showError("请输入词书名");
      return;
    }
    try {
      const store = this.opts.vocabStore;
      let book: VocabBook | undefined;
      if (targetBookId === "new") {
        // 新建单词本（status=draft，等用户校验）
        book = await store.addBook(bookName);
        book.status = BookStatus.Draft;
        book.source = BookSource.DocParsed;
        book.importMeta = {
          format: this.state.format ?? "plain",
          locator: this.state.fileName ?? this.state.sourceDocId ?? this.state.sourceIds.join(",") ?? "imported",
          rawCount: this.state.rawCount,
          dedupedCount: this.state.words.length,
          skippedCount: this.state.skipped.length,
          importedAt: new Date().toISOString(),
        };
        (book as VocabBook & { dailyGoal?: number }).dailyGoal = dailyGoal;
        // addBook 内部已 persist，此处无需重复
      } else {
        book = store.getBook(targetBookId);
        if (!book) {
          this.showError("目标单词本不存在");
          return;
        }
      }
      // 批量加词
      const theme = book.themes[0];
      let added = 0;
      for (const w of this.state.words) {
        try {
          await store.addWord(w.word, {
            phonetic: w.phonetic,
            pos: w.pos,
            meaning: w.meaning,
            example: w.example,
            labels: w.labels,
            senseCount: undefined,
          }, book.id, theme.id);
          added++;
        } catch (e) {
          getLogger().warn(`[REword][import-dialog] addWord 失败: ${w.word}`, { error: e });
        }
      }
      getLogger().info(`[REword][import-dialog] 完成：词书 ${bookName} 写入 ${added}/${this.state.words.length} 词`);
      this.opts.onComplete?.(book);
      this.destroy();
    } catch (e) {
      getLogger().warn("[REword][import-dialog] confirm 失败:", { error: e });
      this.showError("入库失败");
    }
  }

  private showError(msg: string): void {
    const body = this.overlay?.querySelector(".hiword-import-body");
    if (!body) return;
    const err = document.createElement("div");
    err.className = "hiword-import-toast-error";
    err.textContent = msg;
    body.prepend(err);
    setTimeout(() => err.remove(), 3000);
  }

  private rerender(): void {
    if (!this.overlay) return;
    this.overlay.innerHTML = this.render();
    this.bindEvents();
  }

  private esc(s: string): string {
    return s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  }
}
