/**
 * bilingual-v2 · 编排层（R6 新运行时）
 * ------------------------------------------------------------------
 * R6 之后本模块**只做编排**：切分 / 可见性 / 注入 / 预翻译队列四件职责
 * 已下沉到 src/reader/bilingual/runtime/ 下各自独立、可单测的模块，
 * 这里负责组装它们 + 遥测 + 对外 BilingualHandle 契约。
 *
 * 保留的既有行为（对外契约与可观测性不变）：
 *  1. 渲染仍是「兄弟节点」方案（render.ts），原文 DOM 零改动 → CFI/标注/批注/TTS 不受影响。
 *  2. Telemetry 总线照旧 emit（done / hit / try / cost / error），面板零埋点订阅。
 *  3. 300ms 防抖注入、120s 翻译超时、跨文档去重、onSectionsCached 回传。
 *  4. createBilingualV2 名字与 BilingualHandle 契约不变 → ReaderView 零改动。
 *
 * 变化：注入改为「分帧有界 + 读写分离 + 三态」，预翻译改为「全本/渐进队列 +
 * 注入闸门」，越界块只缓存不注入，翻页后按进度补注。
 */
import type {
  BilingualOptions,
  BilingualHandle,
  PretranslateOptions,
  PretranslateProgress,
} from "../bilingual-types.ts";
import { PRETRANSLATE_DEFAULTS } from "../bilingual/core/types.ts";
import { createSegmenter } from "../bilingual/runtime/segmenter.ts";
import { createVisibility } from "../bilingual/runtime/visibility.ts";
import { createInjector } from "../bilingual/runtime/injector.ts";
import { createPretranslateQueue } from "../bilingual/runtime/pretranslate.ts";
import { telemetry } from "./telemetry.ts";
import { getLogger } from "../../core/logger.ts";

export function createBilingualV2(opts: BilingualOptions): BilingualHandle {
  let enabled = false;
  let injectTimer: any = null;
  let injecting = false;
  const from = opts.from || "auto";
  const to = opts.to || "zh";
  const getMode = (): "default" | "concise" =>
    typeof opts.getMode === "function" ? opts.getMode() : (opts.mode || "default");
  let runId = `run-${Date.now()}`;

  const segmenter = createSegmenter({
    isSegmentHidden: (h) => !!opts.isSegmentHidden?.(h),
  });
  const visibility = createVisibility({
    getCurrentSection: () => opts.getCurrentSection?.() ?? 0,
  });
  const injector = createInjector({
    showAiRedo: !!opts.showAiRedo,
    onAiRedo: opts.onAiRedo,
    showHideSegment: !!opts.showHideSegment,
    onHideSegment: (h) => opts.onHideSegment?.(opts.bookId, h),
    // 2026-09-05 设置项「失败自动重试」：关闭 = 0 次自动重试（失败段等下一轮翻页窗口自然重试）
    maxRetries: () => (opts.getRetryEnabled?.() === false ? 0 : PRETRANSLATE_DEFAULTS.maxRetries),
  });

  /**
   * 预取分节数（0–4，默认 2）：渐进窗口与注入闸门共用的「当前 + N 分节」。
   * 2026-09-05 复活 —— R6 重写后此前的「窗口页数」设置一度无人消费。
   */
  const aheadOf = (): number => {
    const v = Math.round(opts.getPrefetchPages?.() ?? PRETRANSLATE_DEFAULTS.aheadSections);
    return Math.min(4, Math.max(0, Number.isFinite(v) ? v : PRETRANSLATE_DEFAULTS.aheadSections));
  };

  /** 统一送译入口：优先走 detailed（带 provider / fromCache 用于遥测） */
  async function translateTexts(
    texts: string[],
    ctxBefore: (string | null)[],
    extra?: { overwrite?: boolean; signal?: AbortSignal; model?: string; engine?: string },
  ): Promise<{ texts: string[]; providers: (string | null)[]; fromCache: boolean[] }> {
    const meta = opts.bookMeta ? opts.bookMeta() : null;
    const mode = getMode();
    if (opts.translateBatchDetailed) {
      return await opts.translateBatchDetailed(texts, from, to, opts.bookId, ctxBefore, meta, {
        mode,
        ...extra,
      });
    }
    const t = await opts.translateBatch(texts, from, to, opts.bookId, ctxBefore, meta, {
      mode,
      ...extra,
    });
    return { texts: t, providers: t.map(() => null), fromCache: t.map(() => false) };
  }

  /**
   * 预翻译的翻译覆盖项（model / engine / overwrite / signal）。
   * 队列的 translate 回调签名只有 (texts, ctx)，这些覆盖项靠这里传递。
   */
  let txExtra: { overwrite?: boolean; signal?: AbortSignal; model?: string; engine?: string } | undefined;

  /** 预翻译进度转发：把队列状态翻译成弹窗用的 PretranslateProgress */
  let lastPo: PretranslateOptions | undefined;
  function emitProgress(status: PretranslateProgress["status"]): void {
    const st = queue.state();
    lastPo?.onProgress?.({
      done: st.done,
      total: st.total,
      cached: st.cachedOnly,
      pending: Math.max(0, st.total - st.done),
      status,
    });
  }

  const queue = createPretranslateQueue({
    bookId: opts.bookId,
    segmenter,
    visibility,
    injector,
    getContents: () => opts.getContents() || [],
    getSections: opts.getSections,
    getCurrentSection: opts.getCurrentSection,
    translate: async (texts, ctx) => (await translateTexts(texts, ctx, txExtra)).texts,
    checkCached: opts.checkCached,
    getLiveSegment: (locatorKey, sectionIndex) => {
      // full 模式用 section.createDocument() 取段，节点不在当前视图；
      // 这里到 getContents() 已挂载的 iframe doc 里重新切出同一段，保证 isConnected=true。
      for (const doc of opts.getContents() || []) {
        for (const s of segmenter.segmentsOf(doc, sectionIndex)) {
          if (s.locatorKey === locatorKey && !injector.hasInjected(s.locatorKey)) return s;
        }
      }
      return undefined;
    },
    onProgress: () => emitProgress("running"),
  });

  /** 收集「窗口内 + 未注入 + 未被退避挡住 + 跨文档去重」的待处理段 */
  function collectPending(): ReturnType<typeof segmenter.segmentsOfDocs> {
    const docs = opts.getContents() || [];
    const cur = opts.getCurrentSection?.() ?? 0;
    const gate = { aheadSections: aheadOf() };
    const seen = new Set<string>();
    return segmenter
      .segmentsOfDocs(docs, cur)
      .filter((s) => visibility.withinInjectGate(s.sectionIndex, gate))
      .filter((s) => !injector.hasInjected(s.locatorKey))
      // 失败段退避过滤：仍在退避期 / 已超重试上限的不重复送译（避免每轮即时无上限重试）
      .filter((s) => !injector.isBlocked(s.locatorKey))
      .filter((s) => (seen.has(s.locatorKey) ? false : (seen.add(s.locatorKey), true)));
  }

  async function injectAll(): Promise<void> {
    if (!enabled) return;
    if (injecting) return; // 防重入
    injecting = true;
    let total = 0;
    try {
      const pending = collectPending();
      total = pending.length;
      if (!total) {
        getLogger().info("[REword][双语] injectAll：无待注入段落（docs=0 或全部已注入/被排除）");
        return;
      }
      getLogger().info(`[REword][双语] injectAll：窗口内待注入 ${total} 段`);
      const ctxBefore = pending.map((s) => (s.prev && s.prev.trim() ? s.prev : null));
      const t0 = Date.now();
      const res = await Promise.race([
        translateTexts(pending.map((s) => s.text), ctxBefore),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("翻译超时(120s)：AI 服务无响应，请检查网络与 API 配置")), 120000),
        ),
      ]);
      const latencyMs = Date.now() - t0;
      const translations = res.texts;
      const nonEmpty = translations.filter((t) => (t || "").trim()).length;
      getLogger().info(`[REword][双语] 翻译返回：${translations.length} 条（非空 ${nonEmpty}，耗时 ${latencyMs}ms）`);

      // —— 成本与引擎状态遥测 ——
      const cacheHits = res.fromCache.filter(Boolean).length;
      const engineCounts: Record<string, number> = {};
      let tencentChars = 0;
      res.providers.forEach((p, i) => {
        if (!p) return;
        engineCounts[p] = (engineCounts[p] || 0) + 1;
        if (p === "tencent") tencentChars += pending[i]?.text.length || 0;
      });
      telemetry.emit({ phase: "done", bookId: opts.bookId, segmentCount: translations.length, latencyMs, runId });
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
          if (tr && typeof p.sectionIndex === "number" && p.sectionIndex >= 0) secSet.add(p.sectionIndex + 1);
        });
        if (secSet.size) opts.onSectionsCached(opts.bookId, [...secSet].sort((a, b) => a - b));
      }

      if (!enabled) return; // 中断安全
      // 分帧有界注入 + 三态（成功才打标；失败/空译文不打标，下轮重试）
      const ir = await injector.injectBatch({ segments: pending, translations });
      getLogger().info(
        `[REword][双语] 注入完成：成功 ${ir.injected}，留空 ${ir.empty}，失败 ${ir.failed}（共 ${total} 段）`,
      );
      if (ir.injected === 0 && total > 0) {
        getLogger().warn("[REword][双语] 窗口内 0 段注入成功（AI 返回空译文或元素已断开）");
      }
      opts.onProgress?.(ir.injected, total);
    } catch (e) {
      console.warn("[REword] 双语v2 注入失败:", e);
      getLogger().error("[REword][双语] injectAll 异常:", { error: String((e as Error)?.message || e) });
      telemetry.emit({ phase: "error", bookId: opts.bookId, error: String((e as Error)?.message || e), runId });
      opts.onProgress?.(0, total);
    } finally {
      injecting = false;
    }
  }

  function scheduleInject(): void {
    if (injectTimer) clearTimeout(injectTimer);
    injectTimer = setTimeout(() => {
      void injectAll();
    }, 300);
  }

  function segmentStats(): { count: number; chars: number } {
    const docs = opts.getContents() || [];
    const cur = opts.getCurrentSection?.() ?? 0;
    const segs = segmenter.segmentsOfDocs(docs, cur);
    return { count: segs.length, chars: segs.reduce((s, x) => s + x.text.length, 0) };
  }

  function segmentTexts(): string[] {
    const docs = opts.getContents() || [];
    const cur = opts.getCurrentSection?.() ?? 0;
    return segmenter.segmentsOfDocs(docs, cur).map((s) => s.text);
  }

  /**
   * 整书预翻译：默认 full（惰性遍历全书 sections，名副其实地覆盖全书）。
   * 渐进式（progressive）不需要弹窗触发 —— 它就是 onViewLoad 的常规行为：
   * 每次翻页把「当前 + 后 N 分节」（N=预取分节数，默认 2）的块送译并注入。
   */
  async function pretranslateAll(po?: PretranslateOptions): Promise<void> {
    lastPo = po;
    const signal = po?.signal;
    txExtra = { model: po?.model, overwrite: po?.overwrite, signal, engine: po?.engine };
    const lanes = po?.concurrency && po.concurrency > 0 ? po.concurrency : PRETRANSLATE_DEFAULTS.lanes;
    const blocksPerLane = po?.batchSize && po.batchSize > 0 ? po.batchSize : PRETRANSLATE_DEFAULTS.blocksPerLane;
    queue.cancel(); // 重入时先停掉上一轮

    // 缓存短路（防白烧 token）：仅在 progressive 模式下成立 ——
    // progressive 的视野就是窗口，checkCached 全命中 = 真的没事可做。
    // full 模式不能用这个短路：它的视野是全书，而 checkCached 只能查窗口内的
    // 已加载分节，全命中并不代表全书其余分节已译（会漏译）。
    if (po?.full === false && !po?.overwrite && opts.checkCached) {
      const texts = segmentTexts();
      if (texts.length) {
        try {
          const flags = await opts.checkCached(texts);
          if (flags.length && flags.every(Boolean)) {
            emitProgress("done");
            return;
          }
        } catch {
          // 查询失败则照常走队列，不因短路判定失败而中断预翻译
        }
      }
    }

    emitProgress("running");
    await queue.start({
      bookId: opts.bookId,
      mode: po?.full === false ? "progressive" : "full",
      lanes,
      blocksPerLane,
      aheadSections: aheadOf(),
      signal,
    });
    emitProgress(signal?.aborted ? "cancelled" : "done");
    telemetry.emit({ phase: "done", bookId: opts.bookId, segmentCount: queue.state().done, runId });
  }

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(on: boolean): void {
      enabled = on;
      if (!on) {
        injector.clear();
      } else {
        scheduleInject();
      }
    },
    refresh(): void {
      if (enabled) scheduleInject();
    },
    onViewLoad(): void {
      if (!enabled) return;
      scheduleInject();
      // 翻页推进窗口后，把窗口内已缓存但未注入的块补注进去（纯缓存读）
      void queue.pumpFromCache();
    },
    segmentStats,
    segmentTexts,
    pretranslateAll,
    destroy(): void {
      enabled = false;
      if (injectTimer) clearTimeout(injectTimer);
      queue.cancel();
      injector.clear();
    },
  };
}
