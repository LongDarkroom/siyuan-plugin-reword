/**
 * 阅读器双语对照注入
 * ------------------------------------------------------------------
 * 2026-08-28 优化：AI 批量翻译 + 按需可视页。
 *
 * 要点：
 *  - 翻译走 plugin.translateBatch（AI 首选批量 → 微软 → LibreTranslate
 *    兜底 + 按书缓存），一次请求译多段，成本与等待大幅降低。
 *  - 2026-08-28 两阶段按需范围：①「眼前屏」段落立即翻译并注入显示；
 *    ② 当前屏之后 2-3 面内的段落翻译 + 入缓存（不注入 DOM），等用户
 *    滚到那一面时 relocate 触发新 injectAll、命中缓存秒出。翻过的页 /
 *    已预取页命中缓存零成本。滚动 / 翻页信号（load + relocate）驱动增量
 *    补译。
 *  - 注入标记 class="reword-bilingual" + data-translation-mark="1"，幂等：
 *    已注入的段落跳过，重复调用安全。data-translation-mark 用于提示
 *    foliate text-walker / 划词逻辑排除译文节点，避免双语开启下划词
 *    高亮 CFI 偏移（参考 Readest / anx-reader 实践）。
 *  - 翻页（foliate 重新 load 内容）时由 ReaderView 调 onViewLoad() 重新注入。
 *  - 关闭时 removeAll() 清除全部注入节点，零正文污染、卸载无残留。
 *  - 中断安全：翻译 await 返回后复查 enabled，避免「关开关后译文仍注入」。
 *  - 防重入：injectAll 执行期间（含 AI 等待），后续 relocate/load 信号
 *    仅重置防抖定时器、不发起重复翻译请求（避免请求风暴）。
 */
/** 书籍元数据（注入翻译 system prompt，提升专有名词/语境准确性） */
export interface BilingualBookMeta {
  title?: string;
  author?: string;
  /** 源语言（如 en / ja / fr），用于提示模型原文语种 */
  language?: string;
  /** 目录文本（可选，较长，仅在非空且较短时注入） */
  toc?: string;
}

export interface BilingualOptions {
  bookId: string;
  /** 返回当前 foliate 内容文档数组（传入方负责把 [{doc}] 解成真实 Document[]） */
  getContents: () => Document[];
  /**
   * 批量翻译（异步，返回与输入同序同长的译文数组）
   * @param ctxBefore 与 texts 同序的「前文参考」数组（可为 null），供模型理解语境，无需翻译
   * @param meta 书籍元数据（书名/作者/语言/目录），注入 system prompt
   * @param extra 预翻译细化选项：model 模型覆盖 / overwrite 覆盖已有缓存 / signal 中断信号
   */
  translateBatch: (
    texts: string[],
    from: string,
    to: string,
    bookId: string,
    ctxBefore?: (string | null)[],
    meta?: BilingualBookMeta | null,
    extra?: { model?: string; overwrite?: boolean; signal?: AbortSignal; mode?: "default" | "concise" }
  ) => Promise<string[]>;
  /**
   * 详细翻译（回传 provider / fromCache），用于渲染来源徽标与缓存标记。
   * 与 translateBatch 逻辑一致，仅返回值多了来源元数据。注入层优先用
   * 它；未提供时回落到 translateBatch（徽标退化为不显示来源）。
   */
  translateBatchDetailed?: (
    texts: string[],
    from: string,
    to: string,
    bookId: string,
    ctxBefore?: (string | null)[],
    meta?: BilingualBookMeta | null,
    extra?: { model?: string; overwrite?: boolean; signal?: AbortSignal; mode?: "default" | "concise" }
  ) => Promise<{ texts: string[]; providers: (string | null)[]; fromCache: boolean[] }>;
  /** 批量查询缓存命中（同序 boolean[]；true=该段已缓存），用于预翻译弹窗精确计算待译数 */
  checkCached?: (texts: string[]) => Promise<boolean[]>;
  /** 取用户钉选的修正译文（最高优先级，覆盖 AI 缓存与实时翻译）；返回 null 表示无修正 */
  getFix?: (text: string) => string | null | Promise<string | null>;
  /** 钉选/覆盖一条修正译文（用户手动修正的正确答案，持久化） */
  setFix?: (text: string, tr: string, model?: string) => void | Promise<void>;
  /** 删除一条修正译文（仅删修正库，不影响 AI 缓存） */
  deleteFix?: (text: string) => void | Promise<void>;
  /** 删除单段 AI 缓存（用于「隐藏」时彻底清除，避免重译后重现） */
  deleteCacheOne?: (text: string) => void | Promise<void>;
  /** 是否显示来源徽标（缓存/AI/引擎名/已修正），默认 true；传函数以便设置切换即时生效 */
  showProvider?: (() => boolean) | boolean;
  /** 双语调试信息（译文块显示引擎与 Token 明细），默认 false；传函数以便设置切换即时生效 */
  debug?: (() => boolean) | boolean;
  /** 源语言（默认 auto） */
  from?: string;
  /** 目标语言（默认 zh） */
  to?: string;
  /** 书籍元数据回调（书名/作者/语言/目录），注入翻译 system prompt 提升准确性 */
  bookMeta?: () => BilingualBookMeta | null;
  /** 进度回调（done / total，按本轮送译数计） */
  onProgress?: (done: number, total: number) => void;
  /** Token 用量回调（每次翻译批次完成后调用；累计值跨批次累加） */
  onTokenUsage?: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
  /** 可视过滤开关（默认 true；测试可关掉以翻译全部段落） */
  visibleOnly?: boolean;
  /** 预取页数（动态回调）：当前屏之后额外预译并缓存的「面」数；默认 2.5。值越大越省翻页等待但越费 token */
  getPrefetchPages?: () => number;
  /** 节号回调（1-based）：每当一批段落翻译并成功入缓存后，回传本次涉及的书「节」序号，用于 UI「第 X-Y 页缓存成功」 */
  onSectionsCached?: (bookId: string, sections: number[]) => void;
}

/** 整书预翻译进度（细化版：含状态/缓存/待译/ETA/token 估算） */
export interface PretranslateProgress {
  /** 本轮已成功入缓存段数 */
  done: number;
  /** 全书总段数 */
  total: number;
  /** 已缓存段数（含本次开始前已有的） */
  cached: number;
  /** 待译段数（需走 AI 的；overwrite 时等于 total） */
  pending: number;
  status: "idle" | "running" | "done" | "cancelled" | "error";
  /** Token 估算（仅基于待译字数 /4，非实时用量） */
  estTokens?: number;
  /** 剩余秒数估算（运行中按已完成速率推算） */
  etaSeconds?: number;
}

/** 整书预翻译细化选项（来自弹窗） */
export interface PretranslateOptions {
  /** 目标语言覆盖（默认沿用双语设置 to） */
  to?: string;
  /** 模型覆盖（默认沿用当前 AI 设置 model） */
  model?: string;
  /** 每批段数（默认 8，与 aiTranslateBatch 分桶上限一致） */
  batchSize?: number;
  /** 批次间并发数（默认 1，避免触发限流） */
  concurrency?: number;
  /** 覆盖已有缓存（默认 false：命中缓存段落跳过，不重复消耗 token） */
  overwrite?: boolean;
  /** 中断信号（停止按钮 / 卸载时 abort） */
  signal?: AbortSignal;
  /** 进度回调（每批完成后触发） */
  onProgress?: (p: PretranslateProgress) => void;
}

export interface BilingualHandle {
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  /** 立即重新扫描并注入（如设置变更后） */
  refresh(): void;
  /** foliate 加载新内容（翻页）或滚动/跳转（relocate）时调用 */
  onViewLoad(): void;
  /** 统计本书段落总数与总字数（供预翻译弹窗展示） */
  segmentStats(): { count: number; chars: number };
  /** 列出本书全部段落原文（供预翻译弹窗按段精确计算「已缓存」命中，与 pretranslateAll 逻辑一致） */
  segmentTexts(): string[];
  /**
   * 整书预翻译（细化版）：遍历全书所有段落，未缓存的送译并落盘（translationCache）；
   * 不在 DOM 注入译文——仅填充缓存，使后续开启双语 / 翻页 / 重开本书时命中缓存秒出。
   * 支持模型/目标语言覆盖、批大小/并发调节、覆盖缓存、可中断。
   * @param opts 细化选项与进度回调
   */
  pretranslateAll(opts?: PretranslateOptions): Promise<void>;
  /**
   * 段落级"重新翻译为简洁版"（2026-08-30 新增）。
   *  - 入口：findConciseTrigger(el) 找到 .reword-bilingual-concise 按钮 → 找到所属 .reword-bilingual
   *  - 流程：提取段落原文 → 拿前文参考 → 调 translateBatch([text], ..., { mode: "concise" })
   *  - 命中缓存即瞬时切换；未命中走 AI 走一次
   *  - 并发控制：相同 textHash 同时只跑一个 in-flight 请求
   * @param el 用户点击的 .reword-bilingual 元素
   * @returns 是否成功替换（false = 失败，原译文保留）
   */
  retranslateConcise(el: HTMLElement): Promise<boolean>;
  destroy(): void;
}

/**
 * 双语调试日志开关（2026-08-28 v1.2.0 发布前收敛）
 * true = 输出 [REword] 双语… 流程日志（每次翻页约 10 条，用于排查注入问题）；
 * false = 静默（发布默认）。异常仍走 console.warn，不受此开关影响——
 *          warn 只在真正出错时触发，不会刷屏，且对线上问题诊断有价值。
 * 与 ReaderView.svelte 的 DEBUG_READER 保持同一套约定。
 */
const DEBUG_BILINGUAL = false;

/** 受 DEBUG_BILINGUAL 控制的调试日志；关闭后为空操作（仍有调用开销但极微） */
function log(...args: unknown[]): void {
  if (DEBUG_BILINGUAL) console.log(...args);
}

/** 真实正文块（首选段落级）：p / li / blockquote */
const BLOCK = "p, li, blockquote";
/**
 * div 仅作「叶子文本块」兜底：部分 EPUB 用 <div> 而非 <p> 做段落。
 * 但若 div 内含 p/li/blockquote（包装层），则改译其内部真实块，避免整章误判成一段。
 */
const LEAF_DIV = "div";
/** 不应翻译的节点（参考 anx-reader walkTextNodes 排除 pre/code/math/style/script） */
const EXCLUDED = "pre, code, math, style, script";
/** 作为整体翻译的容器：其内 p/li 跳过，改译容器整体（避免重复计数） */
const CONTAINER = "blockquote, li";

function cleanText(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

/**
 * 两阶段可见性模型（2026-08-28）：
 *  - 阶段 1「眼前屏」：严格在当前视口内的段落 → 立即翻译并注入显示。
 *  - 阶段 2「后面预取」：当前屏之后 2-3 面范围内的段落 → 翻译 + 入
 *    翻译缓存（translations/<bookId>.json），但**不注入 DOM**；等用户
 *    滚到那一面时，relocate 触发新一轮 injectAll，命中缓存秒出。
 *  - 前面（已读）的段落不预取，靠之前已写入的缓存兜底。
 *
 * 「面」的近似：滚动模式下一屏高 ≈ 一面（纵向 vh）；分页（CSS columns）
 * 模式下一页宽 ≈ 一面（横向 vw）。预取窗口取后面 N 屏（N 由设置面板
 * bilingualPrefetchPages 控制，默认 2.5 屏 ≈ 2-3 面；可调 0~8）。
 */

/** 眼前屏：段落严格落在当前视口内 */
function isImmediateScreen(el: Element): boolean {
  try {
    const win = el.ownerDocument?.defaultView;
    if (!win) return true;
    const vw = win.innerWidth || 800;
    const vh = win.innerHeight || 800;
    const r = el.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return false; // 未布局
    // 2026-08-28 边缘可见性优化：原逻辑要求段落「完全」在视口内
    // (r.bottom > 0 && r.top < vh) → 页面底部的段落顶部在视口内、但底部/译文
    // 超出视口时，isImmediateScreen 仍返回 true（我们译的是顶部可见的段落），
    // 译文作为子节点(appendChild)自然跟在原文尾部、随滚动流入视口，不会被裁切丢失。
    // 仅当段落整体在视口上方(r.bottom <= 0)或完全在右侧(r.left >= vw)时才跳过。
    return r.bottom > 0 && r.top < vh && r.left < vw && r.right > 0;
  } catch {
    return true;
  }
}

/** 后面预取范围：当前屏之后 N 面（单向往后，不预取前面——前面靠缓存）。
 *  @param prefetchPages 预取页数（来自 getPrefetchPages 回调，默认 2.5） */
function isPrefetchAhead(el: Element, prefetchPages: number): boolean {
  try {
    const win = el.ownerDocument?.defaultView;
    if (!win) return false;
    const vw = win.innerWidth || 800;
    const vh = win.innerHeight || 800;
    const r = el.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return false; // 未布局
    // 预取窗口：当前屏之后 prefetchPages 屏（即 prefetchPages 面）
    const PF = prefetchPages > 0 ? prefetchPages : 2.5;
    // 滚动模式：当前屏下方 PF 屏内（横向需仍在视口列内，避免预取隔页内容）
    const below = r.top >= 0 && r.top < vh * (1 + PF) && r.left < vw && r.right > 0;
    // 分页模式：当前屏右方 PF 页内（纵向需仍在视口行内）
    const right = r.left >= 0 && r.left < vw * (1 + PF) && r.top < vh && r.bottom > 0;
    return below || right;
  } catch {
    return false;
  }
}

export function createBilingual(opts: BilingualOptions): BilingualHandle {
  let enabled = false;
  const visibleOnly = opts.visibleOnly !== false;
  let injectTimer: any = null;
  const from = opts.from || "auto";
  const to = opts.to || "zh";

  // 2026-08-28 防重入锁：injectAll 是 async（AI 等待 5-30 秒），期间
  // relocate/load 会频繁触发 onViewLoad()→scheduleInject()。若无锁，
  // 每次 scheduleInject 到点都会发起新的翻译请求 → 请求风暴。
  // injecting=true 时 scheduleInject 只重置定时器（合并为一次），不并发。
  let injecting = false;

  /** 取某内容文档下「待注入」的段落（已注入的自动跳过）。
   *  每段的 `prev` 字段携带同文档内它之前最多 2 段的正文（截断），
   *  作为翻译时的「前文参考」上下文（模型无需翻译，仅用于理解语境）。 */
  function getSegments(doc: Document): Array<{ el: Element; text: string; prev: string }> {
    const all = Array.from(doc.querySelectorAll(`${BLOCK}, ${LEAF_DIV}`)) as Element[];
    const out: Array<{ el: Element; text: string; prev: string }> = [];
    // 滚动窗口：最近最多 4 段原文（截断后），用于生成「前文参考」
    let recent: string[] = [];
    for (const el of all) {
      // 跳过代码 / 公式 / 样式 / 脚本等不应翻译的节点
      if (el.closest(EXCLUDED)) continue;
      // ★ 三重译文根治（2026-08-28 v2）：injectAll 把译文 appendChild 成
      //   <div class="reword-bilingual" data-translation-mark="1">。该节点本身也会被
      //   `${LEAF_DIV}`(div) 选择器命中收集 → 若不排除会被当成「新段落」再次送译并
      //   嵌套进自己内部，叠加多次 relocate/重建就出现 2~3 条相同译文。
      //   因此：凡带 reword-bilingual class 或 data-translation-mark 的节点直接跳过。
      if ((el as HTMLElement).classList?.contains("reword-bilingual")) continue;
      if (el.hasAttribute("data-translation-mark")) continue;
      // div 仅作「叶子文本块」兜底：若 div 内含任何块级子孙（p/li/blockquote/div）则
      // 跳过，改译其内部真实块——避免 <div class="a"><div class="b">文字</div></div>
      // 被算成两段（内层 div 才是真段落）。这是上一轮「div 只查 BLOCK」规则的补强。
      if (el.tagName === "DIV" && el.querySelector("p, li, blockquote, div")) continue;
      // 容器（blockquote/li）内的块跳过，改译容器整体（避免 p 与 li 重复计数）
      if (el.parentElement?.closest(CONTAINER)) continue;
      // 跳过已注入译文的（子节点译文 / 已打标记的原文元素）
      // 2026-08-28 三重译文修复：① 查子节点（appendChild 注入后译文是子节点）；
      //         ② 查 data-reword-translated 标记（跨 Document 重建仍稳定保留在节点上）。
      const hasChild = !!el.querySelector(":scope > .reword-bilingual");
      const hasMark = el.hasAttribute("data-reword-translated");
      if (hasChild || hasMark) continue;
      // 2026-08-30 单段补救：用户主动「隐藏」的段落（data-reword-hide）跳过，
      // 不再注入译文——避免「为隐藏一段被迫重译整本」的荒谬成本。
      if (el.hasAttribute("data-reword-hide")) continue;
      const text = cleanText(el.textContent || "");
      if (!text) continue;
      // 前文参考：最近最多 2 段（截断至 160 字符），控制 token 增量
      const prev = recent.slice(-2).join("\n");
      out.push({ el, text, prev });
      const short = text.length > 160 ? text.slice(0, 160) : text;
      recent.push(short);
      if (recent.length > 4) recent.shift();
    }
    return out;
  }

  async function injectAll(): Promise<void> {
    if (!enabled) return;

    // 2026-08-28 防重入：上一次 injectAll 还在跑（AI 等待中），
    // 后续调用直接跳过——scheduleInject 已把最新意图合并到定时器里。
    if (injecting) {
      log("[REword] 双语: 防重入跳过（上一轮注入仍在执行）");
      return;
    }
    injecting = true;

    const docs = opts.getContents() || [];
    log("[REword] 双语 injectAll: getContents 返回", docs.length, "个文档");
    // 预取页数（动态，来自设置面板；默认 2.5 屏 ≈ 2-3 面）
    const prefetchPages = opts.getPrefetchPages ? (opts.getPrefetchPages() || 2.5) : 2.5;
    // 两阶段收集：imm = 眼前屏（注入显示）；prefetch = 后面 N 面（翻译+缓存，不注入）
    // section = 该段所属「节」序号（1-based，对应 docs 数组下标 +1），用于缓存页码统计
    interface Pending { doc: Document; el: Element; text: string; section: number; prev: string }
    const imm: Pending[] = [];
    const prefetch: Pending[] = [];
    docs.forEach((doc, di) => {
      const section = di + 1;
      const segs = getSegments(doc);
      log(`[REword] 双语 doc#${di}: getSegments 找到 ${segs.length} 段`);
      for (const seg of segs) {
        if (!visibleOnly) {
          // 测试 / 全译模式：所有段都当眼前屏（注入）
          imm.push({ doc, el: seg.el, text: seg.text, section, prev: seg.prev });
          continue;
        }
        // 2026-08-28 两阶段：眼前屏立即注入；后面 N 面预取缓存（N=prefetchPages 可调）
        if (isImmediateScreen(seg.el)) imm.push({ doc, el: seg.el, text: seg.text, section, prev: seg.prev });
        else if (isPrefetchAhead(seg.el, prefetchPages)) prefetch.push({ doc, el: seg.el, text: seg.text, section, prev: seg.prev });
      }
    });
    log(`[REword] 双语: 眼前屏 ${imm.length} 段，预取 ${prefetch.length} 段 (visibleOnly=${visibleOnly})`);
    // 2026-08-28 安全阀：visibleOnly 全过滤（未布局异常）时降级译前 8 段当眼前屏
    if (!imm.length && !prefetch.length && visibleOnly) {
      log("[REword] 双语: visibleOnly 全过滤，触发安全阀取前 8 段");
      for (let di = 0; di < docs.length && imm.length < 8; di++) {
        const doc = docs[di];
        const section = di + 1;
        for (const seg of getSegments(doc)) {
          imm.push({ doc, el: seg.el, text: seg.text, section, prev: seg.prev });
          if (imm.length >= 8) break;
        }
      }
    }
    // 合并一次翻译（眼前 + 预取一起送，省 token）；预取段译文由
    // translateBatch 内部 translationCache.setBatch 自动入缓存。
    const pending: Pending[] = [...imm, ...prefetch];
    if (!pending.length) {
      console.warn("[REword] 双语: 无待译段落，退出");
      injecting = false;
      return;
    }
    const total = imm.length; // 进度按眼前屏计（预取是后台）
    log(`[REword] 双语: 开始翻译 ${pending.length} 段（眼前 ${imm.length} + 预取 ${prefetch.length}）...`);
    // 2026-08-30：翻译上下文——① 每段前文参考（理解语境，不翻译）；② 书籍元数据（书名/作者/语言/目录）
    const ctxBefore = pending.map((p) => (p.prev && p.prev.trim() ? p.prev : null));
    const meta = opts.bookMeta ? opts.bookMeta() : null;
    try {
      // 2026-08-28 加超时保护：AI 调用可能因网络/API 问题挂起永不返回。
      // 给 60 秒上限，超时后 reject 让 catch 兜底提示用户。
      const pendingTexts = pending.map((p) => p.text);
      // 2026-08-30 透明化：优先用 translateBatchDetailed（回传 provider / fromCache）
      // 供来源徽标与缓存标记；未提供时回落 translateBatch（徽标退化为不显示来源）。
      const detailOrText = await Promise.race([
        (opts.translateBatchDetailed
          ? opts.translateBatchDetailed(pendingTexts, from, to, opts.bookId, ctxBefore, meta, { mode: "default" })
          : opts.translateBatch(pendingTexts, from, to, opts.bookId, ctxBefore, meta, { mode: "default" }).then((t) => ({
              texts: t,
              providers: t.map(() => null as string | null),
              fromCache: t.map(() => false),
            }))),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("翻译超时(60s)：AI 服务无响应，请检查网络与 API 配置")), 60000)
        ),
      ]);
      const translations: string[] = detailOrText.texts;
      const providers: (string | null)[] = detailOrText.providers;
      const fromCacheAll: boolean[] = detailOrText.fromCache;
      log(`[REword] 双语: AI 返回 ${translations.length} 条，非空 ${translations.filter(t => t?.trim()).length} 条`);
      // 2026-08-28：记录本次成功缓存的「节」序号（1-based），供 UI 展示「第 X-Y 页缓存成功」
      if (opts.onSectionsCached) {
        const secSet = new Set<number>();
        pending.forEach((p, i) => {
          const tr = (translations[i] || "").trim();
          if (tr && typeof p.section === "number" && p.section > 0) secSet.add(p.section);
        });
        if (secSet.size) {
          opts.onSectionsCached(opts.bookId, [...secSet].sort((a, b) => a - b));
        }
      }
      // 中断安全：等待期间用户已关闭双语 → 丢弃结果，不注入
      if (!enabled) { injecting = false; return; }
      let done = 0;
      // 仅注入「眼前屏」段（prefetch 段已入缓存，等滚到时命中缓存秒出）
      // 用 for 循环（非 forEach）以支持 await getFix（用户修正库查询可能为异步）
      for (let i = 0; i < imm.length; i++) {
        const p = imm[i];
        const srcText = p.text;
        // 2026-08-30 单段补救：用户修正库最高优先级，覆盖 AI 缓存与实时翻译
        const fixTr = opts.getFix ? ((await opts.getFix(srcText)) || "") : "";
        const tr = (fixTr || "").trim() || (translations[i] || "").trim();
        // 等待期间节点可能已被 foliate 重渲移除，注入前复查仍在文档中
        if (!p.el.isConnected) continue;
        // 2026-08-28 三重译文修复：注入前二次复查（Readest 同款做法）。
        if (p.el.hasAttribute("data-reword-translated") || p.el.querySelector(":scope > .reword-bilingual")) {
          log("[REword] 双语: 二次复查跳过已注入段落:", (srcText || "").slice(0, 30));
          continue;
        }
        if (!tr) {
          // 2026-08-30 透明化：翻译失败（且无修正）不再静默留白，注入失败占位 + 重试按钮
          injectFailed(p);
          continue;
        }
        const div = buildBilingualDiv(p.doc, {
          tr,
          provider: fixTr && fixTr.trim() ? "fixed" : (providers[i] || (fromCacheAll[i] ? "cache" : null)),
          fromCache: !!fromCacheAll[i] && !(fixTr && fixTr.trim()),
          srcText,
          prevText: p.prev || "",
          fixed: !!(fixTr && fixTr.trim()),
        });
        p.el.appendChild(div);
        p.el.setAttribute("data-reword-translated", "1");
        done++;
      }
      log(`[REword] 双语: 眼前屏注入 ${done}/${imm.length} 段，预取 ${prefetch.length} 段已缓存`);
      // 2026-08-28 诊断：眼前屏 0 段注入成功（AI 返回空 / 格式错）→ 提示根因。
      // 用户侧 toast 已由 onProgress(0, total) 触发（ReaderView 整批失败提示）。
      if (done === 0 && imm.length > 0) {
        console.warn("[REword] 双语: 眼前屏 0 段注入成功（AI 返回空译文或模型未遵守 [[序号]] 格式）");
      }
      opts.onProgress?.(done, total);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[REword] 双语注入失败:", e);
      // 通知 UI 层（进度回调 done < total 且 active=false 表示失败）
      opts.onProgress?.(0, total);
    } finally {
      injecting = false;
    }
  }

  // 2026-08-30: 段落级"重新翻译为简洁版"实现
  //  - in-flight 用 raw FNV-1a（无 salt）做 key：用户连点同段时只跑一次
  //  - doc 上挂 __rewordConciseBound 标志，foliate 翻页重建 Document 时 onViewLoad 重绑
  //  - 按钮 click 走 doc 级事件委托：避免给每个 .reword-bilingual 单独 add/remove listener
  const conciseInflight = new Set<string>();
  function originalTextHash(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  /** 来源徽标友好文本（data-provider → 中文短标签） */
  function badgeText(provider: string | null): string {
    switch (provider) {
      case "fixed": return "已修正";
      case "cache": return "缓存";
      case "microsoft": return "微软";
      case "libretranslate": return "Libre";
      case "none": return "失败";
      default: return provider ? "AI" : "";
    }
  }

  /** 从原文元素提取纯净正文（跳过已注入译文块与其标记） */
  function extractOriginalText(pEl: Element | null): string {
    if (!pEl) return "";
    let originalText = "";
    for (const child of Array.from(pEl.childNodes) as Array<ChildNode & Element>) {
      const c = child as unknown as Element;
      if (!c) continue;
      if (c.classList && c.classList.contains && c.classList.contains("reword-bilingual")) continue;
      if (c.hasAttribute && c.hasAttribute("data-translation-mark")) continue;
      originalText += c.textContent || "";
    }
    return cleanText(originalText);
  }

  /** 取前文参考（同文档前 2 段，截断 160 字，供重译/修正时送语境） */
  function prevOf(pEl: Element | null): string {
    if (!pEl) return "";
    const prev: string[] = [];
    let cur: Element | null = pEl.previousElementSibling;
    while (cur && prev.length < 2) {
      const t = cleanText(cur.textContent || "").slice(0, 160);
      if (t) prev.unshift(t);
      cur = cur.previousElementSibling;
    }
    return prev.join("\n");
  }

  /** 构建译文块右上角操作按钮组（hover 显形，由 CSS 控制） */
  function buildActions(doc: Document): HTMLElement {
    const wrap = doc.createElement("span");
    wrap.className = "reword-bilingual-actions";
    const actions: Array<[string, string, string]> = [
      ["retranslate", "↻ 重译", "重新翻译此段（覆盖缓存，并清除手动修正）"],
      ["fix", "✎ 修正", "修正此段译文并钉选为正确答案"],
      ["concise", "🔄 简洁版", "切换精简 / 原版译文"],
      ["hide", "× 隐藏", "隐藏此段译文"],
    ];
    for (const [action, label, title] of actions) {
      const b = doc.createElement("button");
      b.className = "reword-bilingual-action";
      b.setAttribute("data-action", action);
      b.setAttribute("type", "button");
      b.setAttribute("title", title);
      b.textContent = label;
      wrap.appendChild(b);
    }
    return wrap;
  }

  interface BilingualDivOpts {
    tr: string; provider: string | null; fromCache: boolean;
    srcText: string; prevText: string; fixed: boolean;
  }
  /** 构建一条完整译文块（含文字、来源徽标、操作按钮、溯源 data-*） */
  function buildBilingualDiv(doc: Document, o: BilingualDivOpts): HTMLElement {
    const div = doc.createElement("div");
    div.className = "reword-bilingual";
    div.setAttribute("data-translation-mark", "1");
    div.style.position = "relative";
    const trSpan = doc.createElement("span");
    trSpan.className = "reword-bilingual-text";
    trSpan.textContent = o.tr;
    div.appendChild(trSpan);
    // 来源徽标（默认显示；data-provider 供 CSS 着色区分缓存/AI/修正/兜底）
    const showBadge = opts.showProvider ? (typeof opts.showProvider === "function" ? opts.showProvider() : opts.showProvider) : true;
    if (showBadge) {
      const bt = badgeText(o.provider);
      if (bt) {
        const badge = doc.createElement("span");
        badge.className = "reword-bilingual-badge";
        badge.textContent = bt;
        badge.setAttribute("data-provider", o.provider || "");
        div.appendChild(badge);
      }
    }
    // 溯源数据：原文 / 前文参考（供 tooltip / 调试展示，不显示也不污染 CFI）
    div.setAttribute("data-src-text", o.srcText);
    div.setAttribute("data-prev-text", o.prevText);
    div.setAttribute("data-mode", "default");
    if (o.fixed) div.setAttribute("data-fixed", "1");
    if (o.fromCache) div.setAttribute("data-from-cache", "1");
    div.setAttribute("data-provider", o.provider || "");
    // 2026-08-30 调试信息：开启时译文块 title 显示送译原文 + 前文参考 + 引擎
    const debugOn = opts.debug ? (typeof opts.debug === "function" ? opts.debug() : opts.debug) : false;
    if (debugOn) {
      const provLabel = badgeText(o.provider) || "未知";
      div.setAttribute("title", `原文：${o.srcText}\n前文：${o.prevText}\n引擎/来源：${provLabel}${o.fromCache ? "（缓存命中）" : ""}`);
    }
    div.appendChild(buildActions(doc));
    return div;
  }

  /** 翻译失败（且无修正）时注入的占位块 + 重试按钮（不再静默留白） */
  function injectFailed(p: { doc: Document; el: Element; text: string; prev: string }): void {
    const div = p.doc.createElement("div");
    div.className = "reword-bilingual reword-bilingual-failed";
    div.setAttribute("data-translation-mark", "1");
    div.setAttribute("data-failed", "1");
    div.style.position = "relative";
    const span = p.doc.createElement("span");
    span.className = "reword-bilingual-text reword-bilingual-failed-text";
    span.textContent = "⚠ 翻译失败";
    div.appendChild(span);
    const retry = p.doc.createElement("button");
    retry.className = "reword-bilingual-action";
    retry.setAttribute("data-action", "retry");
    retry.setAttribute("type", "button");
    retry.setAttribute("title", "重试翻译此段");
    retry.textContent = "↻ 重试";
    div.appendChild(retry);
    div.setAttribute("data-src-text", p.text);
    div.setAttribute("data-prev-text", p.prev || "");
    p.el.appendChild(div);
    p.el.setAttribute("data-reword-translated", "1");
  }

  /** 更新译文块的来源徽标（重译/修正后刷新显示） */
  function updateBadge(el: HTMLElement, provider: string | null): void {
    let badge = el.querySelector(".reword-bilingual-badge") as HTMLElement | null;
    const bt = badgeText(provider);
    if (!bt) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = el.ownerDocument.createElement("span");
      badge.className = "reword-bilingual-badge";
      const textNode = el.querySelector(".reword-bilingual-text");
      if (textNode) el.insertBefore(badge, textNode.nextSibling);
      else el.appendChild(badge);
    }
    badge.textContent = bt;
    badge.setAttribute("data-provider", provider || "");
    el.setAttribute("data-provider", provider || "");
  }

  /** 用新译文替换译文块内容（重译/重试后重建文字 + 徽标，保留按钮组） */
  function replaceBilingualContent(el: HTMLElement, o: BilingualDivOpts): void {
    const trSpan = el.querySelector(".reword-bilingual-text");
    if (trSpan) trSpan.textContent = o.tr;
    else {
      const span = el.ownerDocument.createElement("span");
      span.className = "reword-bilingual-text";
      span.textContent = o.tr;
      el.insertBefore(span, el.firstChild);
    }
    // 重试成功：清除失败态（若此前是失败占位块）
    el.classList.remove("reword-bilingual-failed");
    el.removeAttribute("data-failed");
    el.setAttribute("data-src-text", o.srcText);
    el.setAttribute("data-prev-text", o.prevText);
    el.setAttribute("data-mode", "default");
    if (o.fixed) el.setAttribute("data-fixed", "1"); else el.removeAttribute("data-fixed");
    if (o.fromCache) el.setAttribute("data-from-cache", "1"); else el.removeAttribute("data-from-cache");
    const debugOn = opts.debug ? (typeof opts.debug === "function" ? opts.debug() : opts.debug) : false;
    if (debugOn) {
      const provLabel = badgeText(o.provider) || "未知";
      el.setAttribute("title", `原文：${o.srcText}\n前文：${o.prevText}\n引擎/来源：${provLabel}${o.fromCache ? "（缓存命中）" : ""}`);
    } else {
      el.removeAttribute("title");
    }
    updateBadge(el, o.provider);
  }

  async function retranslateConcise(el: HTMLElement): Promise<boolean> {
    if (!el || !el.isConnected) return false;
    const pEl = el.parentElement;
    const originalText = extractOriginalText(pEl);
    if (!originalText) return false;
    const currentMode = el.getAttribute("data-mode") || "default";
    const targetMode: "default" | "concise" = currentMode === "concise" ? "default" : "concise";
    return await retranslateWithMode(el, originalText, targetMode);
  }

  async function retranslateWithMode(
    el: HTMLElement,
    originalText: string,
    targetMode: "default" | "concise"
  ): Promise<boolean> {
    const inFlightKey = originalTextHash(originalText);
    if (conciseInflight.has(inFlightKey)) return false;
    conciseInflight.add(inFlightKey);
    const prevText = prevOf(el.parentElement);
    const meta = opts.bookMeta ? opts.bookMeta() : null;
    try {
      // 优先用 detailed（更新来源徽标）；回落 translateBatch
      let tr = "";
      let provider: string | null = null;
      if (opts.translateBatchDetailed) {
        const det = await opts.translateBatchDetailed([originalText], from, to, opts.bookId, [prevText || null], meta, { mode: targetMode });
        tr = (det.texts[0] || "").trim();
        provider = det.providers[0] || (det.fromCache[0] ? "cache" : null);
      } else {
        const t = await opts.translateBatch([originalText], from, to, opts.bookId, [prevText || null], meta, { mode: targetMode });
        tr = (t[0] || "").trim();
      }
      if (!tr) { console.warn("[REword] 双语 简洁版: AI 返回空，原译文保留"); return false; }
      replaceBilingualContent(el, { tr, provider, fromCache: false, srcText: originalText, prevText, fixed: false });
      el.setAttribute("data-mode", targetMode);
      const conciseBtn = el.querySelector('[data-action="concise"]') as HTMLElement | null;
      if (conciseBtn) {
        if (targetMode === "concise") {
          conciseBtn.textContent = "↩ 原版";
          conciseBtn.setAttribute("title", "还原为默认译文");
          conciseBtn.classList.add("reword-bilingual-mode-concise");
        } else {
          conciseBtn.textContent = "🔄 简洁版";
          conciseBtn.setAttribute("title", "重新翻译为简洁版");
          conciseBtn.classList.remove("reword-bilingual-mode-concise");
        }
      }
      return true;
    } catch (e) {
      console.warn("[REword] 双语 简洁版: 调用失败，原译文保留", e);
      return false;
    } finally {
      conciseInflight.delete(inFlightKey);
    }
  }

  /**
   * 单段重译（覆盖缓存）：让 AI 重新翻译该段并写回缓存，同时清除手动修正
   * （用户点「重译」即表示放弃旧手动修正、要 AI 重来）。
   */
  async function retranslateOne(el: HTMLElement, overwrite = true): Promise<boolean> {
    if (!el || !el.isConnected) return false;
    const pEl = el.parentElement;
    const originalText = extractOriginalText(pEl);
    if (!originalText) return false;
    if (opts.deleteFix) { try { await opts.deleteFix(originalText); } catch { /* ignore */ } }
    const prevText = prevOf(pEl);
    const meta = opts.bookMeta ? opts.bookMeta() : null;
    try {
      let tr = "";
      let provider: string | null = null;
      if (opts.translateBatchDetailed) {
        const det = await opts.translateBatchDetailed([originalText], from, to, opts.bookId, [prevText || null], meta, { mode: "default", overwrite });
        tr = (det.texts[0] || "").trim();
        provider = det.providers[0] || (det.fromCache[0] ? "cache" : null);
      } else {
        const t = await opts.translateBatch([originalText], from, to, opts.bookId, [prevText || null], meta, { mode: "default", overwrite });
        tr = (t[0] || "").trim();
      }
      if (!tr) { console.warn("[REword] 双语 重译: 返回空，原译文保留"); return false; }
      replaceBilingualContent(el, { tr, provider, fromCache: false, srcText: originalText, prevText, fixed: false });
      return true;
    } catch (e) {
      console.warn("[REword] 双语 重译失败", e);
      return false;
    }
  }

  /**
   * 单段修正（钉选正确答案）：把译文 span 转为 contenteditable，回车提交、
   * Esc 取消；提交后写入用户修正库并标 data-fixed，来源徽标显示「已修正」。
   */
  async function startFix(el: HTMLElement): Promise<void> {
    if (!el || !el.isConnected) return;
    const pEl = el.parentElement;
    const srcText = extractOriginalText(pEl);
    if (!srcText) return;
    const trSpan = el.querySelector(".reword-bilingual-text") as HTMLElement | null;
    if (!trSpan || trSpan.getAttribute("contenteditable") === "true") return;
    const original = trSpan.textContent || "";
    // 用 setAttribute（而非 IDL 属性 .contentEditable）确保「编辑态」可经
    // data 属性可靠探测（JSDOM 不反射 IDL 属性；真实浏览器二者等效）。
    trSpan.setAttribute("contenteditable", "true");
    trSpan.classList.add("reword-bilingual-editing");
    trSpan.focus();
    const onKey = async (ev: KeyboardEvent) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        trSpan.removeEventListener("keydown", onKey);
        trSpan.setAttribute("contenteditable", "false");
        trSpan.classList.remove("reword-bilingual-editing");
        const newTr = (trSpan.textContent || "").trim();
        if (!newTr) { trSpan.textContent = original; return; }
        if (opts.setFix) { try { await opts.setFix(srcText, newTr); } catch (e) { console.warn("[REword] 双语 修正写库失败", e); } }
        el.setAttribute("data-fixed", "1");
        updateBadge(el, "fixed");
        } else if (ev.key === "Escape") {
        ev.preventDefault();
        trSpan.removeEventListener("keydown", onKey);
        trSpan.setAttribute("contenteditable", "false");
        trSpan.classList.remove("reword-bilingual-editing");
        trSpan.textContent = original;
      }
    };
    trSpan.addEventListener("keydown", onKey);
  }

  /**
   * 单段隐藏：移除译文显示 + 标记 data-reword-hide（getSegments 永久跳过，
   * 不再注入）；同时清掉该段 AI 缓存与用户修正，避免刷新/重开后又冒出。
   * 恢复方式：关闭再开双语会清除 hide 标记（removeAll）。
   */
  function hideOne(el: HTMLElement): void {
    if (!el || !el.isConnected) return;
    const pEl = el.parentElement;
    const srcText = extractOriginalText(pEl);
    el.remove();
    if (srcText) {
      if (opts.deleteFix) { try { opts.deleteFix(srcText); } catch { /* ignore */ } }
      if (opts.deleteCacheOne) { try { opts.deleteCacheOne(srcText); } catch { /* ignore */ } }
    }
    if (pEl) {
      pEl.removeAttribute("data-reword-translated"); // 允许后续（若取消隐藏）重译
      pEl.setAttribute("data-reword-hide", "1");      // getSegments 跳过
    }
  }

  function bindBilingualHandlers(): void {
    const docs = opts.getContents() || [];
    for (const d of docs) {
      const docAny = d as Document & { __rewordBilingualBound?: boolean };
      if (docAny.__rewordBilingualBound) continue;
      d.addEventListener("click", (e: MouseEvent) => {
        const t = e.target as Element | null;
        if (!t) return;
        const btn = t.closest ? t.closest(".reword-bilingual-action") : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const action = btn.getAttribute("data-action");
        const wrap = btn.closest ? btn.closest(".reword-bilingual") : null;
        if (!wrap) return;
        const el = wrap as HTMLElement;
        if (action === "concise") {
          retranslateConcise(el).catch((err) => console.warn("[REword] 双语 简洁版: handle 失败", err));
        } else if (action === "retranslate" || action === "retry") {
          retranslateOne(el, true).catch((err) => console.warn("[REword] 双语 重译: handle 失败", err));
        } else if (action === "fix") {
          startFix(el).catch((err) => console.warn("[REword] 双语 修正: handle 失败", err));
        } else if (action === "hide") {
          hideOne(el);
        }
      });
      docAny.__rewordBilingualBound = true;
    }
  }
  bindBilingualHandlers();

  function scheduleInject(delay = 300): void {
    if (!enabled) return;
    clearTimeout(injectTimer);
    injectTimer = setTimeout(() => {
      injectAll();
    }, delay);
  }

  function removeAll(): void {
    const docs = opts.getContents() || [];
    for (const doc of docs) {
      doc.querySelectorAll(".reword-bilingual").forEach((n) => n.remove());
      // 2026-08-28 三重译文修复：清理 data-reword-translated 标记，否则关闭再开时
      // getSegments 仍认为旧节点「已译」→ 跳过翻译 → 译文不重现。
      doc.querySelectorAll("[data-reword-translated]").forEach((n) =>
        n.removeAttribute("data-reword-translated")
      );
      // 2026-08-30 单段补救：关闭双语时一并清除「隐藏」标记，使重新开启后
      // 被隐藏的段落能再次翻译显示（隐藏仅对当前会话生效，非永久删除）。
      doc.querySelectorAll("[data-reword-hide]").forEach((n) =>
        n.removeAttribute("data-reword-hide")
      );
    }
  }

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(on: boolean) {
      log(`[REword] 双语 setEnabled(${on}), 当前 enabled=${enabled}`);
      enabled = on;
      if (on) {
        // 2026-08-28 修复：injectAll 是 async，reject 变 unhandledRejection。
        // 用 .catch() 接住，避免影响 Svelte/思源运行时。
        injectAll().catch((e) => {
          console.warn("[REword] 双语注入异常（已忽略）:", e);
        });
      } else {
        clearTimeout(injectTimer);
        injecting = false; // 重置防重入锁
        // 2026-08-28 修复：removeAll 访问 foliate 分节文档，翻页/重载瞬间
        // 文档可能部分销毁而抛异常。enabled 已置 false 是首要目标，
        // 移除节点失败不应冒泡阻断调用方状态复位。
        try {
          removeAll();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("[REword] 关闭双语移除注入节点失败（已忽略）:", e);
        }
      }
    },
    retranslateConcise,
    refresh() {
      if (enabled) injectAll();
    },
    onViewLoad() {
      scheduleInject(300);
      bindBilingualHandlers();
    },
    segmentStats(): { count: number; chars: number } {
      const docs = opts.getContents() || [];
      let count = 0;
      let chars = 0;
      for (const doc of docs) {
        for (const seg of getSegments(doc)) {
          count++;
          chars += seg.text.length;
        }
      }
      return { count, chars };
    },

    segmentTexts(): string[] {
      const docs = opts.getContents() || [];
      const out: string[] = [];
      for (const doc of docs) {
        for (const seg of getSegments(doc)) out.push(seg.text);
      }
      return out;
    },

    async pretranslateAll(pt?: PretranslateOptions): Promise<void> {
      // pt 为预翻译细化选项；外层 opts 为 createBilingual 配置（bookId/translateBatch 等）
      const target = pt?.to || to;
      const batchSize = Math.max(1, Math.min(pt?.batchSize ?? 8, 32));
      const concurrency = Math.max(1, Math.min(pt?.concurrency ?? 1, 6));
      const overwrite = !!pt?.overwrite;
      const signal = pt?.signal;
      const meta = opts.bookMeta ? opts.bookMeta() : null;

      // 仅收集段落文本 + 前文参考（不注入 DOM、不标记译文）
      const docs = opts.getContents() || [];
      const all: Array<{ text: string; prev: string }> = [];
      docs.forEach((doc) => {
        for (const seg of getSegments(doc)) all.push({ text: seg.text, prev: seg.prev });
      });
      const total = all.length;
      if (!total) {
        pt?.onProgress?.({ done: 0, total: 0, cached: 0, pending: 0, status: "done", estTokens: 0 });
        return;
      }

      // 计算待译：overwrite 或无法查缓存时全部待译；否则用 checkCached 过滤已缓存段
      let cachedFlags: boolean[] | null = null;
      if (!overwrite && opts.checkCached) {
        try {
          cachedFlags = await opts.checkCached(all.map((s) => s.text));
        } catch {
          cachedFlags = null;
        }
      }
      const workIdx: number[] = [];
      const cachedCount = cachedFlags ? cachedFlags.filter(Boolean).length : 0;
      all.forEach((_, i) => {
        if (cachedFlags ? !cachedFlags[i] : true) workIdx.push(i);
      });
      const pending = workIdx.length;
      const estTokens = Math.max(0, Math.round(workIdx.reduce((s, i) => s + all[i].text.length, 0) / 4));

      // 初始进度（running 态、done=0）
      pt?.onProgress?.({
        done: 0, total, cached: cachedCount, pending,
        status: "running", estTokens, etaSeconds: undefined,
      });

      if (!pending) {
        // 全部已缓存，无需翻译
        pt?.onProgress?.({ done: 0, total, cached: total, pending: 0, status: "done", estTokens: 0 });
        return;
      }
      if (signal?.aborted) {
        pt?.onProgress?.({ done: 0, total, cached: cachedCount, pending, status: "cancelled", estTokens });
        return;
      }

      const startedAt = Date.now();
      let done = 0;
      // 按 batchSize 切分待译索引为多个 batch
      const batches: number[][] = [];
      for (let i = 0; i < workIdx.length; i += batchSize) batches.push(workIdx.slice(i, i + batchSize));
      let nextBatch = 0;
      const runBatch = async (): Promise<void> => {
        while (nextBatch < batches.length) {
          if (signal?.aborted) return;
          const idxs = batches[nextBatch++];
          const slice = idxs.map((i) => all[i]);
          const texts = slice.map((s) => s.text);
          const ctx = slice.map((s) => (s.prev ? s.prev : null));
          try {
            await opts.translateBatch(
              texts, from, target, opts.bookId, ctx, meta,
              { model: pt?.model, overwrite, signal }
            );
          } catch (e) {
            // 单批失败不阻断整书预翻译（后续重跑可续译未缓存段）
            console.warn("[REword] 整书预翻译批次失败（已忽略，可重跑续译）:", e);
          }
          done += idxs.length;
          const elapsed = (Date.now() - startedAt) / 1000;
          const remaining = pending - done;
          const etaSeconds = done > 0 && remaining > 0 ? Math.max(0, Math.round((elapsed / done) * remaining)) : undefined;
          pt?.onProgress?.({
            done, total, cached: cachedCount, pending,
            status: signal?.aborted ? "cancelled" : "running",
            estTokens, etaSeconds,
          });
        }
      };
      try {
        await Promise.all(Array.from({ length: concurrency }, () => runBatch()));
      } catch (e) {
        console.warn("[REword] 整书预翻译被中断或异常:", e);
      }
      if (signal?.aborted) {
        pt?.onProgress?.({ done, total, cached: cachedCount, pending, status: "cancelled", estTokens });
        return;
      }
      pt?.onProgress?.({ done, total, cached: cachedCount, pending, status: "done", estTokens });
    },
    destroy() {
      clearTimeout(injectTimer);
      enabled = false;
      injecting = false;
      removeAll();
    },
  };
}
