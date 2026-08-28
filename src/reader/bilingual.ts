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
export interface BilingualOptions {
  bookId: string;
  /** 返回当前 foliate 内容文档数组（传入方负责把 [{doc}] 解成真实 Document[]） */
  getContents: () => Document[];
  /** 批量翻译（异步，返回与输入同序同长的译文数组） */
  translateBatch: (texts: string[], from: string, to: string, bookId: string) => Promise<string[]>;
  /** 源语言（默认 auto） */
  from?: string;
  /** 目标语言（默认 zh） */
  to?: string;
  /** 进度回调（done / total，按本轮送译数计） */
  onProgress?: (done: number, total: number) => void;
  /** Token 用量回调（每次翻译批次完成后调用；累计值跨批次累加） */
  onTokenUsage?: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
  /** 可视过滤开关（默认 true；测试可关掉以翻译全部段落） */
  visibleOnly?: boolean;
}

export interface BilingualHandle {
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  /** 立即重新扫描并注入（如设置变更后） */
  refresh(): void;
  /** foliate 加载新内容（翻页）或滚动/跳转（relocate）时调用 */
  onViewLoad(): void;
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
 * 模式下一页宽 ≈ 一面（横向 vw）。预取窗口取后面 2.5 屏（即 2-3 面）。
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

/** 后面预取范围：当前屏之后 2-3 面（单向往后，不预取前面——前面靠缓存） */
function isPrefetchAhead(el: Element): boolean {
  try {
    const win = el.ownerDocument?.defaultView;
    if (!win) return false;
    const vw = win.innerWidth || 800;
    const vh = win.innerHeight || 800;
    const r = el.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return false; // 未布局
    // 预取窗口：后面 2.5 屏（即 2-3 面）
    const PF = 2.5;
    // 滚动模式：当前屏下方 2.5 屏内（横向需仍在视口列内，避免预取隔页内容）
    const below = r.top >= 0 && r.top < vh * (1 + PF) && r.left < vw && r.right > 0;
    // 分页模式：当前屏右方 2.5 页内（纵向需仍在视口行内）
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

  /** 取某内容文档下「待注入」的段落（已注入的自动跳过） */
  function getSegments(doc: Document): Array<{ el: Element; text: string }> {
    const all = Array.from(doc.querySelectorAll(`${BLOCK}, ${LEAF_DIV}`)) as Element[];
    const out: Array<{ el: Element; text: string }> = [];
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
      const text = cleanText(el.textContent || "");
      if (!text) continue;
      out.push({ el, text });
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
    // 两阶段收集：imm = 眼前屏（注入显示）；prefetch = 后面 2-3 面（翻译+缓存，不注入）
    interface Pending { doc: Document; el: Element; text: string }
    const imm: Pending[] = [];
    const prefetch: Pending[] = [];
    for (const doc of docs) {
      const segs = getSegments(doc);
      log(`[REword] 双语 doc#${docs.indexOf(doc)}: getSegments 找到 ${segs.length} 段`);
      for (const seg of segs) {
        if (!visibleOnly) {
          // 测试 / 全译模式：所有段都当眼前屏（注入）
          imm.push({ doc, el: seg.el, text: seg.text });
          continue;
        }
        // 2026-08-28 两阶段：眼前屏立即注入；后面 2-3 面预取缓存
        if (isImmediateScreen(seg.el)) imm.push({ doc, el: seg.el, text: seg.text });
        else if (isPrefetchAhead(seg.el)) prefetch.push({ doc, el: seg.el, text: seg.text });
      }
    }
    log(`[REword] 双语: 眼前屏 ${imm.length} 段，预取 ${prefetch.length} 段 (visibleOnly=${visibleOnly})`);
    // 2026-08-28 安全阀：visibleOnly 全过滤（未布局异常）时降级译前 8 段当眼前屏
    if (!imm.length && !prefetch.length && visibleOnly) {
      log("[REword] 双语: visibleOnly 全过滤，触发安全阀取前 8 段");
      for (const doc of docs) {
        for (const seg of getSegments(doc)) {
          imm.push({ doc, el: seg.el, text: seg.text });
          if (imm.length >= 8) break;
        }
        if (imm.length >= 8) break;
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
    try {
      // 2026-08-28 加超时保护：AI 调用可能因网络/API 问题挂起永不返回。
      // 给 60 秒上限，超时后 reject 让 catch 兜底提示用户。
      const translations = await Promise.race([
        opts.translateBatch(
          pending.map((p) => p.text),
          from,
          to,
          opts.bookId
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("翻译超时(60s)：AI 服务无响应，请检查网络与 API 配置")), 60000)
        ),
      ]);
      log(`[REword] 双语: AI 返回 ${translations.length} 条，非空 ${translations.filter(t => t?.trim()).length} 条`);
      // 中断安全：等待期间用户已关闭双语 → 丢弃结果，不注入
      if (!enabled) { injecting = false; return; }
      let done = 0;
      // 仅注入「眼前屏」段（prefetch 段已入缓存，等滚到时命中缓存秒出）
      imm.forEach((p, i) => {
        const tr = (translations[i] || "").trim();
        if (!tr) return; // 翻译失败：留空，下次刷新重试
        // 等待期间节点可能已被 foliate 重渲移除，注入前复查仍在文档中
        if (!p.el.isConnected) return;
        // 2026-08-28 三重译文修复：注入前二次复查（Readest 同款做法）。
        // 防止同一段落因 relocate/load 信号重叠被重复注入——getSegments 已查过，
        // 但 AI 等待期间节点状态可能变化，再查一次确保幂等。
        if (p.el.hasAttribute("data-reword-translated") || p.el.querySelector(":scope > .reword-bilingual")) {
          log("[REword] 双语: 二次复查跳过已注入段落:", (p.text || "").slice(0, 30));
          return;
        }
        const div = p.doc.createElement("div");
        div.className = "reword-bilingual";
        // 2026-08-28：标记译文节点，提示 foliate text-walker / 划词逻辑排除，
        // 避免双语开启下划词高亮 CFI 偏移（参考 Readest/anx-reader 实践）。
        div.setAttribute("data-translation-mark", "1");
        div.textContent = tr;
        // 2026-08-28 三重译文修复：统一用 appendChild 注入为子节点（原 el.after 兄弟节点
        // 在 foliate 翻页重建 Document 后去重失效 → 重复译文）。子节点随原文元素重建/
        // 移除而自然生命周期一致，且译文块紧跟原文尾部自然流动（与 Readest 一致）。
        p.el.appendChild(div);
        // 给原文元素打「已译」标记：跨 Document 重建仍保留在节点上，getSegments 据此跳过。
        p.el.setAttribute("data-reword-translated", "1");
        done++;
      });
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
    refresh() {
      if (enabled) injectAll();
    },
    onViewLoad() {
      scheduleInject(300);
    },
    destroy() {
      clearTimeout(injectTimer);
      enabled = false;
      injecting = false;
      removeAll();
    },
  };
}
