/**
 * 双语运行时 · 后台预翻译队列（L2 runtime）
 * ==================================================================
 * 替代旧 bilingual-v2.ts:339-464 的 pretranslateAll。规格（2026-09-05 定）：
 *
 *  - **full**：切分全书，并发 2 列、每列 5 块，后台持续翻译；
 *  - **progressive**：只切「当前页 + 后 2 页」，随翻页推进续切；
 *  - 两者共用闸门：译好的块先入缓存，**只有落在「当前位置 + aheadSections」
 *    内的才注入**，越界的只存不注，等用户翻页后按进度补注（不预先排队注入）。
 *
 * 相对旧实现的关键修复：旧 pretranslateAll 取段走 opts.getContents()，
 * 那是 foliate **已加载的 1–3 个分节**，UI 上却叫「整书预翻译」。
 * full 模式改为惰性遍历 BookDoc/foliate 的 sections，逐个 createDocument()
 * 取段后立即释放，内存里同时只驻留一节的段。
 */
import type {
  Segment,
  PretranslateJob,
  PretranslateState,
  SegmenterLike,
  VisibilityLike,
} from "../core/types.ts";
import { PRETRANSLATE_DEFAULTS } from "../core/types.ts";
import type { Injector } from "./injector.ts";

/** 分节来源（foliate 的 book.sections 直接满足这个形状） */
export interface SectionSource {
  index: number;
  createDocument(): Promise<Document> | Document;
}

export interface PretranslateDeps {
  bookId: string;
  segmenter: SegmenterLike;
  visibility: VisibilityLike;
  injector: Injector;
  /** 当前已加载内容文档（progressive 模式取段用） */
  getContents: () => Document[];
  /** 全书分节（full 模式枚举用；PDF/漫画等无分节时可不提供） */
  getSections?: () => SectionSource[];
  /** 当前所在分节（0-based） */
  getCurrentSection?: () => number;
  /** 批量翻译：返回与 texts 同序的译文数组（内部先查缓存，未命中才走引擎链） */
  translate: (texts: string[], ctxBefore: (string | null)[]) => Promise<string[]>;
  /** 批量查缓存命中；提供时「翻页补注」可做到零网络 */
  checkCached?: (texts: string[]) => Promise<boolean[]>;
  /**
   * 把「缓存/翻译用的段」映射回当前视图里可注入的段。
   * full 模式遍历 section 时用 `createDocument()` 取段，该 Document 是临时解析的，
   * 其中节点 `isConnected === false`，直接注入会被注入器拒绝。调用方应在此用
   * `getContents()` 当前已挂载的 doc 重新切出同一段（按 locatorKey + sectionIndex
   * 匹配），返回带真实 DOM 节点的 Segment；未找到则返回 undefined（只缓存不注入）。
   */
  getLiveSegment?: (locatorKey: string, sectionIndex: number) => Segment | undefined;
  /** 进度回调 */
  onProgress?: (state: PretranslateState) => void;
}

export interface PretranslateQueue {
  start(job: PretranslateJob): Promise<void>;
  /** 翻页/窗口推进后调用：把窗口内已缓存但未注入的块补注进去 */
  pumpFromCache(): Promise<void>;
  cancel(): void;
  state(): PretranslateState;
  /** 已完成（已入缓存）的定位键，用于断点续传 */
  doneKeys(): string[];
}

export function createPretranslateQueue(deps: PretranslateDeps): PretranslateQueue {
  let cancelled = false;
  const done = new Set<string>();
  const state: PretranslateState = {
    status: "idle",
    done: 0,
    total: 0,
    cachedOnly: 0,
    injected: 0,
    failed: 0,
  };

  function aborted(signal?: AbortSignal): boolean {
    return cancelled || !!signal?.aborted;
  }

  function emit(): void {
    deps.onProgress?.({ ...state });
  }

  /** 按 lanes 列 × blocksPerLane 块并发处理一批段 */
  async function runQueue(
    segs: Segment[],
    lanes: number,
    blocksPerLane: number,
    aheadSections: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const pending = segs.filter((s) => !deps.injector.hasInjected(s.locatorKey));
    if (!pending.length) return;
    state.total = Math.max(state.total, state.done + pending.length);

    async function runChunk(chunk: Segment[]): Promise<void> {
      const texts = chunk.map((s) => s.text);
      const ctx = chunk.map((s) => (s.prev && s.prev.trim() ? s.prev : null));
      try {
        const trs = await deps.translate(texts, ctx);
        // 注入闸门：只注入落在「当前位置 + aheadSections」内的块
        const gate = { aheadSections };
        const idx: number[] = [];
        chunk.forEach((s, i) => {
          if (deps.visibility.withinInjectGate(s.sectionIndex, gate)) idx.push(i);
        });
        // full 模式用 createDocument() 取段，其节点不在当前视图 → isConnected=false，
        // 注入器会拒绝。这里把窗口内段映射回 getContents() 当前视图中的真实节点。
        const toInject: Segment[] = [];
        const toInjectTr: string[] = [];
        for (const i of idx) {
          const live = deps.getLiveSegment?.(chunk[i].locatorKey, chunk[i].sectionIndex);
          if (live?.node) {
            toInject.push(live);
            toInjectTr.push(trs[i] ?? "");
          }
        }
        const outOfWindow = chunk.length - idx.length;
        const inWindowNoLive = idx.length - toInject.length;
        state.cachedOnly += outOfWindow + inWindowNoLive;
        if (toInject.length) {
          const res = await deps.injector.injectBatch({
            segments: toInject,
            translations: toInjectTr,
          });
          state.injected += res.injected;
          state.failed += res.failed;
          state.cachedOnly += res.empty;
        }
        state.done += chunk.length;
        for (const s of chunk) done.add(s.locatorKey);
      } catch {
        state.failed += chunk.length;
      }
      emit();
    }

    let cursor = 0;
    async function worker(): Promise<void> {
      while (cursor < pending.length && !aborted(signal)) {
        const chunk = pending.slice(cursor, cursor + blocksPerLane);
        cursor += blocksPerLane;
        await runChunk(chunk);
      }
    }
    const workers: Promise<void>[] = [];
    for (let i = 0; i < lanes; i++) workers.push(worker());
    await Promise.all(workers);
  }

  /** progressive：取当前窗口内的段 */
  function windowSegments(aheadSections: number): Segment[] {
    const docs = deps.getContents?.() ?? [];
    const cur = deps.getCurrentSection?.() ?? 0;
    const segs = deps.segmenter.segmentsOfDocs(docs, cur);
    return segs.filter((s) => deps.visibility.withinInjectGate(s.sectionIndex, { aheadSections }));
  }

  return {
    async start(job: PretranslateJob): Promise<void> {
      const lanes = job.lanes ?? PRETRANSLATE_DEFAULTS.lanes;
      const blocksPerLane = job.blocksPerLane ?? PRETRANSLATE_DEFAULTS.blocksPerLane;
      const ahead = job.aheadSections ?? PRETRANSLATE_DEFAULTS.aheadSections;
      cancelled = false;
      state.status = "running";
      emit();

      try {
        if (job.mode === "full") {
          const sections = deps.getSections?.() ?? [];
          if (!sections.length) {
            // 拿不到 sections（如老格式 / PDF 无分节）时退化为窗口取段，不静默空转
            await runQueue(windowSegments(ahead), lanes, blocksPerLane, ahead, job.signal);
          } else {
            for (const sec of sections) {
              if (aborted(job.signal)) break;
              const doc = await sec.createDocument();
              if (!doc) continue;
              const idx = typeof sec.index === "number" ? sec.index : 0;
              const segs = deps.segmenter.segmentsOf(doc, idx);
              // 切完即清 memo，让本节 Document 在 segs 出作用域后可回收
              deps.segmenter.invalidate(doc);
              await runQueue(segs, lanes, blocksPerLane, ahead, job.signal);
            }
          }
        } else {
          await runQueue(windowSegments(ahead), lanes, blocksPerLane, ahead, job.signal);
        }
        state.status = aborted(job.signal) ? "cancelled" : "done";
      } catch {
        state.status = "error";
      }
      emit();
    },

    /**
     * 翻页补注：只补「窗口内 + 已缓存 + 尚未注入」的块。
     * checkCached 可用时先过滤，保证这一路零网络请求。
     */
    async pumpFromCache(): Promise<void> {
      const ahead = PRETRANSLATE_DEFAULTS.aheadSections;
      const segs = windowSegments(ahead).filter((s) => !deps.injector.hasInjected(s.locatorKey));
      if (!segs.length) return;
      let todo = segs;
      if (deps.checkCached) {
        try {
          const flags = await deps.checkCached(segs.map((s) => s.text));
          todo = segs.filter((_, i) => flags[i]);
        } catch {
          todo = [];
        }
      } else {
        todo = [];
      }
      if (!todo.length) return;
      const texts = todo.map((s) => s.text);
      const ctx = todo.map((s) => (s.prev && s.prev.trim() ? s.prev : null));
      try {
        const trs = await deps.translate(texts, ctx);
        const res = await deps.injector.injectBatch({ segments: todo, translations: trs });
        state.injected += res.injected;
        state.cachedOnly = Math.max(0, state.cachedOnly - res.injected);
      } catch {
        state.failed += todo.length;
      }
      emit();
    },

    cancel(): void {
      cancelled = true;
      if (state.status === "running") state.status = "cancelled";
    },

    state(): PretranslateState {
      return { ...state };
    },

    doneKeys(): string[] {
      return [...done];
    },
  };
}
