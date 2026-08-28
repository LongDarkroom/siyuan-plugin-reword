import { logSwallow } from "../core/safe.ts";
/**
 * 词库驱动文档单词高亮（2026-08-22 新增）
 * ------------------------------------------------------------------
 * 完整闭环：词库单词 → 文档视口内自动高亮 → 点击高亮词跳转词库面板。
 * 与现有批注行内高亮（src/annotation/inline-mark.ts）使用独立 class 体系
 * （hiword-vocab-mark vs hiword-ann-inline），互不污染。
 *
 * 设计原则：
 *  - 只包裹 <span>，不改文本节点 → 删插件后零残留
 *  - 不写 custom-* 块属性 → 不污染思源数据库
 *  - 视口按需渲染：IntersectionObserver + requestIdleCallback，绝不抢占输入
 *  - 纯函数抽出：buildWordRegex / findWordMatches / clearVocabMarks / applyVocabMarks 全部可单测
 *
 * 不依赖：inline-mark.ts（避免循环依赖）；自实现 TextWalker 包裹逻辑。
 */

import { LEARNING_STATUS_COLORS, type LearningStatus } from "../types.ts";
import type { WordRecord } from "../types.ts";

/* ============================================================
 * 纯函数（无 DOM 副作用，可在 Node 测试环境单测）
 * ============================================================ */

/**
 * 构造一个全局匹配词库单词的正则。
 *  - 单词按长度倒序（避免 "app" 抢 "apple" 前缀匹配）
 *  - 转义正则元字符（"c++", ".net" 等）
 *  - 词边界 \b 防止 "pineapple" 误命中 "apple"
 *  - 大小写不敏感（gi 标志）
 *  - 返回 null 表示词库为空（避免返回永远不匹配的正则）
 */
export function buildWordRegex(words: string[]): RegExp | null {
  if (!words || words.length === 0) return null;
  const escaped = words
    .map((w) => w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter((w) => w.length > 0)
    .sort((a, b) => b.length - a.length); // 长度倒序
  if (escaped.length === 0) return null;
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

/** 一次匹配结果 */
export interface WordMatch {
  word: string;
  start: number;
  end: number;
  status: LearningStatus;
}

/**
 * 在一段文本中找出所有词库单词匹配。
 *  - words: 大写归一化的小写词 → 学习状态映射（命中后写入 match.status）
 *  - regex: 来自 buildWordRegex
 *  - 返回数组按出现顺序
 */
export function findWordMatches(
  text: string,
  words: Map<string, LearningStatus>,
  regex: RegExp
): WordMatch[] {
  if (!text || words.size === 0 || !regex) return [];
  const out: WordMatch[] = [];
  // 必须先重置 lastIndex，否则上次 exec 的残留位置会导致漏匹配
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  // 用 exec 而非 matchAll 是为了兼容老 Node 运行时（无 matchAll）
  while ((m = regex.exec(text)) !== null) {
    const w = m[1].toLowerCase();
    const status = words.get(w);
    if (status) {
      out.push({
        word: w,
        start: m.index,
        end: m.index + w.length,
        status,
      });
    }
    // 0 长匹配防御（极端情况）
    if (m.index === regex.lastIndex) regex.lastIndex++;
  }
  return out;
}

/**
 * 清除块内所有 hiword-vocab-mark span。
 * 把 span 替换为其子文本节点（保留原文，去掉包裹），不影响思源块存储。
 * - O(n) 局部操作；多次调用幂等
 */
export function clearVocabMarks(blockEl: HTMLElement): void {
  const marks = blockEl.querySelectorAll(".hiword-vocab-mark");
  marks.forEach((sp) => {
    const parent = sp.parentNode;
    if (!parent) return;
    while (sp.firstChild) {
      parent.insertBefore(sp.firstChild, sp);
    }
    parent.removeChild(sp);
  });
}

/**
 * 在某块内包裹所有词库单词匹配。
 *  - 先 clear 再 apply（避免重叠/旧状态）
 *  - substring 校验偏移（防 DOM 文本节点切碎时 start/end 错位）
 *  - wrappedPositions Set 防双重包裹（同一字符位置只包一次）
 *  - 不动文本节点 → 删除插件后零残留
 *
 * 返回成功包裹的数量。
 */
export function applyVocabMarks(
  blockEl: HTMLElement,
  matches: WordMatch[]
): number {
  // 即使 matches 为空也要清掉旧高亮（清脏数据）
  if (matches.length === 0) {
    clearVocabMarks(blockEl);
    return 0;
  }
  clearVocabMarks(blockEl);

  const fullText = blockEl.textContent || "";
  if (!fullText) return 0;

  // 校验偏移合法性：必须能在 fullText 里找到目标小写词
  const valid = matches.filter(
    (m) =>
      m.start >= 0 &&
      m.end <= fullText.length &&
      m.end > m.start &&
      fullText.substring(m.start, m.end).toLowerCase() === m.word
  );
  if (valid.length === 0) return 0;

  let wrappedCount = 0;
  const wrappedPositions = new Set<number>();
  for (const m of valid) {
    if (wrappedPositions.has(m.start)) continue;

    const range = document.createRange();
    const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
    let currentPos = 0;
    let startFound = false;
    let startNode: Text | null = null;
    let startOffset = 0;
    let endNode: Text | null = null;
    let endOffset = 0;

    while (walker.nextNode()) {
      const tn = walker.currentNode as Text;
      const len = tn.length;
      if (!startFound && currentPos + len > m.start) {
        startNode = tn;
        startOffset = m.start - currentPos;
        startFound = true;
      }
      if (startFound) {
        if (currentPos + len >= m.end) {
          endNode = tn;
          endOffset = m.end - currentPos;
          break;
        }
      }
      currentPos += len;
    }
    if (!startNode || !endNode) continue;

    try {
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      const span = document.createElement("span");
      span.className = "hiword-vocab-mark";
      span.dataset.vocabWord = m.word;
      span.dataset.vocabStatus = m.status;
      // 颜色也写 data 属性，方便 e2e 测试和自定义样式
      span.dataset.vocabColor = LEARNING_STATUS_COLORS[m.status];
      try {
        range.surroundContents(span);
        wrappedCount++;
        wrappedPositions.add(m.start);
      } catch {
        // surroundContents 跨节点边界失败，保守跳过（不破坏 DOM）
      }
    } catch {
      // range 设置异常，跳过
    }
  }
  return wrappedCount;
}

/* ============================================================
 * DOM 副作用层：把上述纯函数 + 词库快照应用到思源编辑器
 * ============================================================ */

/**
 * 从 vocabStore 拉取当前词库快照，转成 (word, status) 视图。
 *  - 2026-08-23 改：跳过 learningStatus 为空的词（"清除样式"后的词不应高亮）
 *  - 含 status 缺失的兼容（旧数据默认 'learning'）。
 */
export function snapshotWordStatus(
  getAllWords: () => WordRecord[]
): { words: Map<string, LearningStatus>; regex: RegExp | null } {
  const all = getAllWords();
  const words = new Map<string, LearningStatus>();
  const wordList: string[] = [];
  for (const w of all) {
    // 2026-08-23:清除样式后 learningStatus 字段为 undefined → 跳过
    if (!w.learningStatus) continue;
    words.set(w.word, w.learningStatus);
    wordList.push(w.word);
  }
  return { words, regex: buildWordRegex(wordList) };
}

/**
 * 把高亮应用到单块（DOM 操作入口）。
 *  - 2026-08-23 改：先清旧高亮，再只在"可高亮"文本片段上匹配/包裹，
 *    跳过代码块 / 行内代码 / 数学公式(.katex) / 超链接 / 已有批注 / 已有高亮，
 *    解决"高亮杂乱"问题。
 */
const EXCLUDED_SELECTOR =
  "code, pre, .katex, a, mark, .hiword-ann-inline, .hiword-vocab-mark";

/** 收集块内"可高亮"文本片段(跳过 EXCLUDED_SELECTOR),返回片段与全局偏移基 */
function collectHighlightableSegments(
  blockEl: HTMLElement
): { node: Text; text: string; base: number }[] {
  const segs: { node: Text; text: string; base: number }[] = [];
  let base = 0;
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement;
      if (!el) return NodeFilter.FILTER_REJECT;
      if (el.closest(EXCLUDED_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) {
    const tn = walker.currentNode as Text;
    segs.push({ node: tn, text: tn.data, base });
    base += tn.data.length;
  }
  return segs;
}

/** 把过滤后文本里的偏移映射回具体文本节点 */
function locateOffset(
  segs: { node: Text; text: string; base: number }[],
  pos: number
): { seg: { node: Text; text: string; base: number }; offset: number } | null {
  for (const s of segs) {
    if (pos >= s.base && pos <= s.base + s.text.length) {
      return { seg: s, offset: pos - s.base };
    }
  }
  return null;
}

/**
 * 在过滤后的文本空间内包裹词库单词。
 *  - 跳过跨片段匹配(避免 surroundContents 跨节点失败)
 *  - 保留 wrappedPositions 去重 + substring 偏移校验(与旧 applyVocabMarks 一致)
 */
function wrapFilteredMatches(
  _blockEl: HTMLElement,
  segs: { node: Text; text: string; base: number }[],
  matches: WordMatch[]
): number {
  let wrappedCount = 0;
  const wrappedPositions = new Set<number>();
  for (const m of matches) {
    if (wrappedPositions.has(m.start)) continue;
    const startLoc = locateOffset(segs, m.start);
    const endLoc = locateOffset(segs, m.end);
    if (!startLoc || !endLoc || startLoc.seg !== endLoc.seg) {
      // 跨文本节点(罕见):保守跳过,避免破坏 DOM
      continue;
    }
    const tn = startLoc.seg.node;
    try {
      const range = document.createRange();
      range.setStart(tn, startLoc.offset);
      range.setEnd(tn, endLoc.offset);
      // substring 校验:防切碎错位
      if (range.toString().toLowerCase() !== m.word) continue;
      const span = document.createElement("span");
      span.className = "hiword-vocab-mark";
      span.dataset.vocabWord = m.word;
      span.dataset.vocabStatus = m.status;
      span.dataset.vocabColor = LEARNING_STATUS_COLORS[m.status];
      range.surroundContents(span);
      wrappedCount++;
      wrappedPositions.add(m.start);
    } catch {
      // 跨节点边界失败,跳过
    }
  }
  return wrappedCount;
}

export function applyVocabMarksToBlock(
  blockEl: HTMLElement,
  words: Map<string, LearningStatus>,
  regex: RegExp | null
): number {
  if (!blockEl) {
    return 0;
  }
  // 先清旧高亮(把已包裹的 span 还原为纯文本),再重新计算
  clearVocabMarks(blockEl);
  if (!regex) {
    return 0;
  }
  const segs = collectHighlightableSegments(blockEl);
  const filtered = segs.map((s) => s.text).join("");
  if (!filtered) return 0;
  const matches = findWordMatches(filtered, words, regex);
  return wrapFilteredMatches(blockEl, segs, matches);
}

/* ============================================================
 * 视口观察器（VocabHighlighter 单例）
 * ============================================================ */

/**
 * 全局词库高亮器：
 *  - 监听 .protyle-wysiwyg [data-node-id] 进入视口
 *  - 进入视口 → 调度单词匹配（raf + requestIdleCallback）
 *  - 监听 store 状态变更 → 重扫整个当前文档
 *  - 文档切换 / 卸载 → disconnect + 释放
 */
export class VocabHighlighter {
  private io: IntersectionObserver | null = null;
  private blockObserver: MutationObserver | null = null;
  private pendingBlocks = new Set<HTMLElement>();
  private rafId = 0;
  private unsubscribeStore: (() => void) | null = null;
  private currentProtyleEl: HTMLElement | null = null;
  private storeGetter: () => WordRecord[];
  /** 功能总开关(由词库面板控制);关闭时停止高亮与重扫 */
  private enabled = true;
  /** 编辑失焦监听句柄(start 注册 / stop 移除) */
  private onBlurHandler: ((e: FocusEvent) => void) | null = null;

  constructor(storeGetter: () => WordRecord[]) {
    this.storeGetter = storeGetter;
  }

  /**
   * 启动观察器：绑定到某个 protyle 元素。
   * 重复调用会自动 stop 旧实例,适合文档切换场景。
   */
  start(protyleEl: HTMLElement): void {
    if (!protyleEl) return;
    this.stop();
    this.currentProtyleEl = protyleEl;

    // 1) 视口观察:块进入视口时进入待处理队列
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            this.pendingBlocks.add(e.target as HTMLElement);
          }
        }
        this.scheduleProcessPending();
      },
      {
        root: (protyleEl.closest(".protyle-wysiwyg") as HTMLElement | null) ?? null,
        rootMargin: "320px 0px", // 提前一屏(与 ann-preview 一致)
        threshold: 0,
      }
    );
    // 初次登记:把当前已存在的所有块喂给 IO
    this.scanBlocks(protyleEl).forEach((b) => {
      try {
        this.io!.observe(b);
      } catch (__swallowErr) { logSwallow(__swallowErr, "vocab-highlight.ts · start", "debug"); }
    });

    // 2) DOM 变化观察:块增删时加入待处理(思源块级动态加载/卸载)
    this.blockObserver = new MutationObserver(() => {
      this.scheduleProcessPending();
    });
    try {
      this.blockObserver.observe(protyleEl, { childList: true, subtree: true });
    } catch (__swallowErr) { logSwallow(__swallowErr, "vocab-highlight.ts · start", "debug"); }

    // 编辑失焦后重新入队该块,恢复高亮
    // (编辑期间跳过聚焦块,避免反复拆/包 span 干扰思源输入)
    this.onBlurHandler = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && this.currentProtyleEl && this.currentProtyleEl.contains(t)) {
        const block = t.closest("[data-node-id]") as HTMLElement | null;
        if (block && document.contains(block)) {
          this.pendingBlocks.add(block);
          this.scheduleProcessPending();
        }
      }
    };
    document.addEventListener("focusout", this.onBlurHandler, true);

    // 3) 不订阅 store(由 onSwitchProtyle 触发 start 时外部调用 onLearningStatusChange)
    // start 调用方负责订阅/退订
  }

  /**
   * 注册 store 状态变更监听（由外部传入 listener 注册函数）。
   * 返回的 cleanup 在 stop() 时自动调用。
   */
  bindStoreListener(register: (cb: (word: string, status: LearningStatus) => void) => () => void): void {
    this.unsubscribeStore = register((word) => this.onStoreChange(word));
  }

  /** 停止并释放所有资源 */
  stop(): void {
    if (this.io) {
      this.io.disconnect();
      this.io = null;
    }
    if (this.blockObserver) {
      this.blockObserver.disconnect();
      this.blockObserver = null;
    }
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
    if (this.onBlurHandler) {
      document.removeEventListener("focusout", this.onBlurHandler, true);
      this.onBlurHandler = null;
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.pendingBlocks.clear();
    this.currentProtyleEl = null;
  }

  /** 拉一次新词库快照并应用到所有 pending 块 */
  private scanBlocks(root: HTMLElement): HTMLElement[] {
    const list = root.querySelectorAll<HTMLElement>("[data-node-id]");
    return Array.from(list);
  }

  private scheduleProcessPending(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.processPending();
    });
  }

  private processPending(): void {
    if (this.pendingBlocks.size === 0) return;
    // 功能关闭时:清掉待处理块的高亮即退出(不再重扫)
    if (!this.enabled) {
      for (const b of this.pendingBlocks) {
        if (document.contains(b)) clearVocabMarks(b);
      }
      this.pendingBlocks.clear();
      return;
    }
    const { words, regex } = snapshotWordStatus(this.storeGetter);
    if (!regex || words.size === 0) {
      // 词库为空 → 清掉所有块的高亮
      for (const b of this.pendingBlocks) {
        if (document.contains(b)) clearVocabMarks(b);
      }
      this.pendingBlocks.clear();
      return;
    }
    // 正在编辑的块本次跳过,避免反复拆/包 span 干扰思源输入;失焦后由 focusout 重新入队
    const blocks = Array.from(this.pendingBlocks).filter(
      (b) => !b.contains(document.activeElement)
    );
    this.pendingBlocks.clear();

    // 真正做活儿放到 idle callback,绝不抢占输入/渲染
    const scheduleWork =
      (typeof (window as any).requestIdleCallback === "function"
        ? (cb: () => void) => (window as any).requestIdleCallback(cb, { timeout: 800 })
        : (cb: () => void) => setTimeout(cb, 0));
    scheduleWork(() => {
      for (const block of blocks) {
        if (!document.contains(block)) continue;
        applyVocabMarksToBlock(block, words, regex);
      }
    });
  }

  /** 状态变更 → 整文档重扫 */
  private onStoreChange(_word: string): void {
    if (!this.currentProtyleEl) return;
    this.pendingBlocks.clear();
    this.scanBlocks(this.currentProtyleEl).forEach((b) =>
      this.pendingBlocks.add(b)
    );
    this.scheduleProcessPending();
  }

  /**
   * 公开：手动触发整文档重扫（供切文档/打开应用时调用,不等 IO 入视口）。
   * 实际是"把当前所有块加入 pending 队列",raf + idle 后由 processPending 处理。
   */
  refreshAll(): void {
    if (!this.currentProtyleEl) return;
    this.pendingBlocks.clear();
    this.scanBlocks(this.currentProtyleEl).forEach((b) =>
      this.pendingBlocks.add(b)
    );
    this.scheduleProcessPending();
  }

  /** 功能开关:关闭→清空当前所有高亮并停止重扫;开启→立即全扫 */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      if (this.currentProtyleEl) {
        this.scanBlocks(this.currentProtyleEl).forEach((b) => {
          if (document.contains(b)) clearVocabMarks(b);
        });
      }
    } else {
      this.refreshAll();
    }
  }
}

/* ============================================================
 * 单例 + 注入式依赖
 * ============================================================ */

/** 注入式 store 引用(避免循环依赖) */
let _vocabStoreGetter: () => WordRecord[] = () => [];
let _learningStatusListenerRegister:
  | ((cb: (word: string, status: LearningStatus) => void) => () => void)
  | null = null;

export function configureVocabHighlightDeps(deps: {
  getAllWords: () => WordRecord[];
  onLearningStatusChange: (
    cb: (word: string, status: LearningStatus) => void
  ) => () => void;
}): void {
  _vocabStoreGetter = deps.getAllWords;
  _learningStatusListenerRegister = deps.onLearningStatusChange;
}

let singleton: VocabHighlighter | null = null;

export function getVocabHighlighter(): VocabHighlighter {
  if (!singleton) {
    singleton = new VocabHighlighter(_vocabStoreGetter);
    if (_learningStatusListenerRegister) {
      singleton.bindStoreListener(_learningStatusListenerRegister);
    }
  }
  return singleton;
}

/** 测试用：重置单例(不要在生产代码调用) */
export function __resetVocabHighlighterForTest(): void {
  if (singleton) {
    singleton.stop();
    singleton = null;
  }
}
