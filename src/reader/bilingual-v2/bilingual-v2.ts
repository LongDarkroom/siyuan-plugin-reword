/**
 * bilingual-v2 · 主模块（重做版）
 * ------------------------------------------------------------------
 * 相对 v1（bilingual.ts）的重构要点：
 *  1. 渲染用「兄弟节点」方案（render.ts），原文 DOM 零改动 → CFI/标注/批注/TTS 不受影响。
 *  2. Telemetry 总线（telemetry.ts）从第一天就是基础设施：每次翻译 emit 事件，
 *     引擎看板与成本面板零埋点即可订阅。
 *  3. 唯一 literal 模式：删除 concise / 简洁版 / 重译按钮，prompt 固定「仅释义」。
 *  4. 成本可分解：每批翻译后 emit cost 事件（缓存节省段数 / 各引擎段数 / 字符消耗），
 *     配合 index.ts 已有的 book-token-usage.json，面板可直接展示 token 三类分解。
 *
 * 2026-08-31：v1（bilingual.ts）已删除，本模块成为唯一实现，不再有开关切换。
 * 类型契约见 ../bilingual-types.ts。
 */
import type {
  BilingualOptions,
  BilingualHandle,
  PretranslateOptions,
  PretranslateProgress,
} from "../bilingual-types.ts";
import {
  buildTranslationEl,
  buildFailedEl,
  bindAiRedoDelegation,
  bindHideDelegation,
  injectSibling,
  removeTranslationSibling,
  isTranslatedPeer,
  segHash,
} from "./render.ts";
import { telemetry } from "./telemetry.ts";

/** 真实正文块（首选段落级） */
const BLOCK = "p, li, blockquote";
/** div 仅作叶子文本块兜底：部分 EPUB 用 <div> 而非 <p> 做段落 */
const LEAF_DIV = "div";
/** 不应翻译的节点 */
const EXCLUDED = "pre, code, math, style, script";
/** 作为整体翻译的容器：其内 p/li 跳过，改译容器整体 */
const CONTAINER = "blockquote, li";

function cleanText(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

/** 眼前屏：段落严格落在当前视口内 */
function isImmediateScreen(el: Element): boolean {
  try {
    const win = el.ownerDocument?.defaultView;
    if (!win) return true;
    const vw = win.innerWidth || 800;
    const vh = win.innerHeight || 800;
    const r = el.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return false;
    return r.bottom > 0 && r.top < vh && r.left < vw && r.right > 0;
  } catch {
    return true;
  }
}

/** 后面预取范围：当前屏之后 N 面 */
function isPrefetchAhead(el: Element, prefetchPages: number): boolean {
  try {
    const win = el.ownerDocument?.defaultView;
    if (!win) return false;
    const vw = win.innerWidth || 800;
    const vh = win.innerHeight || 800;
    const r = el.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return false;
    const PF = prefetchPages > 0 ? prefetchPages : 2.5;
    const below = r.top >= 0 && r.top < vh * (1 + PF) && r.left < vw && r.right > 0;
    const right = r.left >= 0 && r.left < vw * (1 + PF) && r.top < vh && r.bottom > 0;
    return below || right;
  } catch {
    return false;
  }
}

export function createBilingualV2(opts: BilingualOptions): BilingualHandle {
  let enabled = false;
  const visibleOnly = opts.visibleOnly !== false;
  let injectTimer: any = null;
  const from = opts.from || "auto";
  const to = opts.to || "zh";
  // 2026-08-31 重新启用简洁版：mode 实时读设置，切换后下一轮注入/预翻译即生效
  const getMode = (): "default" | "concise" =>
    typeof opts.getMode === "function" ? opts.getMode() : (opts.mode || "default");
  let injecting = false;
  let runId = `run-${Date.now()}`;

  /** 取某内容文档下「待注入」的段落（已注入的自动跳过） */
  function getSegments(doc: Document): Array<{ el: Element; text: string; prev: string }> {
    const all = Array.from(doc.querySelectorAll(`${BLOCK}, ${LEAF_DIV}`)) as Element[];
    const out: Array<{ el: Element; text: string; prev: string }> = [];
    let recent: string[] = [];
    for (const el of all) {
      if (el.closest(EXCLUDED)) continue;
      // v2：译文是兄弟节点，不会出现在 BLOCK/LEAF_DIV 内（它紧跟原文之后，
      // 不属于 p/li/blockquote/div 叶子文本块），但保险起见仍排除标记节点。
      if ((el as HTMLElement).classList?.contains("reword-bilingual")) continue;
      if (el.hasAttribute("data-translation-mark")) continue;
      if (el.tagName === "DIV" && el.querySelector("p, li, blockquote, div")) continue;
      if (el.parentElement?.closest(CONTAINER)) continue;
      // v2 幂等：原文节点打了 data-reword-translated（兄弟节点注入时打的），或已有译文兄弟节点
      if (el.hasAttribute("data-reword-translated") || isTranslatedPeer(el)) continue;
      const text = cleanText(el.textContent || "");
      if (!text) continue;
      // 2026-08-31：跳过被用户隐藏的段落（指纹匹配隐藏集合）
      if (opts.isSegmentHidden && opts.isSegmentHidden(segHash(text))) continue;
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
    if (injecting) return; // 防重入
    injecting = true;
    const mode = getMode();
    const docs = opts.getContents() || [];
    const prefetchPages = opts.getPrefetchPages ? (opts.getPrefetchPages() || 2.5) : 2.5;
    interface Pending { doc: Document; el: Element; text: string; section: number; prev: string }
    const imm: Pending[] = [];
    const prefetch: Pending[] = [];
    docs.forEach((doc, di) => {
      const section = di + 1;
      const segs = getSegments(doc);
      for (const seg of segs) {
        if (!visibleOnly) {
          imm.push({ doc, el: seg.el, text: seg.text, section, prev: seg.prev });
          continue;
        }
        if (isImmediateScreen(seg.el)) imm.push({ doc, el: seg.el, text: seg.text, section, prev: seg.prev });
        else if (isPrefetchAhead(seg.el, prefetchPages)) prefetch.push({ doc, el: seg.el, text: seg.text, section, prev: seg.prev });
      }
    });
    if (!imm.length && !prefetch.length && visibleOnly) {
      for (let di = 0; di < docs.length && imm.length < 8; di++) {
        const doc = docs[di];
        const section = di + 1;
        for (const seg of getSegments(doc)) {
          imm.push({ doc, el: seg.el, text: seg.text, section, prev: seg.prev });
          if (imm.length >= 8) break;
        }
      }
    }
    const pending: Pending[] = [...imm, ...prefetch];
    if (!pending.length) { injecting = false; return; }
    const total = imm.length;
    const ctxBefore = pending.map((p) => (p.prev && p.prev.trim() ? p.prev : null));
    const meta = opts.bookMeta ? opts.bookMeta() : null;
    try {
      const t0 = Date.now();
      const detailOrText = await Promise.race([
        (opts.translateBatchDetailed
          ? opts.translateBatchDetailed(pending.map((p) => p.text), from, to, opts.bookId, ctxBefore, meta, { mode })
          : opts.translateBatch(pending.map((p) => p.text), from, to, opts.bookId, ctxBefore, meta, { mode }).then((t) => ({
              texts: t,
              providers: t.map(() => null as string | null),
              fromCache: t.map(() => false),
            }))),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("翻译超时(120s)：AI 服务无响应，请检查网络与 API 配置")), 120000)
        ),
      ]);
      const latencyMs = Date.now() - t0;
      const translations: string[] = detailOrText.texts;
      const providers: (string | null)[] = detailOrText.providers;
      const fromCacheAll: boolean[] = detailOrText.fromCache;

      // —— 成本与引擎状态遥测（v2 核心）——
      const cacheHits = fromCacheAll.filter(Boolean).length;
      const engineCounts: Record<string, number> = {};
      let tencentChars = 0;
      providers.forEach((p, i) => {
        if (!p) return;
        engineCounts[p] = (engineCounts[p] || 0) + 1;
        if (p === "tencent") tencentChars += (pending[i]?.text.length || 0);
      });
      telemetry.emit({
        phase: "done",
        bookId: opts.bookId,
        segmentCount: translations.length,
        latencyMs,
        runId,
      });
      if (cacheHits > 0) {
        telemetry.emit({ phase: "hit", bookId: opts.bookId, engine: "cache", segmentCount: cacheHits, runId });
      }
      for (const [eng, cnt] of Object.entries(engineCounts)) {
        telemetry.emit({
          phase: "try",
          bookId: opts.bookId,
          engine: eng,
          segmentCount: cnt,
          chars: eng === "tencent" ? tencentChars : undefined,
          runId,
        });
      }
      // 成本结算：缓存节省 + 各引擎段数（面板据此分解 token/字符）
      telemetry.emit({
        phase: "cost",
        bookId: opts.bookId,
        segmentCount: translations.length,
        fromCache: cacheHits > 0,
        chars: tencentChars,
        runId,
      });

      if (opts.onSectionsCached) {
        const secSet = new Set<number>();
        pending.forEach((p, i) => {
          const tr = (translations[i] || "").trim();
          if (tr && typeof p.section === "number" && p.section > 0) secSet.add(p.section);
        });
        if (secSet.size) opts.onSectionsCached(opts.bookId, [...secSet].sort((a, b) => a - b));
      }

      if (!enabled) { injecting = false; return; } // 中断安全
      let done = 0;
      for (let i = 0; i < imm.length; i++) {
        const p = imm[i];
        const tr = (translations[i] || "").trim();
        if (!p.el.isConnected) continue;
        if (p.el.hasAttribute("data-reword-translated") || isTranslatedPeer(p.el)) continue;
        if (!tr) {
          const fail = buildFailedEl(p.doc);
          injectSibling(p.el, fail);
          continue;
        }
        const div = buildTranslationEl(p.doc, tr, {
          // 2026-08-31 Phase 3：段落级「用 AI 重译」入口（默认关闭，由上层开启）
          showAiRedo: !!opts.showAiRedo,
          // 2026-08-31：段落级「删除此段译文」入口（默认关闭，由上层开启）
          showHide: !!opts.showHideSegment,
        });
        injectSibling(p.el, div);
        // doc 级委托，内部幂等；翻页重建 Document 后重新调用也只绑一次
        if (opts.showAiRedo && opts.onAiRedo) {
          bindAiRedoDelegation(p.doc, opts.onAiRedo);
        }
        if (opts.showHideSegment && opts.onHideSegment) {
          bindHideDelegation(p.doc, (wrap, sourceText) => {
            const h = segHash(sourceText);
            opts.onHideSegment?.(opts.bookId, h);
            wrap.remove(); // 从 DOM 移除译文块（原文节点保留，零污染）
          });
        }
        done++;
      }
      if (done === 0 && imm.length > 0) {
        console.warn("[REword] 双语v2: 眼前屏 0 段注入成功（AI 返回空译文）");
      }
      opts.onProgress?.(done, total);
    } catch (e) {
      console.warn("[REword] 双语v2 注入失败:", e);
      telemetry.emit({ phase: "error", bookId: opts.bookId, error: String((e as Error)?.message || e), runId });
      opts.onProgress?.(0, total);
    } finally {
      injecting = false;
    }
  }

  function scheduleInject(): void {
    if (injectTimer) clearTimeout(injectTimer);
    injectTimer = setTimeout(() => { void injectAll(); }, 300);
  }

  function removeAllDom(): void {
    const docs = opts.getContents() || [];
    for (const doc of docs) {
      const paras = Array.from(doc.querySelectorAll(`${BLOCK}, ${LEAF_DIV}`)) as Element[];
      for (const el of paras) {
        if (el.hasAttribute("data-reword-translated")) el.removeAttribute("data-reword-translated");
        removeTranslationSibling(el);
      }
    }
  }

  function segmentStats(): { count: number; chars: number } {
    let count = 0;
    let chars = 0;
    const docs = opts.getContents() || [];
    for (const doc of docs) {
      for (const seg of getSegments(doc)) {
        count++;
        chars += seg.text.length;
      }
    }
    return { count, chars };
  }

  function segmentTexts(): string[] {
    const out: string[] = [];
    const docs = opts.getContents() || [];
    for (const doc of docs) {
      for (const seg of getSegments(doc)) out.push(seg.text);
    }
    return out;
  }

  /**
   * 整书预翻译（细化版，v2）：遍历全书段落，未缓存的送译并落盘（翻译缓存），
   * 不注入 DOM。复用 opts.translateBatchDetailed（已含 providers / fromCache 来源）。
   * 每批 emit telemetry，供预翻译弹窗实时显示引擎状态与成本。
   */
  async function pretranslateAll(po?: PretranslateOptions): Promise<void> {
    // 2026-08-31 修复：初版 v2 这里加了 `if (!enabled) return`，但预翻译的语义
    // 是「只填缓存、不注入 DOM」，用户常在未开双语时先预翻译（之后开双语秒出）。
    // 加了守卫会导致静默什么都不做（与 v1 行为不一致）。故移除。
    const signal = po?.signal;
    const batchSize = po?.batchSize && po.batchSize > 0 ? po.batchSize : 8;
    const concurrency = po?.concurrency && po.concurrency > 0 ? po.concurrency : 1;
    const overwrite = !!po?.overwrite;
    const meta = opts.bookMeta ? opts.bookMeta() : null;
    const from2 = from;
    const to2 = po?.to || to;
    const mode = getMode();

    // 收集全书段落：除正文外还要带「前文参考」（2026-08-31 修复：
    // 初版 v2 预翻译传 undefined，相比 v1 丢失语境 → 专有名词/译法前后不一致。
    // 这里与 injectAll 保持同一套 getSegments().prev 语义。）
    const docs0 = opts.getContents() || [];
    const all: Array<{ text: string; prev: string }> = [];
    docs0.forEach((doc) => {
      for (const seg of getSegments(doc)) all.push({ text: seg.text, prev: seg.prev });
    });
    const allTexts = all.map((s) => s.text);
    const total = allTexts.length;
    if (!total) return;
    const cached = overwrite ? 0 : (opts.checkCached ? (await opts.checkCached(allTexts)).filter(Boolean).length : 0);
    let done = cached;
    let pending = total - cached;

    const progress = (status: PretranslateProgress["status"]): void => {
      po?.onProgress?.({
        done,
        total,
        cached,
        pending: Math.max(0, pending),
        status,
      });
    };
    progress("running");

    // 2026-08-31 修复：全部命中缓存（或 abort）时提前返回，不再分批空跑。
    // 初版 v2 缺这个短路 → 已缓存全书再点「预翻译」会把全书重译一遍，白烧 token。
    if (pending <= 0 || signal?.aborted) {
      progress(signal?.aborted ? "cancelled" : "done");
      return;
    }

    // 分批：每批携带各自段落的前文参考
    const batches: Array<{ texts: string[]; ctx: (string | null)[] }> = [];
    for (let i = 0; i < all.length; i += batchSize) {
      const slice = all.slice(i, i + batchSize);
      batches.push({
        texts: slice.map((s) => s.text),
        ctx: slice.map((s) => (s.prev && s.prev.trim() ? s.prev : null)),
      });
    }
    const t0 = Date.now();
    let bi = 0;
    async function runBatch(batch: { texts: string[]; ctx: (string | null)[] }): Promise<void> {
      if (signal?.aborted) return;
      const idx = bi++;
      const batchTexts = batch.texts;
      try {
        const res = await (opts.translateBatchDetailed
          ? opts.translateBatchDetailed(batchTexts, from2, to2, opts.bookId, batch.ctx, meta, {
              model: po?.model,
              overwrite,
              signal,
              engine: po?.engine,
              mode,
            })
          : opts.translateBatch(batchTexts, from2, to2, opts.bookId, batch.ctx, meta, {
              model: po?.model,
              overwrite,
              signal,
              engine: po?.engine,
              mode,
            }).then((t) => ({ texts: t, providers: t.map(() => null as string | null), fromCache: t.map(() => false) })));
        // 遥测：本批引擎段数 + 缓存命中 + 成本
        const cacheHits = res.fromCache.filter(Boolean).length;
        const engineCounts: Record<string, number> = {};
        let tencentChars = 0;
        res.providers.forEach((p, i) => {
          if (!p) return;
          engineCounts[p] = (engineCounts[p] || 0) + 1;
          if (p === "tencent") tencentChars += (batchTexts[i]?.length || 0);
        });
        if (cacheHits > 0) telemetry.emit({ phase: "hit", bookId: opts.bookId, engine: "cache", segmentCount: cacheHits, runId });
        for (const [eng, cnt] of Object.entries(engineCounts)) {
          telemetry.emit({ phase: "try", bookId: opts.bookId, engine: eng, segmentCount: cnt, chars: eng === "tencent" ? tencentChars : undefined, runId });
        }
        const success = res.texts.filter((t) => (t || "").trim()).length;
        done += success;
        pending = Math.max(0, pending - batchTexts.length);
        const elapsed = (Date.now() - t0) / 1000;
        const rate = done > cached ? (done - cached) / elapsed : 0;
        progress(rate > 0 ? "running" : "running");
        po?.onProgress?.({
          done,
          total,
          cached,
          pending: Math.max(0, pending),
          status: "running",
          etaSeconds: rate > 0 ? Math.ceil((total - done) / rate) : undefined,
        });
      } catch (e) {
        console.warn(`[REword] 双语v2 预翻译批#${idx} 失败:`, e);
        telemetry.emit({ phase: "error", bookId: opts.bookId, error: String((e as Error)?.message || e), runId });
        // 留缓存空洞，不中断整批（避免静默漏译扩大）
      }
    }

    // 控制并发
    let cursor = 0;
    async function worker(): Promise<void> {
      while (cursor < batches.length && !signal?.aborted) {
        const b = batches[cursor++];
        await runBatch(b);
      }
    }
    const workers: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i++) workers.push(worker());
    await Promise.all(workers);

    progress(signal?.aborted ? "cancelled" : "done");
    telemetry.emit({ phase: "done", bookId: opts.bookId, segmentCount: done, runId });
  }

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(on: boolean): void {
      enabled = on;
      if (!on) {
        removeAllDom();
      } else {
        scheduleInject();
      }
    },
    refresh(): void {
      if (enabled) scheduleInject();
    },
    onViewLoad(): void {
      if (enabled) scheduleInject();
    },
    segmentStats,
    segmentTexts,
    pretranslateAll,
    destroy(): void {
      enabled = false;
      if (injectTimer) clearTimeout(injectTimer);
      removeAllDom();
    },
  };
}
