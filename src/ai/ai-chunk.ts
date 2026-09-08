/**
 * REword · AI 长文分块精读（P2-A，第 5 批）
 * ------------------------------------------------------------------
 * 当原文超过 chunkChars 且 chunkEnabled 开启时，把正文在「段落边界」切块，
 * 逐块调用 runAiDeepRead（不带流式回调，避免多流交错污染 UI），
 * 再合并去重为一份 DeepReadResult。
 *
 * 设计取舍：
 *  - 切分优先在空行（段落）边界，单段超长再硬切，尽量不把一个句子拦腰斩断；
 *  - 合并按 词/句 的小写归一化去重，避免跨块重复讲解同一词；
 *  - 分块模式不走逐 token 流式（长文本就是边缘场景），结果一次性渲染，
 *    由面板 loading 态覆盖等待——与「真实进度」(progressMode，仍 🔵) 解耦。
 *
 * 不引入循环依赖：本模块单向依赖 ai-orchestrator 的 runAiDeepRead。
 */

import type { AiSettings } from "./ai-settings.ts";
import { runAiDeepRead, type DeepReadInput, type DeepReadOptions, type DeepReadResult } from "./ai-orchestrator.ts";

/** 按段落边界切块；单段超长硬切。返回非空块数组。 */
export function splitIntoChunks(text: string, chunkChars: number): string[] {
  const limit = Math.max(200, Math.floor(chunkChars));
  const paras = text.split(/\n{2,}/);
  const packed: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (!p.trim()) continue;
    if (!cur) {
      cur = p;
      continue;
    }
    if ((cur + "\n\n" + p).length <= limit) {
      cur += "\n\n" + p;
    } else {
      packed.push(cur);
      cur = p;
    }
  }
  if (cur.trim()) packed.push(cur);

  // 单段超长 → 硬切，避免单块无限大撑爆上下文
  const out: string[] = [];
  for (const c of packed) {
    if (c.length <= limit) {
      out.push(c);
    } else {
      for (let i = 0; i < c.length; i += limit) out.push(c.slice(i, i + limit));
    }
  }
  return out.filter((c) => c.trim().length > 0);
}

/** 合并多块结果：词/句去重，小结与 unsupported/issues 拼接 */
export function mergeDeepReadResults(results: DeepReadResult[]): DeepReadResult {
  const words = new Map<string, DeepReadResult["words"][number]>();
  const sentences = new Map<string, DeepReadResult["sentences"][number]>();
  const unsupported = new Set<string>();
  const issues: DeepReadResult["issues"] = [];
  const summaries: string[] = [];
  let model = "";
  let ok = false;
  let raw = "";

  for (const r of results) {
    if (r.ok) ok = true;
    if (r.model && !model) model = r.model;
    for (const w of r.words) {
      const k = (w.word || "").toLowerCase().trim();
      if (k && !words.has(k)) words.set(k, w);
    }
    for (const s of r.sentences) {
      const k = (s.sentence || "").toLowerCase().trim();
      if (k && !sentences.has(k)) sentences.set(k, s);
    }
    for (const u of r.unsupported ?? []) if (u) unsupported.add(u);
    for (const i of r.issues ?? []) issues.push(i);
    if (r.summary && r.summary.trim()) summaries.push(r.summary.trim());
  }
  if (summaries.length) raw = summaries.join("\n\n");

  return {
    ok,
    isJson: true,
    words: [...words.values()],
    sentences: [...sentences.values()],
    summary: summaries.length ? summaries.join("\n\n") : undefined,
    raw,
    model: model || undefined,
    unsupported: unsupported.size ? [...unsupported] : undefined,
    issues: issues.length ? issues : undefined,
  };
}

/** 简单并发池：最多 concurrency 个任务同时跑 */
async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await fn(items[idx], idx);
    }
  };
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

export interface ChunkedOptions extends DeepReadOptions {
  chunkChars: number;
  chunkConcurrency: number;
  /** P1-D 真实进度：每完成一块回调一次（done/total），供面板显示确定进度 */
  onProgress?: (done: number, total: number) => void;
}

/**
 * 分块精读：单块直接复用 runAiDeepRead（保留流式）；多块并发后合并（关闭 per-chunk 流式回调）。
 * 调用方（ai-panel）在 chunkEnabled && text.length > chunkChars 时改用本函数替代 runAiDeepRead。
 */
export async function runChunkedDeepRead(
  input: DeepReadInput,
  settings: AiSettings,
  opts: ChunkedOptions
): Promise<DeepReadResult> {
  const chunks = splitIntoChunks(input.text, opts.chunkChars);
  if (chunks.length <= 1) {
    return runAiDeepRead(input, settings, opts);
  }
  // 多块：去掉流式回调，避免多流交错污染面板 live 渲染
  const { onThinking, onToken, ...rest } = opts;
  const noStream: DeepReadOptions = rest;
  const perChunk = chunks.map((text) => ({ title: input.title, text }));
  const outs = await mapPool(perChunk, opts.chunkConcurrency, (ci) => runAiDeepRead(ci, settings, noStream));
  return mergeDeepReadResults(outs);
}
