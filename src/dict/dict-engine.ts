import { logSwallow } from "../core/safe.ts";
/**
 * 词典查询模块（MDX + StarDict 双引擎）
 *
 * 支持两种离线词典格式：
 *   - MDX：通过 js-mdict 的 MDX 类直读 .mdx 原包
 *   - StarDict：通过内置 StarDict 解析器读取 .ifo/.idx/.dict(.dz) 包
 *
 * 设计原则：
 *   - 零侵入：不修改原词典文件，原样保留在插件 dict/ 目录
 *   - 数据本地化：词典即原包，用户可直接导入
 *   - 内存安全：释义不预加载，查词时才读取对应记录块
 *   - 多词典：每个词典以 id 注册独立实例，查询作用于「当前激活」词典
 *
 * 注：js-mdict / node:fs / node:zlib 在 SiYuan 桌面端（Electron，开启 nodeIntegration）可用。
 */

/** 词典条目 */
export interface DictEntry {
  word: string;
  definition: string;
  /** 匹配类型：exact=精确命中，inflection=变形还原命中，similar=相似词命中 */
  matchType?: "exact" | "inflection" | "similar";
  /** 用户原始查询词（变形还原/相似词时与 word 不同） */
  originalWord?: string;
  /** 候选词列表（similar 时可能多个） */
  candidates?: string[];
  /**
   * 互见词条跟随补中文（P1 核心）：词条本身是「= 目标词」互见/词缀型
   * （如 tackey = tacky² / usucaption = usucapion），无内联中文释义时，
   * 跟随目标词二次查词取其首个 <span class="zh"> 回填，阅读时不再卡在"看不到中文"。
   * 义项级引用（如 bay¹,9）不跟随，避免误导；取不到时保持空、不编造。
   */
  resolvedZh?: string;
}

/** 词典初始化状态 */
type DictStatus = "unloaded" | "loading" | "ready" | "error";

/** 词典后端类型 */
export type DictBackend = "mdx" | "stardict";

/** 词典语言类型（用于按查询内容自动选择引擎） */
export type DictLang = "en" | "zh" | "auto";

/** 已加载的词典源（支持 MDX 和 StarDict 双后端） */
interface DictSource {
  id: string;
  name: string;
  backend: DictBackend;
  lang: DictLang;  // 词典语言：en=英文为主，zh=中文为主，auto=未知（按内容回退）
  mdx: any;       // js-mdict MDX 实例（backend=mdx 时使用）
  stardict: any;   // StarDict 实例（backend=stardict 时使用）
  count: number;   // 词表条目数
  /** P4 搜索索引（2026-08-14 新增）：词典加载时构建，供前缀/子串/编辑距离搜索收窄扫描范围 */
  searchIndex?: SearchIndex;
}

/**
 * 搜索索引（P4 性能优化，2026-08-14 新增）
 * - sortedKeys：全部词头小写去重排序数组（前缀二分 / 编辑距离锚点）
 * - buckets：按首字符分桶（小写字母 a-z，其它归 "#"），子串搜索只扫目标桶
 */
interface SearchIndex {
  sortedKeys: string[];
  buckets: Map<string, string[]>;
}

/**
 * 构建词典搜索索引（P4 性能优化，2026-08-14 新增）。
 * 在 initDict / initStarDict 注册词典后调用。
 * 内存：36+54 万条小写字符串引用，~10MB 量级；词典重载时幂等重建。
 */
export function buildSearchIndex(src: DictSource): void {
  try {
    let rawList: any[];
    if (src.backend === "mdx") {
      rawList = Array.isArray((src.mdx as any).keywordList) ? (src.mdx as any).keywordList : [];
    } else {
      // StarDict：keywordList getter 返回 string[]（词头列表）
      const kl = src.stardict && typeof src.stardict.keywordList !== "undefined" ? src.stardict.keywordList : [];
      rawList = Array.isArray(kl) ? kl : [];
    }

    const seen = new Set<string>();
    const sortedKeys: string[] = [];
    const buckets = new Map<string, string[]>();

    const getBucket = (ch: string): string[] => {
      let b = buckets.get(ch);
      if (!b) { b = []; buckets.set(ch, b); }
      return b;
    };

    for (const item of rawList) {
      const kt = item && typeof item.keyText === "string"
        ? item.keyText
        : typeof item === "string"
          ? item
          : "";
      const lower = kt.toLowerCase();
      if (!lower || seen.has(lower)) continue;
      seen.add(lower);
      sortedKeys.push(lower);
      // 分桶：首字符为 a-z 小写字母进对应桶，其余进 "#"
      const ch = /^[a-z]/.test(lower) ? lower[0] : "#";
      getBucket(ch).push(lower);
    }

    // 桶内排序（前缀/子串搜索按词典序输出，接近原 mdx 顺序）
    for (const b of buckets.values()) b.sort();

    src.searchIndex = { sortedKeys, buckets };
  } catch (e) {
    getLogger().warn("[REword] 构建搜索索引失败（降级为无索引路径）:", { error: e });
    src.searchIndex = undefined;
  }
}

/**
 * 在排序数组（sortedKeys）中二分定位「第一个 ≥ prefix」的下标。
 * 返回下标；若全部小于 prefix 返回数组长度。
 */
function lowerBound(sorted: string[], prefix: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// 全部延迟初始化——不在模块顶层执行任何 import 或 new
const dicts: Map<string, DictSource> = new Map();
let activeId: string | null = null;
let status: DictStatus = "unloaded";
let statusCallbacks: ((s: DictStatus) => void)[] = [];

// ---------- P3 外部音标补全表（phon_extra.json，CMU 公有领域数据生成） ----------
// 词典加载成功后从「词典同目录」读 phon_extra.json 建 Map（键小写）；
// NCECD 释义无 <pron> 时回退查询，用于人名/地名/专名词头补全音标。
let phonExtra: Map<string, string> | null = null;
let phonExtraDir = "";

/** 尝试从词典所在目录加载 phon_extra.json（不存在/失败则静默降级为全空表，避免反复重试） */
function ensurePhonExtra(dir: string): void {
  if (!dir || phonExtraDir === dir) return;
  phonExtraDir = dir;
  phonExtra = new Map();
  try {
    const p = path.join(dir, "phon_extra.json");
    if (!fs.existsSync(p)) return;
    const obj = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, string>;
    for (const k of Object.keys(obj)) {
      if (obj[k]) phonExtra.set(k.toLowerCase(), obj[k]);
    }
    if (phonExtra.size > 0) {
      getLogger().info(`[REword] 外部音标补全表已加载：${phonExtra.size} 条（${p}）`);
    }
  } catch (e) {
    getLogger().warn("[REword] phon_extra.json 加载失败（已降级为无补全）:", { error: e });
  }
}

/** 查询外部音标补全表（按词头小写，未命中返回空串） */
export function getExtraPhonetic(word: string): string {
  if (!phonExtra || !word) return "";
  return phonExtra.get(word.trim().toLowerCase()) || "";
}

// 延迟引入 js-mdict（其依赖 node:fs / node:zlib，运行时由 Electron 提供）
// 用命名空间导入以兼容 CJS 互操作，避免 named export 解析问题。
// eslint-disable-next-line @typescript-eslint/no-var-requires
import * as jsMdict from "js-mdict";
const MDX: any = (jsMdict as any).MDX;

// StarDict 解析器（内置实现，支持 .ifo/.idx/.dict(.dz)）
// 显式 .ts 扩展名：兼容 Node --experimental-strip-types 测试运行器
import { StarDict } from "./stardict.ts";

// P3 外部音标补全表（phon_extra.json）：node:fs / path 已在 vite external 中，Electron 运行时可用
import * as path from "path";
import * as fs from "node:fs";
import { getLogger } from "../core/logger.ts";

/**
 * 首字母大写（用于词典大小写容错）
 */
function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * 初始化/注册一个词典（直接读取 .mdx 原包，无需转换）
 * @param fsPath 词典文件在磁盘上的绝对/相对路径（.mdx 原包）
 * @param id 词典唯一 id（缺省为 "default"）
 * @param name 词典显示名
 */
export async function initDict(
  fsPath: string,
  id: string = "default",
  name: string = "default",
  lang: DictLang = "auto"
): Promise<void> {
  setStatus("loading");

  try {
    if (typeof MDX !== "function") {
      throw new Error("js-mdict MDX 未正确加载");
    }
    // 纵深防御：路径无效或指向 SiYuan 程序目录时，抛清晰错误而非 js-mdict 的
    // "Invalid package …electron.asar"（令人困惑且无法定位是插件目录没找着）。
    if (!fsPath || /electron\.asar/i.test(fsPath)) {
      throw new Error(
        "词典路径无效：无法定位插件目录或路径指向 SiYuan 程序目录(electron.asar)。" +
        "请确认插件安装在工作空间 data/plugins/siyuan-plugin-reword/ 下且含 dict/ 目录。"
      );
    }

    // MDX 构造时即解析词表索引（轻量），释义记录块按需读取
    const mdx = new MDX(fsPath);
    const count = mdx && Array.isArray(mdx.keywordList) ? mdx.keywordList.length : 0;

    // 若已存在同名词典，先关闭旧的
    const existing = dicts.get(id);
    if (existing) {
      try { existing.mdx.close(); } catch (__swallowErr) { logSwallow(__swallowErr, "dict-engine.ts · initDict", "debug"); }
    }

    dicts.set(id, { id, name, backend: "mdx", lang, mdx, stardict: null as any, count });
    // P4 搜索索引：二分+分桶，收窄候选词扫描范围（性能）
    buildSearchIndex(dicts.get(id)!);
    if (!activeId) activeId = id;

    // P3：尝试加载词典同目录的外部音标补全表（phon_extra.json），失败静默降级
    ensurePhonExtra(path.dirname(fsPath));

    setStatus("ready");
    getLogger().info(`[REword] 词典「${name}」(${id}, ${lang}) 加载完成，词表 ${count} 条（${fsPath}）`);
  } catch (err) {
    getLogger().error("[REword] 词典初始化失败:", { error: err });
    setStatus("error");
    throw err;
  }
}

/**
 * 初始化/注册一个 StarDict 词典（.ifo/.idx/.dict(.dz)）
 *
 * @param ifoPath   .ifo 文件路径（必选，从中推导 .idx 和 .dict 路径）
 * @param id        词典唯一 id（缺省为 "default"）
 * @param name      词典显示名
 * @param idxPath   （可选）.idx 文件路径，默认为 ifoPath 同目录下同名 .idx
 * @param dictPath  （可选）.dict/.dict.dz 文件路径
 */
export async function initStarDict(
  ifoPath: string,
  id: string = "default",
  name: string = "default",
  lang: DictLang = "auto",
  idxPath?: string,
  dictPath?: string
): Promise<void> {
  setStatus("loading");

  try {
    // 纵深防御：路径无效或指向 SiYuan 程序目录时，抛清晰错误而非底层解析异常
    if (!ifoPath || /electron\.asar/i.test(ifoPath)) {
      throw new Error(
        "词典路径无效：无法定位插件目录或路径指向 SiYuan 程序目录(electron.asar)。" +
        "请确认插件安装在工作空间 data/plugins/siyuan-plugin-reword/ 下且含 dict/ 目录。"
      );
    }
    const sd = new StarDict(ifoPath, idxPath, dictPath);
    const count = sd.count;

    const existing = dicts.get(id);
    if (existing) {
      try { closeSource(existing); } catch (__swallowErr) { logSwallow(__swallowErr, "dict-engine.ts · initStarDict", "debug"); }
    }

    dicts.set(id, { id, name, backend: "stardict", lang, mdx: null as any, stardict: sd, count });
    // P4 搜索索引：二分+分桶，收窄候选词扫描范围（性能）
    buildSearchIndex(dicts.get(id)!);
    if (!activeId) activeId = id;

    setStatus("ready");
    getLogger().info(`[REword] StarDict 词典「${name}」(${id}, ${lang}) 加载完成，词表 ${count} 条（${ifoPath}）`);
  } catch (err) {
    getLogger().error("[REword] StarDict 词典初始化失败:", { error: err });
    setStatus("error");
    throw err;
  }
}

/**
 * 关闭单个词典源的资源（根据 backend 类型分别处理）
 */
function closeSource(d: DictSource): void {
  try {
    if (d.backend === "mdx" && d.mdx) {
      d.mdx.close();
    } else if (d.backend === "stardict" && d.stardict) {
      d.stardict.close();
    }
  } catch (__swallowErr) { logSwallow(__swallowErr, "dict-engine.ts · closeSource", "debug"); }
}

/**
 * 设置当前激活词典
 * @param id 词典 id
 * @returns 是否切换成功
 */
export function setActiveDict(id: string): boolean {
  if (!dicts.has(id)) return false;
  activeId = id;
  return true;
}

/**
 * 获取当前激活的词典源（含连接与元信息）
 */
function getActive(): DictSource | null {
  if (!activeId) return null;
  return dicts.get(activeId) || null;
}

/**
 * 列出全部已加载词典
 */
export function listDicts(): { id: string; name: string; count: number; active: boolean; backend: DictBackend; lang: DictLang }[] {
  return [...dicts.values()].map((d) => ({
    id: d.id,
    name: d.name,
    count: d.count,
    active: d.id === activeId,
    backend: d.backend,
    lang: d.lang,
  }));
}

/**
 * 判断某词典当前是否已加载（实例在 dicts Map 中，资源已就绪）。
 * 用于切换流程避免对已加载词典重复解析 MDX（性能关键）。
 */
export function isDictLoaded(id: string): boolean {
  return dicts.has(id);
}

/**
 * 关闭并彻底移除一个词典（释放 MDX/StarDict 实例资源），并同步激活指针。
 * 与 removeDict 区别：这里保证停用后引擎 activeId 一定指向 manifest 剩余启用项，
 * 避免"停在启用状态"的状态残留。
 * @param id       要移除的词典 id
 * @param fallback 停用后应作为当前激活的词典 id（通常取 manifest.actives[0]）
 */
export function deactivateAndRemove(id: string, fallback: string | null): void {
  const d = dicts.get(id);
  if (!d) return;
  closeSource(d);
  dicts.delete(id);
  // 优先回落到 manifest 指定的剩余启用项；其次任一仍在加载的词典；最后置空
  const next = (fallback && dicts.has(fallback) ? fallback : null)
    || (dicts.keys().next().done ? null : dicts.keys().next().value as string)
    || null;
  activeId = next;
  getLogger().info(`[REword] 词典「${d.name}」(${id}) 已释放资源${next ? `，激活回落至「${next}」` : "，当前无启用词典"}`);
  if (dicts.size === 0) setStatus("unloaded");
}

/**
 * 获取指定词典的后端类型
 */
export function getDictBackend(id: string): DictBackend | null {
  const d = dicts.get(id);
  return d ? d.backend : null;
}

/**
 * 移除一个词典（关闭其 MDX 实例）
 * @param id 词典 id
 */
export function removeDict(id: string): void {
  const d = dicts.get(id);
  if (!d) return;
  closeSource(d);
  dicts.delete(id);
  if (activeId === id) {
    const first = dicts.keys().next();
    activeId = first.done ? null : first.value;
  }
  if (dicts.size === 0) setStatus("unloaded");
}

/**
 * 解析 MDX `@@@LINK=` 重定向（变形词条 → 原形词条），带深度保护。
 * 例：survivors 释义为 "@@@LINK=survivor" → 跟随并返回 survivor 的完整释义。
 *
 * 关键修复（2026-08-18）：跟随重定向时同时返回重定向终点词的 keyText，
 * 避免上层 entry.word 用用户原查询词（如 usually）、definition 却是重定向目标内容（如 usual），
 * 导致 headword ↔ body 不匹配（用户截图复现的严重 bug）。
 *
 * 链式重定向处理：例如 swots → swot → swat，最终 entry.word = swat（终点词），
 * 既与 definition 内容一致、又符合词典制作者的语义意图。
 */
function resolveMdxRedirect(
  src: DictSource,
  definition: string,
  depth: number
): { definition: string; keyText?: string } {
  if (depth > 3) return { definition };
  const m = /^@@@LINK=(.+)$/m.exec((definition || "").trim());
  if (!m) return { definition };
  // 清洗：@@@LINK 值尾部常带 \r\n\0（NUL 终止符），取首个换行/NUL 前的内容
  const target = m[1].trim().split(/[\u0000\r\n]/)[0].trim();
  if (!target) return { definition };

  let r: { keyText?: string; definition?: string } | null = null;
  try {
    r = src.backend === "stardict" && src.stardict
      ? src.stardict.lookupFlexible(target)
      : (src.mdx.lookup(target) || null);
  } catch {
    return { definition };
  }
  // 目标词存在但内容为空（如 chasid 词条定义缺失）→ 不跟随，保持原 @@@LINK 字面量
  if (!r || !r.definition) return { definition };

  // 递归跟随链：goal 是把"最终无 redirect 的内容"+ "最终 keyText" 一并回传
  const rec = resolveMdxRedirect(src, String(r.definition), depth + 1);
  return {
    definition: rec.definition,
    // keyText 优先级：链终点的 keyText > 当前一跳的 keyText > 链接字符串 target
    keyText: rec.keyText || r.keyText || target,
  };
}

// ==================== 互见词条跟随补中文（P1 核心） ====================

/**
 * 从互见词条释义中提取「目标词」（两种形态）：
 *   形态 1：<div class="also">…<a href="entry://…">目标词</a>…</div>
 *   形态 2：行内 `= <a href="entry://…">目标词</a>`（无 also div，如 tackey / vCJD）
 * 归一化处理：
 *   - 剥离同形词上标（tacky² → tacky，² 是同形词编号，其本身是独立词头可查）
 *   - 义项级引用（bay¹,9 → 逗号+数字）判定为「不跟随」，返回 null 避免误导
 */
function extractCrossrefTarget(def: string): string | null {
  if (!def) return null;
  let raw: string | null = null;
  const alsoM = /<div class="also">([\s\S]*?)<\/div>/.exec(def);
  if (alsoM) {
    const inner = alsoM[1];
    const linkM = inner.match(/<a\s+href="entry:\/\/[^"]*">([\s\S]*?)<\/a>/);
    raw = linkM ? linkM[1] : inner.replace(/<span class="zh">[\s\S]*?<\/span>/g, "");
  } else {
    const inlineM = def.match(/=\s*<a\s+href="entry:\/\/[^"]*">([\s\S]*?)<\/a>/i);
    if (inlineM) raw = inlineM[1];
  }
  if (!raw) return null;
  let t = raw
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  // 义项级引用：目标词尾部带 `,数字`（如 bay¹,9），跟随会拿到"整词"中文、误导具体义项 → 不跟随
  if (/[，,]\s*\d+\s*$/.test(t)) return null;
  // 同形词上标（²/³/⁰…）剥离后即为可查词头
  t = t.replace(/[，,]\s*\d+.*$/g, "").replace(/[\u00B9\u00B2\u00B3\u2070-\u209F]+$/g, "").trim();
  return t || null;
}

/**
 * 从释义中提取首个中文释义（<span class="zh">），无则空串。
 */
export function extractZhFromDef(def: string): string {
  if (!def) return "";
  const m = /<span class="zh">([\s\S]*?)<\/span>/i.exec(def);
  if (!m) return "";
  return m[1]
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 互见跟随的目标查词：先精确查（大小写容错 + 子串兜底）；
 * 查不到时尝试「姓氏简写」形态——词表里人名常以 "Vignola, Giacomo Barozzi da" 形式收词，
 * 而互见只写短名 "Vignola"。此时按「目标词 + 逗号」前缀匹配人名条目（如 Barozzi, Giacomo = Vignola → Vignola, …）。
 * 仅用于互见跟随，不改动用户主动查词行为。
 */
function lookupCrossrefTarget(
  src: DictSource,
  target: string
): { keyText: string; definition: string } | null {
  const direct = rawLookupInSrc(src, target);
  if (direct) return direct;
  try {
    const block: any[] =
      src.backend === "stardict" && src.stardict
        ? src.stardict.associate(target, 10) || []
        : src.mdx.associate(target) || [];
    const want = target.toLowerCase() + ",";
    for (const item of block) {
      const kt = item && item.keyText ? item.keyText : String(item);
      if (kt.toLowerCase().startsWith(want)) {
        const r = src.mdx.lookup(kt);
        if (r && r.definition) return { keyText: kt, definition: String(r.definition) };
      }
    }
  } catch (__swallowErr) { logSwallow(__swallowErr, "dict-engine.ts · lookupCrossrefTarget", "debug"); }
  return null;
}

/**
 * 互见跟随：跟随目标词（深度≤2 + seen 去重，防 a=b / b=a 死循环），
 * 取到中文则注入 entry.resolvedZh；取不到保持为空（不编造）。
 */
const CROSSREF_MAX_DEPTH = 2;

function followCrossrefZh(
  src: DictSource,
  entry: DictEntry,
  def: string,
  depth: number,
  seen: Set<string>
): void {
  if (depth > CROSSREF_MAX_DEPTH || entry.resolvedZh) return;
  const target = extractCrossrefTarget(def);
  if (!target) return;
  const key = target.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  try {
    const r = lookupCrossrefTarget(src, target);
    if (!r) return;
    const tDefResolved = resolveMdxRedirect(src, r.definition, 0);
    const tDef = tDefResolved.definition;
    const zh = extractZhFromDef(tDef);
    if (zh) {
      entry.resolvedZh = zh;
      return;
    }
    // 目标词也是互见型 → 继续跟随（深度受限）
    if (extractCrossrefTarget(tDef)) followCrossrefZh(src, entry, tDef, depth + 1, seen);
  } catch (__swallowErr) { logSwallow(__swallowErr, "dict-engine.ts · followCrossrefZh", "debug"); }
}

/**
 * 在指定词典源中「原始查词」（大小写容错 + 兜底子串精确匹配），
 * 不做互见跟随、不做 @@@LINK 解析 —— 供互见跟随复用，避免递归。
 */
function rawLookupInSrc(
  src: DictSource,
  clean: string
): { keyText: string; definition: string } | null {
  if (!src) return null;
  if (src.backend === "stardict" && src.stardict) {
    try {
      const r = src.stardict.lookupFlexible(clean);
      if (r && r.definition) return { keyText: r.keyText || clean, definition: String(r.definition) };
    } catch (err) {
      getLogger().warn("[REword] StarDict lookup(${clean}) 异常:", { error: err });
    }
    return null;
  }

  const candidates = [
    clean,
    clean.toLowerCase(),
    capitalize(clean.toLowerCase()),
    clean.toUpperCase(),
  ];

  // 收集所有候选命中结果，优先返回内容最丰富的词条。
  // NCECD 等词典中 "Young"（大写）是仅含 entry:// 交叉引用的薄条目（~220B），
  // 而 "young"（小写）才是完整义项（~3KB）。若直接返回首个命中（薄条目），
  // 上层渲染会得到空壳定义、中文释义丢失。改为遍历全部候选后择优。
  type RawHit = { keyText: string; definition: string };
  const hits: RawHit[] = [];
  for (const c of candidates) {
    try {
      const r = src.mdx.lookup(c);
      if (r && r.definition) {
        hits.push({ keyText: r.keyText || c, definition: String(r.definition) });
      }
    } catch (err) {
      getLogger().warn("[REword] lookup(${c}) 异常:", { error: err });
    }
  }
  if (hits.length > 0) {
    // 择优：优先定义最长（内容最丰富）的结果；长度相同时优先靠前候选（原始大小写）
    hits.sort((a, b) => b.definition.length - a.definition.length);
    return hits[0];
  }

  // 兜底：极少数因大小写/排序异常未能命中的词条，用子串精确匹配找回
  try {
    const target = clean.toLowerCase();
    const items: any[] = src.mdx.contains(clean, false, 200) || [];
    for (const item of items) {
      const kt = item && item.keyText ? item.keyText : String(item);
      if (kt.toLowerCase() === target) {
        const r = src.mdx.lookup(kt);
        if (r && r.definition) return { keyText: r.keyText || kt, definition: String(r.definition) };
      }
    }
  } catch (__swallowErr) { logSwallow(__swallowErr, "dict-engine.ts · try { const target = clean.toLowerCase(); const items: any[] = …", "debug"); }
  return null;
}

/**
 * 在指定词典源中精确查词（大小写容错）
 * 流程：原始查词 → @@@LINK 重定向解析 → 互见词条跟随目标词补中文（resolvedZh）
 * @param src  目标词典源
 * @param word 要查询的单词
 * @returns 词典条目或 null
 */
/**
 * 从释义 HTML 中提取「词典实际收录的词头」（区分多义头上标 ¹²³）。
 *   - NCECD：<span class="header">xxx</span>（如 "scrounge¹"）
 *   - ECD2：<span class="hw">x·x·x¹</span>（如 "har·mon·i·ca¹"，内含 <fgf>·</fgf> 间隔点）
 *
 * 关键作用：js-mdict 的 mdx.lookup() 返回的 keyText 是「用户查询词」（如 "scrounge"），
 * 但 MDX 实际收录的 key 是 "scrounge¹"（区分多义头）。
 * 若直接用查询词作 entry.word，会出现"headword 显示 scrounge，body 显示 scrounge¹"的不匹配。
 * 从 body 提取的才是词典里真正登记的词头。
 */
function extractBodyHeadword(def: string, backend: DictBackend): string | null {
  if (!def) return null;
  if (backend === "mdx") {
    // 优先 NCECD 格式
    const m1 = /<span\s+class=["']header["']>([\s\S]*?)<\/span>/i.exec(def);
    if (m1) {
      const text = m1[1].replace(/<[^>]+>/g, "").trim();
      return text || null;
    }
    // 回退 ECD2 格式：剥 <fgf>...</fgf> 包裹的间隔点，保留 ¹²³ 同形词上标
    const m2 = /<span\s+class=["']hw["']>([\s\S]*?)<\/span>/i.exec(def);
    if (m2) {
      const text = m2[1]
        .replace(/<fgf>[^<]*<\/fgf>/g, "") // 删 fgf 标签
        .replace(/·/g, "")                 // 删间隔点
        .replace(/<[^>]+>/g, "")           // 兜底删其它标签
        .trim();
      return text || null;
    }
    return null;
  }
  // StarDict 后端：词典直接返回 keyText 即可，无 body headword 标记
  return null;
}

/**
 * 检测 resolveRedirect 后的结果是否「实质有效」：
 *   - 真正的 @@@LINK= 字面量（目标词在 MDX 词表里缺失、跟随失败）→ 无效
 *   - 包含真实词头标记（<span class="hw"> 或 <span class="header">）→ 有效
 *   - 兜底：内容长度 > 0 且不含 @@ 前缀 → 有效（StarDict 等）
 */
function isResolvedDefValid(def: string, backend: DictBackend): boolean {
  if (!def) return false;
  // 仍为 @@@LINK 字面量（首尾可能有 \r\n\0 残字符，先 trim）
  const trimmed = def.trim();
  if (/^@@@LINK=/i.test(trimmed)) return false;
  // 至少有一个词典词头标记
  if (backend === "mdx") {
    if (/<span\s+class=["'](?:hw|header)["']>/i.test(def)) return true;
    // 没标记但长度够大（>50 字符）也视为有效——避免漏判一些只有派生/短语区的特殊词条
    if (def.length > 50) return true;
    return false;
  }
  // StarDict 或其他后端：长度够即视为有效
  return def.length > 0;
}

function lookupInDict(src: DictSource | null, word: string): DictEntry | null {
  if (!src) return null;

  const clean = (word || "").trim();
  if (!clean) return null;

  const raw = rawLookupInSrc(src, clean);
  if (!raw) return null;

  const resolved = resolveMdxRedirect(src, raw.definition, 0);

  // 修复（2026-08-18，3 处叠加）：
  //   1) 跟随重定向后必须把 entry.word 同步为目标词（之前"usually 显示 usual 内容"的核心 bug）
  //   2) 用释义 body 中真实收录的词头（带 ¹²³ 多义头上标）覆盖 js-mdict 返回的「查询词」，
  //      保证 headword 与 body 完全一致（scrounge vs scrounge¹ 类 case）
  //   3) broken redirect（目标词在 MDX 中缺失）→ 返回 null，UI 显示「未收录」而不是渲染破损字符串
  if (!isResolvedDefValid(resolved.definition, src.backend)) {
    return null;
  }

  const resolvedWord = resolved.keyText || raw.keyText || clean;
  const bodyHeadword = extractBodyHeadword(resolved.definition, src.backend);
  const finalWord = bodyHeadword || resolvedWord;

  const entry: DictEntry = {
    word: finalWord,
    definition: resolved.definition,
  };
  // 跟随重定向或与查询词不一致时保留 originalWord，UI 可显示「↪ usual」之类的来源标记
  if (finalWord.toLowerCase() !== clean.toLowerCase()) {
    entry.originalWord = clean;
  }
  followCrossrefZh(src, entry, resolved.definition, 0, new Set());
  return entry;
}

/**
 * 查询单词的「轻量元信息」（首个中文释义 + 首个词性），供渲染层做
 * 变形词词性继承（如 mushy 的比较级 → 继承 mushy 的 adj.）。
 * 作用于当前激活词典；查不到返回 null。
 */
export function lookupWordMeta(word: string): { zh?: string; pos?: string } | null {
  const src = getActive();
  if (!src) return null;
  const entry = lookupInDict(src, word);
  if (!entry) return null;
  const posM = /<span class="class[^"]*">([^<]*)<\/span>/i.exec(entry.definition);
  return {
    zh: entry.resolvedZh || extractZhFromDef(entry.definition) || undefined,
    pos: posM ? posM[1].trim() : undefined,
  };
}

/**
 * 精确查词（作用于当前激活词典，保持旧有调用兼容）
 */
export function lookup(word: string): DictEntry | null {
  return lookupInDict(getActive(), word);
}

/**
 * 检测查询词的文字类型，用于自动选择查词引擎
 *   - "cjk"：含中日韩汉字（中文查询）→ 走中文词典
 *   - "latin"：含拉丁字母（英文查询）→ 走英文词典
 *   - "other"：其它（纯数字/符号等）
 */
function detectScript(word: string): "cjk" | "latin" | "other" {
  const w = (word || "").trim();
  if (/[一-鿿㐀-䶿]/u.test(w)) return "cjk";
  if (/[a-zA-Z]/.test(w)) return "latin";
  return "other";
}

/**
 * 根据查询词内容，选出应参与查词的词典源（中文→中文词典，英文→英文词典）
 * 若对应语言的词典均未加载，则回退到全部已加载词典。
 */
function routeTargets(word: string): DictSource[] {
  const all = [...dicts.values()];
  if (all.length === 0) return [];
  const script = detectScript(word);
  let targets: DictSource[];
  if (script === "cjk") {
    targets = all.filter((d) => d.lang === "zh");
  } else {
    // latin / other：英文或未知语言的词典
    targets = all.filter((d) => d.lang === "en" || d.lang === "auto" || !d.lang);
  }
  if (targets.length === 0) return all; // 无对应语言词典时回退全部
  return targets;
}

/**
 * 智能查词：精确匹配 → 变形还原 → 返回空交由 UI 展示候选
 *
 * 查询流程：
 *   1. 精确匹配（含多种大小写形态）
 *   2. 失败后尝试常见变形还原（复数/过去式/进行式/比较级/最高级/副词/派生等）
 *   3. 仍失败则返回 null；上层 UI 应调用 searchCandidates() 展示最相似候选供用户选择
 *
 * 说明：步骤 3 不再自动取相似词的第一个作为结果，以避免误判——是否命中相近词交由用户决定。
 *
 * @returns DictEntry，命中时含 matchType 标注（exact / inflection），未命中返回 null
 */
export function lookupSmart(word: string): DictEntry | null {
  const clean = (word || "").trim();
  if (!clean) return null;

  // 根据查询内容（中文/英文）选择对应的词典集合
  let targets = routeTargets(clean);
  if (targets.length === 0) targets = [...dicts.values()];

  // 优先使用当前激活词典（修复：原逻辑不尊重 activeId，
  // 导致多词典同时加载时总是返回 Map 遍历顺序第一个的结果，
  // 表现为「切换到英汉大词典后查词内容仍与新世界词典一致」）。
  // 仅对多词典场景重排；单词典时 targets.length===1 跳过重排，行为不变。
  const active = getActive();
  if (active && targets.length > 1) {
    const idx = targets.findIndex((t) => t.id === active.id);
    if (idx > 0) {
      // 把激活词典移到最前，其余保持原顺序（激活词典查不到时自动回退）
      targets.splice(idx, 1);
      targets.unshift(active);
    }
  }

  // ---- 步骤 1：精确匹配（在目标词典集合中逐个尝试）----
  for (const src of targets) {
    const exact = lookupInDict(src, clean);
    if (exact) {
      exact.matchType = "exact";
      return exact;
    }
  }

  // ---- 步骤 2：变形还原（仅对英文查询有意义）----
  if (detectScript(clean) === "latin") {
    const lemmas = generateLemmas(clean);
    for (const lemma of lemmas) {
      for (const src of targets) {
        const r = lookupInDict(src, lemma);
        if (r) {
          r.matchType = "inflection";
          r.originalWord = clean;
          return r;
        }
      }
    }
  }

  // ---- 步骤 3：相似词搜索 ----
  // 不再自动取第一个候选作为结果（避免误判与"替用户做决定"）。
  // 交由上层 UI 通过 searchCandidates() 展示候选，由用户自行选择最相近的单词。
  return null;
}

/**
 * 快速精确词头判定：仅做一次 MDX 精确查找（二分定位，O(log n)），
 * 不走变形还原与模糊相似搜索。供「相关词生成」高频批量校验使用，避免触发昂贵模糊匹配。
 */
export function hasExactHeadword(word: string): boolean {
  const src = getActive();
  if (!src || !(src as any).mdx) return false;
  const clean = (word || "").trim().toLowerCase();
  if (!clean) return false;
  try {
    return !!(src as any).mdx.lookup(clean);
  } catch {
    return false;
  }
}

/**
 * 获取查询词的模糊候选（最相似的若干单词）
 *
 * 当精确匹配与变形还原都失败时，用于向用户展示「可能想查的原型/相近词」，
 * 由用户自行选择。典型场景：复数（books→book）、过去式（went→go）、拼写偏差等。
 *
 * @param word 原始查询词
 * @param limit 返回候选数量（默认 3，即「最相似三个相连单词」）
 * @returns 候选词列表（按相关度排序，可能为空）
 */
export function searchCandidates(word: string, limit: number = 3): string[] {
  const clean = (word || "").trim();
  if (!clean) return [];
  let targets = routeTargets(clean);
  if (targets.length === 0) targets = [...dicts.values()];
  return searchSimilarIn(targets, clean, limit);
}

/**
 * 生成单词的可能原形（lemma）候选列表
 * 覆盖英语常见变形：复数、过去式、进行式、比较级、最高级、副词、派生词等
 */
function generateLemmas(word: string): string[] {
  const w = word.trim();
  if (!w) return [];
  const lower = w.toLowerCase();
  const results: string[] = [];
  const seen = new Set<string>();

  const add = (candidate: string): void => {
    if (candidate && candidate.length >= 2 && candidate !== lower && !seen.has(candidate)) {
      seen.add(candidate);
      results.push(candidate);
    }
  };

  // ---- 名词复数还原 ----
  if (lower.endsWith("ies") && lower.length > 4) {
    add(lower.slice(0, -3) + "y");  // cities → city
  }
  if (lower.endsWith("ses") || lower.endsWith("xes") || lower.endsWith("zes") ||
      lower.endsWith("ches") || lower.endsWith("shes")) {
    add(lower.slice(0, -2));  // boxes → box, buses → bus, watches → watch
  }
  if (lower.endsWith("ves")) {
    add(lower.slice(0, -3) + "f");   // leaves → leaf
    add(lower.slice(0, -3) + "fe");  // knives → knife
  }
  if (lower.endsWith("s") && !lower.endsWith("ss")) {
    add(lower.slice(0, -1));  // cats → cat
  }

  // ---- 动词过去式/过去分词还原 ----
  if (lower.endsWith("ied") && lower.length > 4) {
    add(lower.slice(0, -3) + "y");  // carried → carry
  }
  if (lower.endsWith("ed") && lower.length > 3) {
    add(lower.slice(0, -2));       // walked → walk
    add(lower.slice(0, -2) + "e"); // baked → bake
    // 双写辅音：stopped → stop
    const stem = lower.slice(0, -2);
    if (stem.length >= 3 && isVowel(stem[stem.length - 2]) &&
        !isVowel(stem[stem.length - 1]) &&
        stem[stem.length - 1] === stem[stem.length - 3]) {
      add(stem.slice(0, -1));  // stopped → stop
    }
  }

  // ---- 动词进行式还原 ----
  if (lower.endsWith("ing") && lower.length > 4) {
    add(lower.slice(0, -3));       // going → go
    add(lower.slice(0, -3) + "e"); // making → make
    // 双写辅音：running → run
    const stem = lower.slice(0, -3);
    if (stem.length >= 3 && isVowel(stem[stem.length - 2]) &&
        !isVowel(stem[stem.length - 1]) &&
        stem[stem.length - 1] === stem[stem.length - 3]) {
      add(stem.slice(0, -1));  // running → run
    }
  }

  // ---- 形容词比较级/最高级还原 ----
  if (lower.endsWith("iest") && lower.length > 5) {
    add(lower.slice(0, -4) + "y");  // happiest → happy
  }
  if (lower.endsWith("er") && lower.length > 3) {
    add(lower.slice(0, -2));       // taller → tall
    add(lower.slice(0, -2) + "e"); // larger → large
  }
  if (lower.endsWith("est") && lower.length > 4) {
    add(lower.slice(0, -3));       // tallest → tall
    add(lower.slice(0, -3) + "e"); // largest → large
  }

  // ---- 副词还原 ----
  if (lower.endsWith("ly") && lower.length > 3) {
    add(lower.slice(0, -2));       // quickly → quick
    add(lower.slice(0, -2) + "e"); // nicely → nice
    // truly → true
    if (lower.endsWith("ely") && lower.length > 4) {
      add(lower.slice(0, -3) + "ue");
    }
  }

  // ---- 常见派生词还原 ----
  const suffixes = [
    "ness", "ment", "tion", "sion", "able", "ible",
    "ous", "ful", "less", "al", "ity", "ist", "ism",
    "ize", "ise", "ify", "ation", "ition",
  ];
  for (const suf of suffixes) {
    if (lower.endsWith(suf) && lower.length > suf.length + 2) {
      add(lower.slice(0, -suf.length));       // happiness → happy(近似)
      add(lower.slice(0, -suf.length) + "e"); // creation → create(近似)
    }
  }

  return results;
}

function isVowel(ch: string): boolean {
  return "aeiouAEIOU".includes(ch);
}

/**
 * 相似词搜索（在指定词典集合中）：前缀匹配 + 子串包含
 * @returns 候选词列表（按相关度排序）
 */
/**
 * 计算编辑距离（Levenshtein）。用于模糊候选排序，容忍插入/删除/替换等拼写偏差。
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const t = prev; prev = curr; curr = t;
  }
  return prev[n];
}

/**
 * 基于编辑距离的模糊候选搜索（MDX 词典）。
 *
 * 利用 keywordList（已排序词表）做二分定位到查询词首字母窗口，
 * 再对窗口内词条计算 Levenshtein 距离，挑出距离最小的若干个。
 * 能找回前缀/子串搜索遗漏的相近词（如 computr → computer、dictionry → dictionary）。
 *
 * @returns 按相似度升序排列的候选词
 */
export function fuzzyLevenIn(src: DictSource, word: string, limit: number): string[] {
  const clean = (word || "").trim().toLowerCase();
  if (!clean) return [];
  const maxDist = Math.max(2, Math.floor(clean.length / 3));

  // P4 索引路径：用 sortedKeys（小写去重排序）做锚点窗口，兼容双后端
  const idx = src.searchIndex;
  if (idx && idx.sortedKeys.length > 0) {
    const sorted = idx.sortedKeys;
    const anchor = clean.slice(0, Math.min(3, clean.length));
    const lo = lowerBound(sorted, anchor);
    const window = 8000;
    const start = Math.max(0, lo - 2000);
    const end = Math.min(sorted.length, start + window);
    const scored: { w: string; d: number }[] = [];
    const dedup = new Set<string>();
    for (let i = start; i < end; i++) {
      const lw = sorted[i];
      if (Math.abs(lw.length - clean.length) > maxDist + 2) continue;
      const d = levenshtein(clean, lw);
      if (d <= maxDist && !dedup.has(lw)) {
        dedup.add(lw);
        scored.push({ w: lw, d });
      }
    }
    scored.sort((a, b) => a.d - b.d || a.w.length - b.w.length);
    return scored.slice(0, limit).map((s) => s.w);
  }

  // 无索引时回退原路径（仅 MDX）
  if (!src.mdx || !Array.isArray((src.mdx as any).keywordList)) return [];
  const kl: any[] = (src.mdx as any).keywordList;
  const n = kl.length;
  if (n === 0) return [];

  // 用查询词前 3 个字符作为锚点做二分定位（而非仅首字母），把扫描窗口收敛到同前缀邻域
  const anchor = clean.slice(0, Math.min(3, clean.length));
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const k = ((kl[mid].keyText as string) || "").toLowerCase();
    if (k < anchor) lo = mid + 1;
    else hi = mid;
  }

  const window = 8000;
  const start = Math.max(0, lo - 2000);
  const end = Math.min(n, start + window);
  const scored: { w: string; d: number }[] = [];
  const dedup = new Set<string>();
  for (let i = start; i < end; i++) {
    const raw = (kl[i].keyText as string) || "";
    if (!raw) continue;
    const lw = raw.toLowerCase();
    // 长度差异过大则跳过，避免无关节点
    if (Math.abs(lw.length - clean.length) > maxDist + 2) continue;
    const d = levenshtein(clean, lw);
    if (d <= maxDist && !dedup.has(lw)) {
      dedup.add(lw);
      scored.push({ w: raw, d });
    }
  }
  scored.sort((a, b) => a.d - b.d || a.w.length - b.w.length);
  return scored.slice(0, limit).map((s) => s.w);
}

function searchSimilarIn(targets: DictSource[], word: string, limit: number): string[] {
  const clean = (word || "").trim();
  if (!clean || targets.length === 0) return [];

  const results: string[] = [];
  const seen = new Set<string>();

  const push = (ws: string[]) => {
    for (const w of ws) {
      if (!seen.has(w)) {
        seen.add(w);
        results.push(w);
      }
    }
  };
  const pushPrefix = (p: string, lim: number) => {
    for (const src of targets) {
      try {
        push(searchPrefixIn(src, p, lim));
      } catch (__swallowErr) { logSwallow(__swallowErr, "dict-engine.ts · pushPrefix", "debug"); }
      if (results.length >= lim) break;
    }
  };
  const pushFuzzy = (q: string, lim: number) => {
    for (const src of targets) {
      try {
        push(searchFuzzyIn(src, q, lim * 2));
      } catch (__swallowErr) { logSwallow(__swallowErr, "dict-engine.ts · pushFuzzy", "debug"); }
      if (results.length >= lim) break;
    }
  };

  // 1) 前缀匹配（最相关）
  pushPrefix(clean, limit);
  // 2) 子串包含
  if (results.length < limit) pushFuzzy(clean, limit);
  // 3) 去掉可能的尾部字符后前缀搜索（如 "running" → "runn" → 匹配 "run"）
  if (results.length < limit && clean.length > 4) {
    pushPrefix(clean.slice(0, -2), limit);
  }
  // 4) 编辑距离模糊匹配（补齐前缀/子串搜不到的相近词，如 computr → computer）
  if (results.length < limit) {
    for (const src of targets) {
      try {
        push(fuzzyLevenIn(src, clean, limit));
      } catch (__swallowErr) { logSwallow(__swallowErr, "dict-engine.ts · pushFuzzy", "debug"); }
      if (results.length >= limit) break;
    }
  }

  return results.slice(0, limit);
}

/**
 * 相似词搜索（作用于当前激活词典，保持旧有调用兼容）
 */
function searchSimilar(word: string, limit: number): string[] {
  const active = getActive();
  return searchSimilarIn(active ? [active] : [], word, limit);
}

/**
 * 前缀搜索（作用于单个词典源，大小写不敏感）
 * @returns 匹配的单词列表
 */
export function searchPrefixIn(src: DictSource | null, prefix: string, limit: number = 10): string[] {
  if (!src) return [];
  const p = (prefix || "").trim();
  if (!p) return [];

  try {
    const lower = p.toLowerCase();

    // P4 索引路径：二分定位前缀起点，前向收集（O(log n + k)，不依赖 mdx.associate）
    const idx = src.searchIndex;
    if (idx && idx.sortedKeys.length > 0) {
      const start = lowerBound(idx.sortedKeys, lower);
      const results: string[] = [];
      for (let i = start; i < idx.sortedKeys.length && results.length < limit; i++) {
        if (!idx.sortedKeys[i].startsWith(lower)) break;
        results.push(idx.sortedKeys[i]);
      }
      return results;
    }

    if (src.backend === "stardict" && src.stardict) {
      // StarDict 后端：使用内置的 associate（前缀搜索）
      const block: any[] = src.stardict.associate(p, limit) || [];
      return block.map((item: any) => item && item.keyText ? item.keyText : String(item));
    }

    // MDX 后端（无索引时回退原路径）
    const block: any[] = src.mdx.associate(p) || [];
    const results: string[] = [];
    for (const item of block) {
      const kt = item && item.keyText ? item.keyText : String(item);
      if (kt.toLowerCase().startsWith(lower)) {
        results.push(kt);
        if (results.length >= limit) break;
      }
    }
    return results;
  } catch (err) {
    getLogger().warn("[REword] 前缀搜索失败 (${prefix}):", { error: err });
    return [];
  }
}

/**
 * 模糊搜索（作用于单个词典源，子串匹配，大小写不敏感）
 * @returns 匹配的词列表
 */
export function searchFuzzyIn(src: DictSource | null, query: string, limit: number = 20): string[] {
  if (!src) return [];
  const q = (query || "").trim();
  if (!q) return [];

  try {
    const ql = q.toLowerCase();

    // P4 索引路径：只扫首字母桶（O(bucket) 而非 O(n)）。
    // 取舍：子串召回收窄到「首字符相同」的桶（如查询 xist 不再命中 existence），
    // 由前缀/去尾前缀/编辑距离四级链补回，换取查询性能。
    const idx = src.searchIndex;
    if (idx && idx.sortedKeys.length > 0) {
      const bucket = idx.buckets.get(/^[a-z]/.test(ql) ? ql[0] : "#");
      const results: string[] = [];
      if (bucket) {
        for (const k of bucket) {
          if (k.includes(ql)) {
            results.push(k);
            if (results.length >= limit) break;
          }
        }
      }
      return results;
    }

    if (src.backend === "stardict" && src.stardict) {
      // StarDict 后端：使用内置的 contains（子串搜索）
      const items: any[] = src.stardict.contains(q, false, limit) || [];
      return items.map((item: any) => item && item.keyText ? item.keyText : String(item));
    }

    // MDX 后端（无索引时回退原路径）
    const items: any[] = src.mdx.contains(q, false, limit) || [];
    return items.map((item) => (item && item.keyText ? item.keyText : String(item)));
  } catch (err) {
    getLogger().warn("[REword] 模糊搜索失败 (${query}):", { error: err });
    return [];
  }
}

/**
 * 前缀搜索（用于联想/补全，作用于当前激活词典，保持旧有调用兼容）
 * @param prefix 前缀
 * @param limit 最大返回数量
 * @returns 匹配的单词列表
 */
export function searchPrefix(prefix: string, limit: number = 10): string[] {
  return searchPrefixIn(getActive(), prefix, limit);
}

/**
 * 模糊搜索（子串匹配，作用于当前激活词典，保持旧有调用兼容）
 * @param query 搜索词
 * @param limit 最大返回数量
 * @returns 匹配的词列表
 */
export function searchFuzzy(query: string, limit: number = 20): string[] {
  return searchFuzzyIn(getActive(), query, limit);
}

/**
 * 获取词典状态
 */
export function getStatus(): DictStatus {
  return status;
}

/**
 * 获取当前激活词典 id
 */
export function getActiveId(): string | null {
  return activeId;
}

/**
 * 订阅状态变化
 */
export function onStatusChange(cb: (s: DictStatus) => void): () => void {
  statusCallbacks.push(cb);
  cb(status);
  return () => {
    statusCallbacks = statusCallbacks.filter((f) => f !== cb);
  };
}

function setStatus(s: DictStatus) {
  status = s;
  for (const cb of statusCallbacks) {
    try {
      cb(s);
    } catch (e) {
      getLogger().error("[REword] 状态回调异常:", { error: e });
    }
  }
}

/**
 * 清理资源
 */
export function dispose() {
  for (const d of dicts.values()) {
    closeSource(d);
  }
  dicts.clear();
  activeId = null;
  status = "unloaded";
}
