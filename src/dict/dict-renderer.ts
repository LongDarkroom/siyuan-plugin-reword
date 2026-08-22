/**
 * 词典查询结果渲染
 *
 * 将词典 HTML 释义转换为适合插件面板显示的格式
 * 提取音标、词性、释义、例句等结构化信息
 */

import type { DictEntry } from "./dict-engine.ts";
// 显式 .ts 扩展名：Node --experimental-strip-types 测试运行器不解析无扩展名导入（tsc/vite 用 bundler 解析不受影响）
import { lookupWordMeta, getExtraPhonetic, hasExactHeadword } from "./dict-engine.ts";
import type { WordInflections } from "./inflect.ts";

/** 解析后的结构化词条 */
export interface ParsedEntry {
  word: string;
  phonetic: string;
  html: string; // 清理后的 HTML（用于富文本完整显示）
  definition: string; // 原始 MDX 释义 HTML（用于结构化义项抽取）
  plainText: string; // 纯文本版本
  /** 匹配类型：exact=精确，inflection=变形还原，similar=相似词 */
  matchType?: "exact" | "inflection" | "similar";
  /** 用户原始查询词 */
  originalWord?: string;
  /** 候选词列表（similar 时） */
  candidates?: string[];
  /** 互见词条跟随目标词补回的中文释义（P1：tackey = tacky² → "邋遢的"） */
  resolvedZh?: string;
}

/** 单个义项（结构化） */
export interface SenseItem {
  num?: string; // 序号，如 "1." / "2"
  brief?: string; // 英文简义，如 "(cheerful, contented)"
  zh: string; // 中文释义
  example?: string; // 例句中文翻译
  exampleEn?: string; // 例句英文原文
  /** ECD2 一个义项下的多个例句（ea/eb 配对）。renderSenseItem 优先渲染此数组，回退 example/exampleEn */
  examples?: { en: string; zh: string }[];
  pos?: string; // 该义项所属词性，如 "n." / "v." / "adj."
  label?: string; // 语域/学科标签，如 "<非正式,贬>"（NCECD class="label"）
  /** 语法说明/变形说明（sense 内无 <span class="zh"> 时的回退文本），如 "acquit的过去式和过去分词" */
  note?: string;
}

/** 按词性分组的义项组 */
export interface PosSenseGroup {
  pos: string; // 词性标签，如 "n." / "v." / "adj." / ""
  items: SenseItem[]; // 该词性下的义项列表
}

/**
 * 2026-08-22 释义偏好：判断某个 SenseItem 是否在用户首选列表中
 *  - 比较时对两端都做 trim()，避免 NCECD 中文释义前后空格差异误判
 *  - preferred 数组为空/undefined → 一律 false
 */
export function isPreferredSense(s: SenseItem, preferred?: string[] | null): boolean {
  if (!preferred || preferred.length === 0) return false;
  const z = (s.zh || "").trim();
  if (!z) return false;
  for (const p of preferred) {
    if ((p || "").trim() === z) return true;
  }
  return false;
}

/** 渲染选项:2026-08-22 释义偏好相关字段 */
export interface RenderOpts {
  /** 用户勾选的"⭐ 优先"释义中文文本列表(命中即加 ⭐ + 高亮) */
  preferredDefinitions?: string[];
}

/**
 * 从 MDX 原始释义中抽取「最常见」的若干义项。
 * 兼容两款内置词典的不同 HTML 结构：
 *   - 新世纪英汉大词典（NCECD）：<div class="sense"> + <b class="num"> + <span class="zh">
 *   - 英汉大词典（第2版，ECD2）：<span class="xh">N. </span> 分隔 + <span class="smb"> + 裸中文文本
 *   - 其他格式：回退到纯文本按标点切分
 */
export function extractSenses(definition: string, max = 4): SenseItem[] {
  const out: SenseItem[] = [];
  const clean = (s: string) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();

  // 检测是否为现代汉语词典（hanyu）格式：<font size=+2 color="red">
  if (definition.includes('size=+2') && definition.includes('color="red"')) {
    const posM = definition.match(/<font\s*size=\+1\s*color=["']?green["']?>([^<]*)<\/font>/i);
    const pos = posM ? posM[1].trim() : "";
    const bodyStart = definition.indexOf('<font size=+1');
    const bodyText = bodyStart >= 0
      ? definition.slice(bodyStart).replace(/<[^>]+>/g, "")
      : definition.replace(/<[^>]+>/g, "");
    const senseRe = /[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑯⑰⑱⑲⑳]/g;
    const positions: number[] = [];
    let mm: RegExpExecArray | null;
    while ((mm = senseRe.exec(bodyText))) positions.push(mm.index);
    if (positions.length > 0) {
      for (let i = 0; i < positions.length && out.length < max; i++) {
        const start = positions[i];
        const end = i + 1 < positions.length ? positions[i + 1] : bodyText.length;
        let text = bodyText.slice(start, end).trim();
        text = text.replace(/^[①②③④⑤⑥⑦⑧⑨⑩]/, "").trim();
        if (text) out.push({ num: `${i + 1}.`, zh: text.slice(0, 50), pos: pos || undefined });
      }
    } else {
      const parts = bodyText.split(/[。；]/).filter((s) => s.trim());
      for (const p of parts.slice(0, max)) out.push({ zh: p.trim().slice(0, 50), pos: pos || undefined });
    }
    return out;
  }

  if (definition.includes('class="sense"') || definition.includes('class="ncecd_con"')) {
    // NCECD 格式（新世纪英汉大词典 全量）
    //   <span class="class">n.</span> 是「词性分区」标记，一个词条可多次出现（n. / vi. / vt. ...）
    //   每个 <div class="sense"> 义项归属于其「之前最近的」class 词性 —— 这是多词性正确分组的关键
    const classRe = /<span class="class[^"]*">([^<]*)<\/span>/g; // 兼容 class="class" 与 class="class xxx"
    const posRegions: { pos: string; start: number }[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = classRe.exec(definition))) {
      const p = normalizePos(cm[1].trim());
      if (p) posRegions.push({ pos: p, start: cm.index });
    }
    const posFor = (at: number): string => {
      let p = posRegions.length ? posRegions[0].pos : "";
      for (const r of posRegions) {
        if (r.start <= at) p = r.pos;
        else break;
      }
      return p;
    };
    // 习语/短语义项区（idiom / phr_s / dodo_phrase_sense / phrase_sense）无词性标记是数据属性，
    // 统一归为 phr.（习语/短语），提升 UI 信息层级并避免误报"无词性"。
    const isPhrasalAt = (at: number): boolean => {
      const upTo = definition.slice(0, at);
      return (
        /<div class="(?:idiom|phr_s|phr)">/.test(upTo) ||
        /<span class="(?:dodo_phrase_sense|phrase_sense)">/.test(upTo)
      );
    };

    // 例句块（<p class="ex"> 与 sense 平级，位于其后）
    const exBlocks: { start: number; en: string; zh: string }[] = [];
    const exRe = /<p class="ex">([\s\S]*?)<\/p>/g;
    let em: RegExpExecArray | null;
    while ((em = exRe.exec(definition))) {
      const raw = em[1];
      const en = raw.replace(/<span class="zh">[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      const zm = raw.match(/<span class="zh">([\s\S]*?)<\/span>/i);
      exBlocks.push({ start: em.index, en, zh: zm ? clean(zm[1]) : "" });
    }

    // 收集所有 sense（保留起止位置，便于定位其所属词性与相邻例句）
    const senseMatches: { inner: string; start: number; end: number }[] = [];
    const re = /<div class="sense">([\s\S]*?)<\/div>/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(definition))) {
      senseMatches.push({ inner: mm[1], start: mm.index, end: mm.index + mm[0].length });
    }

    for (let si = 0; si < senseMatches.length && out.length < max; si++) {
      const sm = senseMatches[si];
      const inner = sm.inner;
      const numM = inner.match(/<b class="num">([^<]*)<\/b>/);
      const briefM = inner.match(/<strong class="brief_ex">([\s\S]*?)<\/strong>/);
      const labelM = inner.match(/<span class="label">([\s\S]*?)<\/span>/i); // 语域/学科标签（如 <非正式,贬>）
      const zhParts = [...inner.matchAll(/<span class="zh">([\s\S]*?)<\/span>/g)].map((x) =>
        clean(x[1])
      );
      let zh = zhParts.length > 0 ? zhParts.join("；") : "";
      // 语法说明/变形说明型义项：sense 内无 <span class="zh">，但有一段说明文字
      // （如 "acquit的过去式和过去分词" / "(in US and Canada)" / "See xxx"）。
      // 提取为 note，避免 zh 空导致 UI 空白。优先级：brief 简义 > sense 纯文本。
      let note = "";
      if (!zh) {
        const briefOnly = briefM ? clean(briefM[1]) : "";
        const noteText = clean(
          inner
            .replace(/<b class="num">[\s\S]*?<\/b>/g, " ")
            .replace(/<strong class="brief_ex">[\s\S]*?<\/strong>/g, " ")
            .replace(/<span class="label">[\s\S]*?<\/span>/gi, " ")
            .replace(/<a\s+href="entry:\/\/[^"]*">/gi, " ")
            .replace(/<\/a>/gi, " ")
        );
        if (briefOnly && briefOnly !== "See") {
          note = briefOnly;
          zh = briefOnly;
        } else if (noteText && noteText !== "See") {
          note = noteText;
          zh = noteText;
        }
      }
      // 例句：优先取「sense 内部」的 <p class="ex">（NCECD 多数例句嵌在义项 div 内，
      // 旧逻辑只查「sense 之后、下一 sense 之前」导致此类例句全部丢失，契合度修复）；
      // 找不到再回退到 sense 之间的相邻例句窗口。
      let example = "";
      let exampleEn = "";
      const innerEx = inner.match(/<p class="ex">([\s\S]*?)<\/p>/i);
      if (innerEx) {
        exampleEn = innerEx[1]
          .replace(/<span class="zh">[\s\S]*?<\/span>/g, "")
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim();
        const iz = innerEx[1].match(/<span class="zh">([\s\S]*?)<\/span>/i);
        example = iz ? clean(iz[1]) : "";
      } else {
        const nextStart = si + 1 < senseMatches.length ? senseMatches[si + 1].start : definition.length;
        for (const ex of exBlocks) {
          // 真实结构：<p class="ex"> 紧贴其归属 sense 的 </div> 之后（ex.start == sense.end），
          // 因此用 >=（旧代码用严格 > 导致例句全部漏匹配，契合度修复）
          if (ex.start >= sm.end && ex.start < nextStart) {
            exampleEn = ex.en;
            example = ex.zh;
            break;
          }
        }
      }
      out.push({
        num: numM ? numM[1].trim() : "",
        brief: briefM ? clean(briefM[1]) : "",
        zh,        // 不再硬截断：释义长度由外层 max 数量控制，避免切断语义
        note: note || undefined,
        example,   // 不再硬截断
        exampleEn, // 不再硬截断
        // 词性回填优先级：class 词性分区 > 习语/短语义项区(phr.) > 变形说明型继承原词词性（P1-4）
        pos: (posFor(sm.start) || (isPhrasalAt(sm.start) ? "phr." : (note ? inheritNotePos(note) : undefined))) || undefined,
        label: labelM ? clean(labelM[1]) : undefined,
      });
    }
  } else if (definition.includes('class="xh"')) {
    // ECD2 格式分析：
    //   <span class="xh">1.</span> 是**义项序号**（不是词性！）
    //   真正的词性在 <span class="tz"><span class="cx">n.</span> 或 <span class="cxb">phr.</span>
    //   一个词条可能有多个词性分区（如 n. / a. / phr.）

    // 1) 直接提取所有词性标记及其位置
    const posRegions: { pos: string; start: number }[] = [];
    // <span class="cx">n.</span> 或 <span class="cx">n. <cx></span> — 主要词性（名词/动词/形容词等）
    const cxRe = /<span\s+class=["']?cx["']?[^>]*>\s*([A-Za-z]{1,4})\./gi;
    let tm: RegExpExecArray | null;
    while ((tm = cxRe.exec(definition))) {
      posRegions.push({ pos: normalizePos(tm[1] || ""), start: tm.index });
    }
    // <span class="cxb">phr.</span> — 词组/短语分区
    const cxbRe = /<span\s+class=["']?cxb["']?[^>]*>\s*([A-Za-z]{1,4}\.?)/gi;
    while ((tm = cxbRe.exec(definition))) {
      posRegions.push({ pos: normalizePos(tm[1]?.replace(/\./g, "") || "phr") + ".", start: tm.index });
    }

    // 2) 用 <span class="xh">数字.</span> 作为义项分隔符
    const xhRe = /<span\s+class=["']?xh["']?[^>]*>\s*(\d+)\.\s*<\/span>/g;
    const senses: { index: number; num: string }[] = [];
    let xm: RegExpExecArray | null;
    while ((xm = xhRe.exec(definition))) {
      senses.push({ index: xm.index, num: xm[1]?.trim() || "" });
    }

    // 3) 为每个义项确定所属词性（根据位置落在哪个 posRegion 内）
    for (let i = 0; i < senses.length && out.length < max; i++) {
      const sStart = senses[i].index;
      const sEnd = i + 1 < senses.length ? senses[i + 1].index : definition.length;
      const chunk = definition.slice(sStart, sEnd);

      // 确定该义项所属词性：取位置在该义项之前、最近的那个词性标记
      let sensePos = "";
      if (posRegions.length) {
        for (let j = posRegions.length - 1; j >= 0; j--) {
          if (posRegions[j].start <= sStart) { sensePos = posRegions[j].pos; break; }
        }
        // 如果义项在所有词性标记之前，取第一个
        if (!sensePos) sensePos = posRegions[0].pos;
      }

      const briefM = chunk.match(/<span\s+class=["']?smb["']?[^>]*>([\s\S]*?)<\/span>/i)
                 || chunk.match(/<span\s+class=["']?sma["']?[^>]*>([\s\S]*?)<\/span>/i);
      // ECD2 语域标签（lyb）：提取为 label 而非丢弃（如"或保护等""纸牌""有意识地""婴儿"）
      const lybM = chunk.match(/<span\s+class=["']?lyb["']?[^>]*>([\s\S]*?)<\/span>/i);
      // ECD2 例句提取（ea=英文原文，eb=中文翻译）：在文本清洗前先提取，
      // 收集 chunk 内【全部】ea/eb 配对（一个义项下常有多条例句，此前只取首个导致大量漏捕）。
      const eaAll = [...chunk.matchAll(/<span\s+class=["']?ea["'][^>]*>([\s\S]*?)<\/span>/gi)]
        .map((m) => clean(m[1]).trim()).filter(Boolean);
      const ebAll = [...chunk.matchAll(/<span\s+class=["']?eb["'][^>]*>([\s\S]*?)<\/span>/gi)]
        .map((m) => clean(m[1]).trim()).filter(Boolean);
      const examples: { en: string; zh: string }[] = [];
      const pairN = Math.min(eaAll.length, ebAll.length);
      for (let k = 0; k < pairN; k++) examples.push({ en: eaAll[k], zh: ebAll[k] });
      // 仅有英文例句（无配对中文）也保留，确保英文例句不丢
      for (let k = pairN; k < eaAll.length; k++) examples.push({ en: eaAll[k], zh: "" });
      // 单义项下例句过多会撑爆卡片，封顶 6 条（详情/展开模式可见全部）
      const examplesCapped = examples.slice(0, 6);

      let t = chunk
        .replace(/<span\s+class=["']?smb["'][^>]*>[\s\S]*?<\/span>/gi, "")
        .replace(/<span\s+class=["']?sma["'][^>]*>[\s\S]*?<\/span>/gi, "")
        .replace(/<span\s+class=["']?ea["'][^>]*>[\s\S]*?<\/span>/gi, "")
        .replace(/<span\s+class=["']?eb["'][^>]*>[\s\S]*?<\/span>/gi, "")
        .replace(/<span\s+class=["']?tz["'][^>]*>[\s\S]*?<\/span>/gi, "")
        .replace(/<span\s+class=["']?lyb["'][^>]*>[\s\S]*?<\/span>/gi, "")
        .replace(/<ii>[\s\S]*?<\/ii>/g, "")
        .replace(/<br\s*\/?>/g, " ")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      t = t.replace(/^\d+\.\s*/, "").trim();
      // 过滤尾部派生词脏数据（如 "ex·pos·er n." 混入最后一条释义）
      t = t.replace(/\s*[a-z]+(?:·[a-z]+)+\s+[nva]\.\s*$/, "").trim();
      if (!t) continue;
      out.push({
        num: senses[i].num,
        brief: briefM ? clean(briefM[1]) : "",
        zh: t,
        example: examplesCapped[0]?.zh || "",
        exampleEn: examplesCapped[0]?.en || "", // 回退首条，兼容旧字段
        examples: examplesCapped, // 全部例句（renderSenseItem 优先渲染此数组）
        pos: sensePos || undefined,
        label: lybM ? clean(lybM[1]) : undefined,
      });
    }
  } else {
    const plain = clean(definition);
    const parts = plain.split(/[。；;]/).filter((s) => s.trim());
    // 兜底：纯文本切分，尝试从上下文启发式推断词性
    for (const p of parts.slice(0, max)) {
      // 尝试从文本中提取 "n." / "v." / "adj." 等前缀词性标记
      const leadingPos = p.match(/^(\s*(?:[a-zA-Z]{1,4}\.?\s*)+)(.+)/);
      out.push({
        zh: leadingPos ? leadingPos[2].trim().slice(0, 40) : p.trim().slice(0, 40),
        pos: leadingPos ? normalizePos(leadingPos[1]) : undefined,
      });
    }
  }
  return out;
}

/** 合并连续重复的分隔符（如 "；；" → "；"） */
function dedupeSep(s: string): string {
  return s.replace(/；\s*；/g, "；").replace(/；\s*$/, "").replace(/^\s*；/, "");
}

/**
 * P1-4 变形说明型义项的词性继承：note 形如「mushy 的比较级」「acquit的过去式和过去分词」
 * 时，跟随 note 中的目标词（原形）二次查词，继承其首个词性。
 * 保守策略：仅当 note 明确含「的+语法形态词」才触发（避免 "(in US and Canada)" 类说明误继承）；
 * 带缓存，同一目标词只查一次。
 */
const notePosCache = new Map<string, string>();
function inheritNotePos(note: string): string | undefined {
  if (!note) return undefined;
  const m = note.match(/([A-Za-z][A-Za-z'-]{1,39})\s*的(?:过去式|过去分词|现在分词|第三人称单数|复数|比较级|最高级)/);
  if (!m) return undefined;
  const target = m[1].toLowerCase();
  if (notePosCache.has(target)) return notePosCache.get(target) || undefined;
  let pos: string | undefined;
  try {
    const meta = lookupWordMeta(target);
    if (meta && meta.pos) pos = normalizePos(meta.pos) || undefined;
  } catch {
    /* ignore */
  }
  notePosCache.set(target, pos || "");
  return pos;
}

/** 去掉已自带的一层括号，避免渲染时再加一层变成 ((...)) */
function stripWrappingParens(s: string): string {
  const t = s.trim();
  if (t.startsWith("(") && t.endsWith(")")) return t.slice(1, -1).trim();
  return t;
}

/** 渲染单条义项（简洁/详细/分组模式共用）。showPos=true 时显示行首词性小标签。
 *  P1 protyle 语义化：brief 用 <em>（斜体=思源编辑器强调）、zh 用 <strong>（加粗=释义核心）。
 *  2026-08-22 释义偏好：opts.preferredDefinitions 包含 s.zh(trim 后)时,该 sense 加 ⭐ + 金色背景。
 */
function renderSenseItem(
  s: SenseItem,
  showPos: boolean,
  opts: { preferredDefinitions?: string[] } = {}
): string {
  const isPreferred = isPreferredSense(s, opts.preferredDefinitions);
  const star = isPreferred
    ? '<span class="hiword-dict-sense-star" title="你的偏好释义">⭐</span>'
    : "";
  const preferredClass = isPreferred ? " hiword-dict-sense--preferred" : "";
  return (
    `<li class="hiword-dict-sense-item${preferredClass}"` + (s.pos ? ` data-pos="${escapeAttr(s.pos)}"` : "") + `>` +
    star +
    (showPos && s.pos ? `<span class="hiword-dict-sense-pos">${escapeHtml(s.pos)}</span>` : "") +
    (s.num ? `<span class="hiword-dict-sense-num">${escapeHtml(s.num)}</span>` : "") +
    `<div class="hiword-dict-sense-body">` +
      `<div class="hiword-dict-sense-main">` +
        (s.brief ? `<em class="hiword-dict-sense-brief">${escapeHtml(stripWrappingParens(s.brief))}</em>` : "") +
        (s.label ? `<span class="hiword-dict-sense-label">${escapeHtml(s.label)}</span>` : "") +
        `<strong class="hiword-dict-sense-zh">${escapeHtml(s.zh)}</strong>` +
      "</div>" +
      (s.examples && s.examples.length
        ? (() => {
            const [first, ...rest] = s.examples;
            let html =
              `<blockquote class="hiword-dict-sense-ex-row" data-action="tts" data-text="${escapeAttr(first.en)}" title="点击朗读例句">` +
              `<span class="hiword-dict-sense-en">${escapeHtml(first.en)}<span class="hiword-tts-ico">🔊</span></span>` +
              (first.zh ? `<span class="hiword-dict-sense-ex-zh">${escapeHtml(first.zh)}</span>` : "") +
              "</blockquote>";
            if (rest.length > 0) {
              html +=
                `<div class="hiword-dict-sense-ex-more">` +
                `<button type="button" class="hiword-dict-sense-ex-toggle b3-button b3-button--text b3-button--small" data-action="toggle-examples">` +
                `<span class="hiword-dict-sense-ex-toggle-arrow">▾</span> 展开 ${rest.length} 条例句</button>` +
                `<div class="hiword-dict-sense-ex-rest" hidden>` +
                rest
                  .map(
                    (ex) =>
                      `<blockquote class="hiword-dict-sense-ex-row" data-action="tts" data-text="${escapeAttr(ex.en)}" title="点击朗读例句">` +
                      `<span class="hiword-dict-sense-en">${escapeHtml(ex.en)}<span class="hiword-tts-ico">🔊</span></span>` +
                      (ex.zh ? `<span class="hiword-dict-sense-ex-zh">${escapeHtml(ex.zh)}</span>` : "") +
                      "</blockquote>"
                  )
                  .join("") +
                "</div></div>";
            }
            return html;
          })()
        : s.exampleEn
          ? `<blockquote class="hiword-dict-sense-ex-row" data-action="tts" data-text="${escapeAttr(s.exampleEn)}" title="点击朗读例句">` +
            `<span class="hiword-dict-sense-en">${escapeHtml(s.exampleEn)}<span class="hiword-tts-ico">🔊</span></span>` +
            (s.example ? `<span class="hiword-dict-sense-ex-zh">${escapeHtml(s.example)}</span>` : "") +
            "</blockquote>"
          : "") +
    "</div></li>"
  );
}

/**
 * 将「最常见义项」渲染为结构化的美化列表（用于详细模式 / 无分组时的回退）。
 * 布局：行首 = 词性小标签 + 序号；主行 = 英文简释 + 中文释义；第二行 = 英文例句 + 中文翻译
 * 词性标签与释义一一对应，实现「释义 ↔ 词性」模板深度配合。
 * 2026-08-22 释义偏好：opts.preferredDefinitions 命中时加 ⭐ 高亮。
 */
export function renderSensesList(
  definition: string,
  max = 6,
  opts: { preferredDefinitions?: string[] } = {}
): string {
  const senses = extractSenses(definition, max);
  if (!senses.length) return "";
  const items = senses.map((s) => renderSenseItem(s, true, opts)).join("");
  // P2：义项列表语义化为 ul>li（保留 data-pos 等属性）
  return `<ul class="hiword-dict-senses">${items}</ul>`;
}

/**
 * P1-2 义项展开：折叠态只显示前 4 条，长词条（如 legging 27 义项）通过
 * 「查看全部 N 个义项」按钮展开全量列表（隐藏容器切换 hidden）。
 */
function renderSensesMore(definition: string, total: number): string {
  return renderSensesMoreWithOpts(definition, total, {});
}

/** 2026-08-22 释义偏好:支持透传 preferredDefinitions 到内部 renderSensesList */
function renderSensesMoreWithOpts(
  definition: string,
  total: number,
  opts: { preferredDefinitions?: string[] }
): string {
  return (
    // P2：改 b3-button--text 文本按钮（保留 data-action="toggle-senses"）
    '<button type="button" class="b3-button b3-button--text b3-button--small hiword-dict-senses-toggle" data-action="toggle-senses" title="展开 / 收起全部义项">' +
      '<span class="hiword-dict-senses-toggle-arrow">▾</span>' +
      '查看全部 ' + total + ' 个义项' +
    "</button>" +
    '<div class="hiword-dict-senses-full" hidden>' + renderSensesList(definition, 99, opts) + "</div>"
  );
}

/**
 * 详细页「按词性分组 + 可折叠」渲染（修复：词性框点击无响应）。
 *
 * 每种词性一组，组头为可点击的词性框（data-action="toggle-pos"），
 * 点击折叠 / 展开该词性下的全部义项。默认【全部展开】，保留「一眼看全」的浏览体验，
 * 同时支持按需收起长词条，避免刷屏。复用 handleDockClick 的 toggle-pos 分支与
 * togglePosCollapsed() 逻辑，因此点击行为在词库卡片与详情页保持一致。
 */
export function renderVocabDetailSenses(
  definition: string,
  opts: { preferredDefinitions?: string[] } = {}
): string {
  const groups = extractSensesByPos(definition, 99, 30, 400);
  if (!groups.length) return renderSensesList(definition, 8, opts);

  const blocks = groups
    .map((g, i) => {
      const posLabel = g.pos && POS_LABELS[g.pos] ? " <small>" + POS_LABELS[g.pos] + "</small>" : "";
      // 默认展开：不加 hiword-vb-pos-collapsed，且带 hiword-vb-pos-open 高亮
      const chip =
        '<button type="button" class="hiword-vb-pos-chip hiword-vb-pos-toggle hiword-vb-pos-open"' +
        ' data-action="toggle-pos" title="点击展开 / 收起该词性"><span class="hiword-vb-pos-arrow">▸</span>' +
        escapeHtml(g.pos) + posLabel + "</button>";
      // P2：renderSenseItem 现为 <li>，需在 ul 内包裹（词性分组义项列表）
      const senseItems = '<ul class="hiword-vb-detail-senselist">' +
        g.items.map((s) => renderSenseItem(s, false, opts)).join("") + "</ul>";
      return (
        '<div class="hiword-vb-pos-block" data-pos-idx="' + i + '">' +
          '<div class="hiword-vb-pos-row">' + chip + "</div>" +
          '<div class="hiword-vb-pos-body">' + senseItems + "</div>" +
        "</div>"
      );
    })
    .join("");
  return '<div class="hiword-vb-detail-posgroups">' + blocks + "</div>";
}

/**
 * 按词性分组抽取义项（用于词库卡片简洁模式）。
 */
export function extractSensesByPos(
  definition: string,
  maxPerPos = 3,
  maxGroups = 4,
  scanCap = 40
): PosSenseGroup[] {
  const allSenses = extractSenses(definition, scanCap);
  if (!allSenses.length) return [];

  const groupMap = new Map<string, SenseItem[]>();
  // 第一轮：优先把「有中文释义」的义项作为各组代表（跳过 See/短语型交叉引用空义项）
  for (const s of allSenses) {
    const key = (s.pos || "").trim() || "";
    let list = groupMap.get(key);
    if (!list) { list = []; groupMap.set(key, list); }
    if (list.length < maxPerPos && s.zh) list.push(s);
  }
  // 第二轮：填补仍缺的空位（仅含无释义交叉引用时退而求其次）
  for (const s of allSenses) {
    const key = (s.pos || "").trim() || "";
    const list = groupMap.get(key);
    if (list && list.length < maxPerPos) list.push(s);
  }

  const groups: PosSenseGroup[] = [];
  for (const [pos, items] of groupMap) {
    groups.push({ pos: pos === "其他" ? "" : pos, items });
  }
  const validPos = new Set(Object.keys(POS_LABELS));
  const filtered = groups.filter((g) => g.pos === "" || validPos.has(g.pos));
  const used = filtered.length ? filtered : groups;
  used.sort((a, b) => {
    if (!a.pos) return 1; if (!b.pos) return -1;
    return a.pos.localeCompare(b.pos);
  });
  return used.slice(0, maxGroups);
}

/** 词性显示名映射（简短化，支持大小写变体） */
const POS_LABELS: Record<string, string> = {
  "n.": "名词", "v.": "动词", "vt.": "及物动词", "vi.": "不及物动词",
  "adj.": "形容词", "adv.": "副词", "prep.": "介词", "conj.": "连词",
  "pron.": "代词", "art.": "冠词", "num.": "数词", "int.": "感叹词",
  "phr.": "短语", "affix.": "词缀",
  // 无尾点变体（ECD2 等词典可能返回 "N" / "V" / "ADJ"）
  "n": "名词", "v": "动词", "vt": "及物动词", "vi": "不及物动词",
  "adj": "形容词", "adv": "副词", "prep": "介词", "conj": "连词",
  "pron": "代词", "art": "冠词", "num": "数词", "int": "感叹词",
  "phr": "短语", "affix": "词缀",
};

/**
 * 词性 → 「图标字母 + 中文名」映射（图标+文字 词性标注）。
 * 兼容 n./v./vt./vi./adj./adv./prep./conj./pron./art./num./int./phr. 及无尾点变体。
 */
function posBadgeMeta(pos: string): { ico: string; zh: string } {
  const p = (pos || "").trim().toLowerCase().replace(/\.$/, "");
  switch (p) {
    case "n": case "nc": case "nu": case "cn": case "un": return { ico: "N", zh: "名词" };
    case "v": return { ico: "V", zh: "动词" };
    case "vt": return { ico: "V", zh: "及物动词" };
    case "vi": return { ico: "V", zh: "不及物动词" };
    case "adj": return { ico: "ADJ", zh: "形容词" };
    case "adv": return { ico: "ADV", zh: "副词" };
    case "prep": return { ico: "PREP", zh: "介词" };
    case "conj": return { ico: "CONJ", zh: "连词" };
    case "pron": return { ico: "PRON", zh: "代词" };
    case "art": return { ico: "ART", zh: "冠词" };
    case "num": return { ico: "NUM", zh: "数词" };
    case "int": return { ico: "INT", zh: "感叹词" };
    case "phr": return { ico: "PHR", zh: "短语" };
    case "affix": return { ico: "AFFIX", zh: "词缀" };
    default: return { ico: "·", zh: (pos || "").trim() };
  }
}

/**
 * 渲染词性标注徽标：<i> 图标字母（语义色方块）+ 中文词性名。
 * - clickable=true 时渲染为 <button data-action="toggle-pos">（有更多义项可展开）
 * - data-pos 属性驱动 CSS 分色（n./v./adj./adv./prep./phr.）
 */
function renderPosBadge(pos: string, opts?: { clickable?: boolean; title?: string; extraClass?: string }): string {
  const m = posBadgeMeta(pos);
  const inner =
    `<i class="hiword-vb-pos-ico">${escapeHtml(m.ico)}</i>` +
    `<span class="hiword-vb-pos-text">${escapeHtml(m.zh)}</span>`;
  const posAttr = pos ? ` data-pos="${escapeAttr(normalizePos(pos))}"` : "";
  if (opts?.clickable) {
    return (
      `<button type="button" class="hiword-vb-pos-chip hiword-vb-pos-toggle${opts.extraClass ? " " + opts.extraClass : ""}"` +
      ` data-action="toggle-pos"${posAttr}${opts.title ? ` title="${escapeAttr(opts.title)}"` : ""}>` +
      inner + `<span class="hiword-vb-pos-arrow">▸</span></button>`
    );
  }
  return `<span class="hiword-vb-pos-chip"${posAttr}>${inner}</span>`;
}

/**
 * 标准化词性标签：统一转小写 + 补尾点 + 映射到标准 key。
 * 处理 "N"/"n."/n"/"noun" 等各种变体，返回可用于 POS_LABELS 查找的 key。
 */
function normalizePos(raw: string): string {
  if (!raw) return "";
  let s = raw.trim().toLowerCase();
  // 去掉已有尾点再统一补上，避免 "n.."
  if (s.endsWith(".")) s = s.slice(0, -1);
  s = s.replace(/\./g, "");
  // 全称缩写 → 标准缩写
  const fullForms: Record<string, string> = {
    noun: "n", verb: "v", adverb: "adv", adjective: "adj",
    preposition: "prep", conjunction: "conj", pronoun: "pron",
    article: "art", numeral: "num", interjection: "int",
    "transitive verb": "vt", "intransitive verb": "vi",
  };
  if (fullForms[s]) s = fullForms[s];
  // 补回尾点作为标准 key
  return s ? s + "." : "";
}

/**
 * 从 MDX 释义中抽取「词组 / 短语」（用于详细模式第二层）。
 */
export interface PhraseItem {
  en: string;
  zh: string;
  /** 词组/搭配的例句英文（NCECD 词条内例句） */
  exampleEn?: string;
  /** 词组/搭配的例句中文 */
  example?: string;
}

/**
 * 词条内容结构分类（契合度：数据字段 ↔ 解析逻辑精准对应）
 * - standard：标准义项词条（<div class="sense">），走 extractSenses
 * - phrase  ：纯词组/搭配词条（maybe_phrase/collocation，无 sense），走 extractPhraseEntry
 * - crossref：互见/同义词条（class="also" / = 目标词，如 tape slap = tape echo），走 extractCrossrefEntry
 * - plain   ：其他（词缀 prefix/suffix、专名、变形说明等），回退原始 HTML
 */
export type EntryKind = "standard" | "phrase" | "crossref" | "plain";

/** 检测词条内容结构类型（按优先级：sense > 词组块 > also 互见 > 行内互见） */
export function detectEntryKind(definition: string): EntryKind {
  if (/<div class="sense">/.test(definition)) return "standard";
  if (/<div class="(?:maybe_phrase|collocation)[^"]*">/.test(definition)) return "phrase";
  if (/<div class="also">/.test(definition)) return "crossref";
  // 行内互见（无 also div）：如 tackey = <a href="entry://tacky">tacky²</a> / mushier 型
  if (/=\s*<a\s+href="entry:\/\/[^"]*">/i.test(definition)) return "crossref";
  return "plain";
}

/** 从纯词组词条中提取主词组（英文 + 中文 + 例句） */
export function extractPhraseEntry(definition: string): PhraseItem | null {
  const blockRe = /<div class="(maybe_phrase|collocation)[^"]*">([\s\S]*?)<\/div>/;
  const m = blockRe.exec(definition);
  if (!m) return null;
  const inner = m[2];
  const pre = inner.replace(/<span class="or">([\s\S]*?)<\/span>/gi, " $1 ");
  const ph = pre.match(/<span class="(?:phrase_with_or|mphr_en to|mphr_en|phrase_sense)">([\s\S]*?)<\/span>/i);
  const en = ph
    ? cleanHtml(ph[1].replace(/<[^>]+>/g, ""))
    : cleanHtml(pre.replace(/<span class="zh">[\s\S]*?<\/span>/g, ""));
  const zhm = inner.match(/<span class="zh">([\s\S]*?)<\/span>/i);
  // 例句：词组块结束 </div> 之后紧邻的 <p class="ex">
  const after = definition.slice(m.index + m[0].length, m.index + m[0].length + 1200);
  const exm = after.match(/<p class="ex">([\s\S]*?)<\/p>/i);
  let exampleEn = "";
  let example = "";
  if (exm) {
    exampleEn = exm[1]
      .replace(/<span class="zh">[\s\S]*?<\/span>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const ez = exm[1].match(/<span class="zh">([\s\S]*?)<\/span>/i);
    example = ez ? cleanHtml(ez[1]) : "";
  }
  if (!en) return null;
  return { en, zh: zhm ? cleanHtml(zhm[1]) : "", exampleEn, example };
}

/** 从互见词条中提取目标词（class="also" 或 行内 `= <a>` 两种形态） */
export function extractCrossrefEntry(definition: string): { pos?: string; target: string; zh?: string } | null {
  const posM = definition.match(/<span class="class[^"]*">([^<]*)<\/span>/);
  // 形态 1：<div class="also">…</div>
  const alsoM = definition.match(/<div class="also">([\s\S]*?)<\/div>/);
  // 形态 2：行内 `= <a href="entry://…">目标</a>`（无 also div，如 tackey / vCJD）
  const inlineM = !alsoM ? definition.match(/=\s*<a\s+href="entry:\/\/[^"]*">([\s\S]*?)<\/a>/i) : null;
  if (!alsoM && !inlineM) return null;
  const inner = alsoM ? alsoM[1] : "";
  const linkM = alsoM
    ? inner.match(/<a\s+href="entry:\/\/[^"]*">([\s\S]*?)<\/a>/)
    : null;
  const zhM = alsoM ? inner.match(/<span class="zh">([\s\S]*?)<\/span>/i) : null;
  const target = alsoM
    ? (linkM ? cleanHtml(linkM[1]) : cleanHtml(inner.replace(/<span class="zh">[\s\S]*?<\/span>/g, "")))
    : (inlineM ? cleanHtml(inlineM[1]) : "");
  if (!target) return null;
  return {
    pos: posM ? normalizePos(posM[1].trim()) : undefined,
    target,
    zh: zhM ? cleanHtml(zhM[1]) : undefined,
  };
}

/** 去除 HTML 标签并还原常见实体，压缩空白 */
function cleanHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractPhrases(definition: string): PhraseItem[] {
  const out: PhraseItem[] = [];
  const seen = new Set<string>();
  const pre = definition.replace(/<span class="or">([\s\S]*?)<\/span>/gi, " $1 ");

  const add = (enRaw: string, zhRaw: string, after?: string) => {
    const en = cleanHtml(enRaw).trim();
    if (!en || en.length < 2) return;
    const key = en.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    let exampleEn = "";
    let example = "";
    if (after) {
      // 词组块结束后紧邻的 <p class="ex"> 属于该词组（契合度：例句字段精准归属）
      const exm = after.match(/<p class="ex">([\s\S]*?)<\/p>/i);
      if (exm) {
        exampleEn = exm[1]
          .replace(/<span class="zh">[\s\S]*?<\/span>/g, "")
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim();
        const ez = exm[1].match(/<span class="zh">([\s\S]*?)<\/span>/i);
        example = ez ? cleanHtml(ez[1]) : "";
      }
    }
    out.push({ en, zh: cleanHtml(zhRaw).trim(), exampleEn, example });
  };

  // ECD2 词组/短语块：<span class="ph">arrive at <ph></span> + 后续中文释义
  // 结构：扁平列表，每个 <span class="ph">PHRASE <ph></span> 紧跟其释义，随后是下一个 ph 块。
  // 关键：每条 ph 的释义【严格限定在本块结束 → 下一个 ph 块开始】之间，避免窗口式提取吞掉相邻块。
  if (/class=["']ph["']/.test(pre)) {
    const phRe = /<span\s+class=["']ph["'][^>]*>([\s\S]*?)<\/span>/gi;
    const phMatches = [...pre.matchAll(phRe)];
    for (let i = 0; i < phMatches.length && out.length < 60; i++) {
      const pm = phMatches[i];
      // 英文短语清洗：去掉变体注释 span(smb/sma) 的整段内容 + 其余所有标签，只留纯英文
      const enRaw = pm[1]
        .replace(/<span\s+class=["']?(?:smb|sma)["'][^>]*>[\s\S]*?<\/span>/gi, "")
        .replace(/<[^>]+>/g, "")
        .trim();
      if (!enRaw || enRaw.length < 2) continue;
      const en = cleanHtml(enRaw);
      const key = en.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // 释义区间：本 ph 块结束 → 下一个 ph 块开始（或文本末尾），杜绝跨块污染
      const start = pm.index + pm[0].length;
      const nextIdx = i + 1 < phMatches.length ? phMatches[i + 1].index : pre.length;
      const zhSlice = pre.slice(start, nextIdx);
      const zhClean = zhSlice
        .replace(/<span\s+class=["']?(?:xh|smb|sma|ea|eb|tz|lyb|cx|cxb|lbl|lbr|lal|lar|lya)["'][^>]*>[\s\S]*?<\/span>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      // 取第一个句号/分号前的部分作为释义，去除序号前缀
      let zh = zhClean.replace(/^\d+\.\s*/, "").trim();
      const semiIdx = zh.indexOf("；");
      if (semiIdx > 2) zh = zh.slice(0, semiIdx).trim();
      const dotIdx = zh.indexOf("。");
      if (dotIdx > 2 && dotIdx < semiIdx) zh = zh.slice(0, dotIdx).trim();
      out.push({ en, zh: cleanHtml(zh) });
    }
  }

  const blockRe = /<div class="(maybe_phrase|collocation)[^"]*">([\s\S]*?)<\/div>/g;
  let mm: RegExpExecArray | null;
  while ((mm = blockRe.exec(pre)) && out.length < 16) {
    const inner = mm[2];
    let en = "";
    const ph = inner.match(/<span class="(?:phrase_with_or|mphr_en to|mphr_en|phrase_sense)">([\s\S]*?)<\/span>/i);
    if (ph) en = ph[1].replace(/<[^>]+>/g, "");
    else en = inner.replace(/<span class="zh">[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, "");
    const zhm = inner.match(/<span class="zh">([\s\S]*?)<\/span>/i);
    // 例句窗口：块结束后的片段（覆盖块尾到下一块前）
    const tail = pre.slice(mm.index + mm[0].length, mm.index + mm[0].length + 800);
    add(en, zhm ? zhm[1] : "", tail);
  }

  const linkRe = /<a\s+href="entry:\/\/[^"]*">([\s\S]*?)<\/a>/g;
  while ((mm = linkRe.exec(pre)) && out.length < 24) {
    add(mm[1], "");
  }

  return out.slice(0, 24);
}

/**
 * 渲染词库单词卡——简洁模式（默认收起）。
 * 布局：词头(加粗) + 音标(斜体) 置顶；下方按词性分组，
 * 每组 = 「图标+文字」词性徽标 + 首个中文释义（有更多义项可点击展开）；
 * 底部为变形区块（动词过去式/过去分词/现在进行时，形副比较级/最高级，名词复数）。
 */
export function renderVocabCompactCard(
  word: string,
  phonetic: string,
  groups: PosSenseGroup[],
  mastery: number,
  wordId: string,
  inflections?: WordInflections,
  queryCount?: number
): string {
  const hasContent = groups.length > 0;
  let groupsHtml = "";
  if (hasContent) {
    const groupParts: string[] = [];
    groups.forEach((g, i) => {
      const expanded = i === 0;
      const hasMore = g.items.length > 1; // 是否有更多义项可展开（必须在 meaningText 之前）
      const first = g.items[0];
      // 仅当该词性组有多个义项时显示序号前缀 "1. 2. …"；单义项时不显示，避免无意义的"1."
      const meaningText = first ? ((hasMore && first.num) ? first.num + " " : "") + first.zh : "";
      const openClass = (expanded && hasMore) ? " hiword-vb-pos-open" : "";
      const collapsedClass = (expanded && hasMore) ? "" : " hiword-vb-pos-collapsed";
      // 词性标注：图标+文字徽标；有更多义项时渲染为可点击 toggle 按钮，否则静态徽标
      const posChip = g.pos
        ? (hasMore
          ? renderPosBadge(g.pos, { clickable: true, extraClass: openClass, title: "点击展开 / 收起该词性" })
          : renderPosBadge(g.pos))
        : '<span class="hiword-vb-pos-chip hiword-vb-pos-fallback">释义</span>';
      // 展开区只放「第 2 条起」的义项，避免与摘要行重复
      const senseItemsHtml = g.items.slice(1).map((s) => {
        const numSpan = s.num ? '<span class="hiword-vb-sense-num">' + escapeHtml(s.num) + "</span>" : "";
        return '<div class="hiword-vb-sense">' + numSpan + '<span class="hiword-vb-sense-zh">' + escapeHtml(s.zh) + "</span></div>";
      }).join("");
      // 仅在有更多义项时才渲染可折叠 body 容器
      const bodyHtml = hasMore
        ? ("<div class=\"hiword-vb-pos-body\">" + senseItemsHtml + "</div>")
        : "";
      groupParts.push(
        '<div class="hiword-vb-pos-block' + collapsedClass + '" data-pos-idx="' + i + '">' +
          '<div class="hiword-vb-pos-row">' +
            posChip +
            '<span class="hiword-vb-pos-meaning">' + escapeHtml(meaningText) + "</span>" +
          "</div>" +
          bodyHtml +
        "</div>"
      );
    });
    groupsHtml = groupParts.join("");
  } else {
    groupsHtml = '<div class="hiword-vb-empty-meaning">暂无释义</div>';
  }

  const inflHtml = renderInflectionsBlock(inflections);

  const qcountBadge =
    typeof queryCount === "number" && queryCount > 0
      ? '<span class="hiword-qcount" title="累计查询次数">' + escapeHtml(String(queryCount)) + " 次查询</span>"
      : "";

  return (
    '<div class="hiword-vb-card" data-word="' + escapeAttr(word) + '" data-id="' + escapeAttr(wordId) + '">' +
      '<div class="hiword-vb-card-head">' +
        // P1 语义化：词头 <strong>（=思源加粗）、音标 <em>（=思源斜体）
        '<strong class="hiword-vb-card-word">' + escapeHtml(word) + "</strong>" +
        (phonetic ? '<em class="hiword-vb-card-phon">' + escapeHtml(phonetic) + "</em>" : "") +
        qcountBadge +
      "</div>" +
      "<div class=\"hiword-vb-card-body\">" +
        groupsHtml +
        inflHtml +
      "</div>" +
    "</div>"
  );
}

/**
 * 渲染卡片内的「变形」区块。
 * 按词性展示对应变形（思源编辑器下划线格式 <u> 高亮词形）：
 *   - 动词：过去式 / 过去分词 / 现在进行时(-ing)
 *   - 形容词 / 副词：比较级 / 最高级
 *   - 名词：复数形式
 */
/** 词形变形区：把单个变形词渲染为可点击跳转链接（点击 → 查词窗口查询该词） */
function renderInflLink(w: string): string {
  if (!w) return "";
  return '<u class="hiword-vb-infl-link" data-action="dict-jump" data-word="' + escapeAttr(w) + '">' + escapeHtml(w) + "</u>";
}

export function renderInflectionsBlock(infl?: WordInflections): string {
  if (!infl) return "";
  const blocks: string[] = [];

  if (infl.verb) {
    const v = infl.verb;
    blocks.push(
      '<div class="hiword-vb-infl hiword-vb-infl-verb">' +
        '<span class="hiword-vb-infl-label">动词变形</span>' +
        '<span class="hiword-vb-infl-item"><b>过去式</b>' + renderInflLink(v.past) + "</span>" +
        '<span class="hiword-vb-infl-sep">·</span>' +
        '<span class="hiword-vb-infl-item"><b>过去分词</b>' + renderInflLink(v.pastParticiple) + "</span>" +
        '<span class="hiword-vb-infl-sep">·</span>' +
        '<span class="hiword-vb-infl-item"><b>现在进行时</b>' + renderInflLink(v.presentParticiple) + "</span>" +
      "</div>"
    );
  }
  if (infl.adjective) {
    const a = infl.adjective;
    blocks.push(
      '<div class="hiword-vb-infl hiword-vb-infl-grad">' +
        '<span class="hiword-vb-infl-label">形容词变形</span>' +
        '<span class="hiword-vb-infl-item"><b>比较级</b>' + renderInflLink(a.comparative) + "</span>" +
        '<span class="hiword-vb-infl-sep">·</span>' +
        '<span class="hiword-vb-infl-item"><b>最高级</b>' + renderInflLink(a.superlative) + "</span>" +
      "</div>"
    );
  }
  if (infl.adverb) {
    const adv = infl.adverb;
    blocks.push(
      '<div class="hiword-vb-infl hiword-vb-infl-grad">' +
        '<span class="hiword-vb-infl-label">副词变形</span>' +
        '<span class="hiword-vb-infl-item"><b>比较级</b>' + renderInflLink(adv.comparative) + "</span>" +
        '<span class="hiword-vb-infl-sep">·</span>' +
        '<span class="hiword-vb-infl-item"><b>最高级</b>' + renderInflLink(adv.superlative) + "</span>" +
      "</div>"
    );
  }
  if (infl.noun) {
    const n = infl.noun;
    blocks.push(
      '<div class="hiword-vb-infl hiword-vb-infl-noun">' +
        '<span class="hiword-vb-infl-label">名词复数</span>' +
        '<span class="hiword-vb-infl-item">' + renderInflLink(n.plural) + "</span>" +
      "</div>"
    );
  }

  if (blocks.length === 0) return "";
  return '<div class="hiword-vb-infl-wrap">' + blocks.join("") + "</div>";
}

/**
 * 渲染词库单词卡——详细模式（点击📖展开）。
 * 结构：词头(加粗+音标斜体+词性图标徽标)；
 * 主体为「意思/例句」与「词组/短语」双栏（空间不足时自动堆叠为单栏）：
 *   左栏：单词意思 · 例句（可独立折叠）
 *   右栏：词组 · 短语（若有，可独立折叠）
 */
export function renderVocabDetailCard(
  entry: ParsedEntry,
  mastery: number,
  wordId: string,
  inVocab: boolean
): string {
  const meaningBody = renderVocabDetailSenses(entry.definition) || '<div class="hiword-vb-detail-html">' + entry.html + "</div>";

  // 词头右侧词性徽标汇总（图标+文字，一眼看全词性；按归一化词性去重，v./vt./vi. 不再重复）
  const posGroups = extractSensesByPos(entry.definition, 1, 99, 90);
  const seenPos = new Set<string>();
  const posList: string[] = [];
  for (const g of posGroups) {
    if (!g.pos) continue;
    const key = normalizePos(g.pos);
    if (seenPos.has(key)) continue;
    seenPos.add(key);
    posList.push(g.pos);
  }
  const posSummary = posList.length
    ? '<span class="hiword-vb-card-pos-badges">' + posList.map((p) => renderPosBadge(p)).join("") + "</span>"
    : "";

  const phrases = extractPhrases(entry.definition);
  const phraseBody = phrases.length ? renderPhraseSection(phrases) : "";

  return (
    '<div class="hiword-vb-detail" data-word="' + escapeAttr(entry.word) + '" data-id="' + escapeAttr(wordId) + '">' +
      '<div class="hiword-vb-detail-head">' +
        // P1 语义化：词头 <strong>、音标 <em>；P5 词性图标徽标
        '<strong class="hiword-vb-detail-word">' + escapeHtml(entry.word) + "</strong>" +
        (entry.phonetic ? '<em class="hiword-vb-detail-phon">' + escapeHtml(entry.phonetic) + "</em>" : "") +
        posSummary +
        (entry.matchType === "inflection" ? '<span class="hiword-vb-badge">变形还原</span>' : "") +
        (entry.matchType === "similar" ? '<span class="hiword-vb-badge">相似词</span>' : "") +
      "</div>" +
      '<div class="hiword-vb-detail-cols">' +
        '<div class="hiword-vb-detail-col">' +
          '<div class="hiword-detail-section" data-section="sense">' +
            '<button type="button" class="hiword-detail-sec-head" data-action="toggle-section" title="展开 / 收起释义">' +
              '<span class="hiword-detail-sec-arrow">▾</span>单词意思 · 例句' +
            "</button>" +
            "<div class=\"hiword-detail-sec-body\">" + meaningBody + "</div>" +
          "</div>" +
        "</div>" +
        (phraseBody
          ? '<div class="hiword-vb-detail-col hiword-vb-detail-col-phrase">' + phraseBody + "</div>"
          : "") +
      "</div>" +
    "</div>"
  );
}

/**
 * 渲染「词组 · 短语」可折叠区块（词库详情卡与侧边查词卡共用）。
 * 无词组时返回空字符串（不渲染区块）。
 */
export function renderPhraseSection(phrases: PhraseItem[]): string {
  if (!phrases.length) return "";
  const items = phrases
    .map(
      (p) =>
        '<div class="hiword-detail-phrase">' +
          '<div class="hiword-detail-phrase-main">' +
            '<span class="hiword-detail-phrase-en">' + escapeHtml(p.en) + "</span>" +
            (p.zh ? '<span class="hiword-detail-phrase-zh">' + escapeHtml(p.zh) + "</span>" : "") +
          "</div>" +
          (p.exampleEn
            ? '<blockquote class="hiword-detail-phrase-ex" data-action="tts" data-text="' + escapeAttr(p.exampleEn) + '" title="点击朗读例句">' +
                '<span class="hiword-detail-phrase-ex-en">' + escapeHtml(p.exampleEn) + '<span class="hiword-tts-ico">🔊</span></span>' +
                (p.example ? '<span class="hiword-detail-phrase-ex-zh">' + escapeHtml(p.example) + "</span>" : "") +
              "</blockquote>"
            : "") +
        "</div>"
    )
    .join("");
  return (
    '<div class="hiword-detail-section" data-section="phrase">' +
      '<button type="button" class="hiword-detail-sec-head" data-action="toggle-section" title="展开 / 收起词组">' +
        '<span class="hiword-detail-sec-arrow">▾</span>词组 · 短语<span class="hiword-detail-sec-count">' + phrases.length + "</span>" +
      "</button>" +
      "<div class=\"hiword-detail-sec-body\">" + items + "</div>" +
    "</div>"
  );
}

/**
 * 渲染「纯词组词条」主卡（如 "to jockey for position" / "the anniversary of sth"）。
 * 词条整体就是一个词组：显示词组英文 + 中文 + 例句，替代退化的原始 HTML。
 */
export function renderPhraseEntryCard(definition: string): string {
  const p = extractPhraseEntry(definition);
  if (!p) return "";
  return (
    '<div class="hiword-dict-phrase-entry">' +
      '<div class="hiword-dict-phrase-entry-main">' +
        '<span class="hiword-dict-crossref-pos">phr.</span>' +
        '<span class="hiword-dict-phrase-entry-en">' + escapeHtml(p.en) + "</span>" +
        (p.zh ? '<span class="hiword-dict-phrase-entry-zh">' + escapeHtml(p.zh) + "</span>" : "") +
      "</div>" +
      (p.exampleEn
        ? '<div class="hiword-dict-sense-ex-row" data-action="tts" data-text="' + escapeAttr(p.exampleEn) + '" title="点击朗读例句">' +
            '<span class="hiword-dict-sense-en">' + escapeHtml(p.exampleEn) + '<span class="hiword-tts-ico">🔊</span></span>' +
            (p.example ? '<span class="hiword-dict-sense-ex-zh">' + escapeHtml(p.example) + "</span>" : "") +
          "</div>"
        : "") +
    "</div>"
  );
}

/**
 * 渲染「互见词条」主卡（如 tape slap = tape echo / geophilous = geophilic）。
 * 显示词性 + "= 目标词"，目标词可点击跳转查词。
 * resolvedZh：引擎层跟随目标词补回的中文释义（P1），词条本身无内联中文时展示。
 */
export function renderCrossrefEntryCard(definition: string, resolvedZh?: string): string {
  const c = extractCrossrefEntry(definition);
  if (!c) return "";
  const zh = c.zh || resolvedZh || "";
  return (
    '<div class="hiword-dict-crossref">' +
      (c.pos ? '<span class="hiword-dict-crossref-pos">' + escapeHtml(c.pos) + "</span>" : "") +
      '<span class="hiword-dict-crossref-eq">=</span>' +
      '<button type="button" class="hiword-dict-crossref-target" data-action="lookup-candidate" data-word="' + escapeAttr(c.target) + '">' + escapeHtml(c.target) + "</button>" +
      (zh ? '<span class="hiword-dict-crossref-zh">' + escapeHtml(zh) + "</span>" : "") +
    "</div>"
  );
}

/**
 * 解析新世纪英汉大词典的 HTML 释义
 */
export function parseDictEntry(entry: DictEntry): ParsedEntry {
  const { word, definition } = entry;

  // P2-2 多音标：NCECD 一个词条可能含多个 <pron>（如 /prəʊˈkræstɪˌneɪt; prə-/ 一个标签内含美/英变体，
  // 或偶发多标签），全部提取并去重后用 " / " 连接，避免只取第一个导致信息丢失。
  const pronMatches = [...definition.matchAll(/<pron[^>]*>([\s\S]*?)<\/pron>/gi)];
  const pronPhonetics = pronMatches
    .map((m) => stripHtmlTags(m[1]).replace(/\s+/g, " ").trim())
    .filter((s, i, arr) => s && arr.indexOf(s) === i);

  // ECD2 音标：<span class="tr">/ɪ'kspəʊz/<tr></span>（tr 是闭合标签非 HTML 标准，
  // 但 ECD2 数据如此；90% 词条自带此标签，比 phon_extra.json 兜底覆盖率高得多）
  const trMatches = [...definition.matchAll(/<span\s+class=["']?tr["']?[^>]*>([\s\S]*?)<(?:tr|\/span)>/gi)];
  const trPhonetics = trMatches
    .map((m) => stripHtmlTags(m[1]).replace(/\s+/g, " ").trim())
    .filter((s, i, arr) => s && arr.indexOf(s) === i && s.length > 2);

  const phonetic =
    (pronPhonetics.length ? pronPhonetics.join(" / ") : "") ||
    (trPhonetics.length ? trPhonetics.join(" / ") : "") ||
    // P3 外部音标补全：NCECD 人名/地名/专名词头无 <pron> 时，回退查询 phon_extra.json（CMU 数据）
    getExtraPhonetic(word);

  let cleanedHtml = definition
    .replace(/<link[^>]*>/gi, "")
    .replace(/<span class="header">/gi, '<span class="hiword-dict-headword">')
    .replace(/class="ncecd_con"/gi, 'class="hiword-dict-content"')
    .replace(/class="sense"/gi, 'class="hiword-dict-sense"')
    .replace(/class="ex"/gi, 'class="hiword-dict-example"')
    .replace(/class="zh"/gi, 'class="hiword-dict-zh"')
    .replace(/class="brief_ex"/gi, 'class="hiword-dict-brief"')
    .replace(/class="class"/gi, 'class="hiword-dict-pos"')
    .replace(/<pron([^>]*)>(.*?)<\/pron>/gi, '<span class="hiword-dict-phonetic"$1>$2</span>')
    // ECD2 内部标签清洗（这些标签泄漏进渲染 HTML 影响排版美观）
    // <tdd>: 例句中词头冗余包裹；<dss>/<ddd>: 内部结构；<ec>/<ed>: 内部标记
    .replace(/<(?:tdd|dss|ddd|ec|ed)[^>]*>[\s\S]*?<\/(?:tdd|dss|ddd|ec|ed)>/gi, "")
    // Z_* 类：entry:// 互见链接噪声（Z_POS_G / Z_REF / Z_Z / Z_POS 等）
    .replace(/<span\s+class="Z_[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "")
    // 残缺 <tr></tr>：<span class="tr">/.../<tr></span> 中的 <tr> 是 ECD2 自定义闭合标记，
    // 非 HTML 表格行；泄漏后浏览器按未知元素渲染为可见文本噪声
    .replace(/<\/?tr>/g, "");

  const plainText = htmlToPlainText(cleanedHtml);

  return {
    word,
    phonetic,
    html: cleanedHtml,
    definition,
    plainText,
    matchType: entry.matchType,
    originalWord: entry.originalWord,
    candidates: entry.candidates,
    resolvedZh: entry.resolvedZh,
  };
}

/**
 * 生成「查询结果下方」的三个语义/形态相近候选词。
 * 用途：用户查到的词性/含义理解有偏差时（如查 exposed 得形容词，实际需要动词），
 *       在结果下方给出可点击的相关词，点击即跳转查词。
 *
 * 选取策略（按优先级，最多 3 个，均以词典真实存在为前置校验）：
 *  1. 词形还原：用户实际输入的是某变形（entry.originalWord），先给出原形/原词；
 *  2. ECD2 派生词块：释义尾部 class="derivative" 内 originalform 标注的派生词；
 *  3. 规则形态族：对当前词做后缀剥离找词根、再按词根加常见后缀生成同族词，
 *     仅保留词典中真实存在的（如 exposed → expose / exposes / exposing）。
 */
export function generateRelatedWords(word: string, entry: ParsedEntry): string[] {
  const lw = (word || "").toLowerCase();
  const seen = new Set<string>([lw]);
  const pool: string[] = [];
  // 校验 + 入池（真实存在于词典、非当前词、未重复）
  const take = (w?: string): boolean => {
    if (!w) return false;
    const ww = w.trim().toLowerCase();
    if (ww.length < 2 || seen.has(ww) || ww === lw) return false;
    if (!dictHas(ww)) return false;
    seen.add(ww);
    return true;
  };

  // 策略1：变形还原 —— 用户实际查询的是某变形，给出原形/原词（最高优先）
  if (entry.originalWord && entry.originalWord.toLowerCase() !== lw && take(entry.originalWord)) {
    pool.push(entry.originalWord.toLowerCase());
  }

  // 策略3：规则形态族（最长有效词根优先，再补其同族派生）
  const fam = buildFamilyForms(word);
  const vBases = fam.bases.filter(take).sort((a, b) => b.length - a.length); // 最长词根最可能是真实词基
  const vDerived = fam.derived.filter(take).sort((a, b) => a.length - b.length);
  if (vBases.length) pool.push(vBases[0]); // 仅取一个最干净的词根
  for (const d of vDerived) {
    if (pool.length >= 3) break;
    pool.push(d);
  }

  // 策略2：ECD2 派生词块（class="derivative" 内 originalform="..." 标注的派生词）兜底填充
  const def = entry.definition || "";
  const derivMatches = def.match(/class="derivative"[\s\S]*?originalform="([^"]+)"/g) || [];
  for (const dm of derivMatches) {
    const m = dm.match(/originalform="([^"]+)"/);
    if (m && pool.length < 3 && take(m[1])) pool.push(m[1].toLowerCase());
  }

  return pool
    .slice(0, 3)
    .filter((w) => /^[a-z][a-z'’-]+$/.test(w));
}

/** 词典存在性校验：仅接受「精确词头」（快速 MDX 精确查找，无模糊/变形还原），避免臆造词混入选区 */
function dictHas(w: string): boolean {
  return hasExactHeadword(w);
}

/**
 * 基于规则生成当前词的「形态族」候选（不带词典校验）：
 * 先剥离常见后缀找词根（bases），再以各词根加常见后缀生成同族派生（derived）。
 */
function buildFamilyForms(word: string): { bases: string[]; derived: string[] } {
  const w = (word || "").toLowerCase();
  if (!w) return { bases: [], derived: [] };
  const bases = new Set<string>();
  const derived = new Set<string>();

  // 剥离后缀找词根（兼顾双写辅音：running → run）
  const strip = (suffix: string) => {
    if (w.endsWith(suffix) && w.length > suffix.length + 1) {
      bases.add(w.slice(0, w.length - suffix.length));
    }
  };
  const stripDouble = (suffix: string) => {
    if (w.endsWith(suffix) && w.length > suffix.length + 1) {
      const base = w.slice(0, w.length - suffix.length);
      bases.add(base);
      if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) {
        bases.add(base.slice(0, base.length - 1));
      }
    }
  };

  strip("ies"); // studies → stud（下方补 y）
  strip("ier"); // happier → happi（下方补 y）
  strip("iest");
  strip("ing");
  stripDouble("ing"); // running → run
  strip("ed");
  strip("d"); // exposed → expose（实际为 expose，最长词根优先）
  strip("es");
  if (!w.endsWith("ss")) strip("s");
  strip("ly");
  strip("ness");
  strip("ment");
  strip("ful");
  strip("less");
  strip("er");
  strip("est");
  strip("ion");
  strip("tion");
  strip("ation");

  // ies/ier → y 特例（studies → study，happier → happy）
  if (w.endsWith("ies") && w.length > 4) bases.add(w.slice(0, w.length - 3) + "y");
  if (w.endsWith("ier") && w.length > 4) bases.add(w.slice(0, w.length - 3) + "y");

  // 词根加常见后缀，生成同族派生候选
  const SUFS = ["s", "es", "ed", "ing", "ly", "er", "est", "ness", "ment", "ful", "less", "ion", "tion", "ation", "ity", "ive", "able", "al"];
  for (const b of bases) {
    if (b.length < 2) continue;
    for (const suf of SUFS) derived.add(b + suf);
  }

  bases.delete(w);
  derived.delete(w);
  return { bases: [...bases], derived: [...derived] };
}

/**
 * 渲染词条到 HTML（用于侧边栏面板）
 */
export function renderDictCard(
  entry: ParsedEntry,
  opts: { showStar?: boolean; inVocab?: boolean; queryCount?: number; preferredDefinitions?: string[] } = {}
): string {
  const inVocab = opts.inVocab ?? false;
  const starBtn = opts.showStar
    ? '<button class="hiword-dict-star ' + (inVocab ? "star-on" : "") + '" data-action="vocab-star" data-word="' + escapeAttr(entry.word) + '" title="' + (inVocab ? "移出词库" : "加入词库") + '">' + (inVocab ? "★" : "☆") + "</button>"
    : "";

  let badge = "";
  if (entry.matchType === "inflection" && entry.originalWord) {
    badge = '<div class="hiword-dict-badge hiword-dict-badge-inflection" title="原词「' + escapeAttr(entry.originalWord) + '」未收录，已还原为原形">' +
      '<span class="hiword-dict-badge-icon">🔄</span>' +
      '<span>变形还原：「' + escapeHtml(entry.originalWord) + "」→「" + escapeHtml(entry.word) + "」</span>" +
    "</div>";
  } else if (entry.matchType === "similar" && entry.originalWord) {
    const candidateHtml = (entry.candidates || [])
      .filter((c) => c !== entry.word)
      .slice(0, 4)
      .map((c) => '<span class="hiword-dict-candidate" data-action="lookup-candidate" data-word="' + escapeAttr(c) + '">' + escapeHtml(c) + "</span>")
      .join("");
    badge = '<div class="hiword-dict-badge hiword-dict-badge-similar" title="原词「' + escapeAttr(entry.originalWord) + '」未收录，以下为相似词">' +
      '<span class="hiword-dict-badge-icon">📌</span>' +
      '<span>此为相似单词（原词「' + escapeHtml(entry.originalWord) + "」未收录）</span>" +
      (candidateHtml ? "<div class=\"hiword-dict-candidates\">其他候选：" + candidateHtml + "</div>" : "") +
    "</div>";
  }

  // P1-2 义项不截断：默认折叠渲染 4 条；义项数 >4 时追加「查看全部 N 个义项」按钮 + 隐藏的全量列表
  // 初始列表包入 .hiword-dict-senses-initial 容器，展开全量时同步隐藏，避免重复显示
  // 2026-08-22 释义偏好：把 opts.preferredDefinitions 透传给所有 render 调用,命中 sense 加 ⭐
  const renderOpts = { preferredDefinitions: opts.preferredDefinitions };
  const allSenses = extractSenses(entry.definition, 99);
  const sensesHtml = renderSensesList(entry.definition, 4, renderOpts);
  const sensesInitialHtml = sensesHtml
    ? `<div class="hiword-dict-senses-initial">${sensesHtml}</div>`
    : "";
  const sensesMoreHtml =
    sensesHtml && allSenses.length > 4
      ? renderSensesMoreWithOpts(entry.definition, allSenses.length, renderOpts)
      : "";
  const phraseSection = renderPhraseSection(extractPhrases(entry.definition));

  // 契合度分诊：按词条内容结构选择主渲染路径（词组词条/互见条目不再退化为原始 HTML）
  const kind = detectEntryKind(entry.definition);
  let bodyHtml: string;
  if (sensesHtml) {
    bodyHtml = sensesInitialHtml + sensesMoreHtml + phraseSection;
  } else if (kind === "phrase") {
    bodyHtml = renderPhraseEntryCard(entry.definition) + phraseSection;
  } else if (kind === "crossref") {
    bodyHtml = renderCrossrefEntryCard(entry.definition, entry.resolvedZh);
  } else {
    bodyHtml = (entry.html || "") + phraseSection;
  }

  // B：查询结果下方展示「相关词汇」候选（点击 → 跳转查词窗口自动查询）
  const relatedWords = generateRelatedWords(entry.word, entry);
  const relatedHtml = relatedWords.length
    ? '<div class="hiword-dict-related">' +
        '<div class="hiword-dict-related-title">🔗 相关词汇</div>' +
        '<div class="hiword-dict-related-chips">' +
          relatedWords
            .map(
              (w) =>
                '<span class="hiword-dict-related-chip" data-action="dict-jump" data-word="' +
                escapeAttr(w) +
                '">' +
                escapeHtml(w) +
                "</span>"
            )
            .join("") +
        "</div>" +
      "</div>"
    : "";

  const qcountBadge =
    typeof opts.queryCount === "number" && opts.queryCount > 0
      ? '<span class="hiword-qcount" title="累计查询次数">' + escapeHtml(String(opts.queryCount)) + " 次查询</span>"
      : "";

  return (
    '<div class="hiword-dict-card" data-word="' + escapeAttr(entry.word) + '">' +
      badge +
      '<div class="hiword-dict-header">' +
        // P2：词头 <strong>、音标 <em>（类名修正为 .hiword-dict-phonetic，与既有 CSS 对齐）
        '<strong class="hiword-dict-word">' + escapeHtml(entry.word) + "</strong>" +
        (entry.phonetic ? '<em class="hiword-dict-phonetic">' + escapeHtml(entry.phonetic) + "</em>" : "") +
        qcountBadge +
        '<div class="hiword-dict-actions">' +
          starBtn +
          '<button class="b3-button b3-button--small" data-action="tts" data-word="' + escapeAttr(entry.word) + '">朗读</button>' +
        "</div>" +
      "</div>" +
      "<div class=\"hiword-dict-body\">" +
        bodyHtml +
        '<div class="hiword-dict-full-wrap">' +
          '<input type="checkbox" class="hiword-dict-expand-toggle" id="hiword-expand-' + escapeAttr(entry.word) + '" />' +
          '<label class="hiword-dict-expand-label" for="hiword-expand-' + escapeAttr(entry.word) + '">完整释义</label>' +
          '<div class="hiword-dict-full">' + entry.html + "</div>" +
        "</div>" +
        relatedHtml +
      "</div>" +
    "</div>"
  );
}

/**
 * 渲染"未找到"提示
 */
export function renderNotFound(word: string): string {
  return (
    '<div class="hiword-dict-notfound">' +
      '<div class="hiword-dict-notfound-icon">📖</div>' +
      '<p>未找到 "<strong>' + escapeHtml(word) + '</strong>" 的释义</p>' +
      '<p class="hiword-dict-hint">请检查拼写，或尝试使用前缀搜索</p>' +
    "</div>"
  );
}

/**
 * 渲染词库卡片内的「模糊候选」选择区
 */
export function renderVocabSuggestionBox(
  originalWord: string,
  candidates: string[],
  orig?: string
): string {
  const src = orig || originalWord;
  if (!candidates || candidates.length === 0) {
    return (
      '<div class="hiword-vb-suggest hiword-vb-suggest-empty">' +
        '<div class="hiword-vb-suggest-title">未收录「' + escapeHtml(originalWord) + '」，且无相近词</div>' +
        '<div class="hiword-vb-suggest-tip">可到侧边栏「词典」输入单词<strong>原型</strong>查询，或导入更多词典</div>' +
      "</div>"
    );
  }
  const chips = candidates
    .slice(0, 3)
    .map(
      (c) =>
        '<button class="hiword-vb-suggest-chip" data-action="lookup-candidate" data-word="' + escapeAttr(c) + '" data-orig="' + escapeAttr(src) + '">' + escapeHtml(c) + "</button>"
    )
    .join("");
  return (
    '<div class="hiword-vb-suggest">' +
      '<div class="hiword-vb-suggest-title">未找到「' + escapeHtml(originalWord) + '」，可能的拼写/原形：</div>' +
      '<div class="hiword-vb-suggest-chips">' + chips + "</div>" +
    "</div>"
  );
}

/**
 * 渲染侧边栏词典查询「未找到 + 候选」结果
 */
export function renderDictSuggestions(word: string, candidates: string[]): string {
  if (!candidates || candidates.length === 0) {
    return (
      '<div class="hiword-dict-notfound">' +
        '<div class="hiword-dict-notfound-icon">🔍</div>' +
        '<p>未找到 "<strong>' + escapeHtml(word) + '</strong>" 的释义</p>' +
        '<p class="hiword-dict-hint">词典中可能无此词。可在上方输入框手动输入单词<strong>原型</strong>查询，或导入更多词典</p>' +
      "</div>"
    );
  }
  const chips = candidates
    .slice(0, 3)
    .map(
      (c) =>
        '<span class="hiword-dict-candidate" data-action="lookup-candidate" data-word="' + escapeAttr(c) + '">' + escapeHtml(c) + "</span>"
    )
    .join("");
  return (
    '<div class="hiword-dict-notfound">' +
      '<div class="hiword-dict-notfound-icon">🔍</div>' +
      '<p>未找到 "<strong>' + escapeHtml(word) + '"，相近的单词：</p>' +
      '<div class="hiword-dict-candidates">' + chips + "</div>" +
      '<p class="hiword-dict-hint">若都不是，请在上方输入框输入单词<strong>原型</strong>查询</p>' +
    "</div>"
  );
}

/**
 * 渲染加载状态
 */
export function renderLoading(): string {
  return (
    '<div class="hiword-dict-loading">' +
      '<div class="hiword-dict-spinner"></div>' +
      "<p>词典加载中...</p>" +
    "</div>"
  );
}

/**
 * 渲染初始化提示（词典未加载）
 */
export function renderInitRequired(): string {
  return (
    '<div class="hiword-dict-init-required">' +
      "<p>词典数据尚未就绪</p>" +
      '<p class="hiword-dict-hint">请先在「词典管理」中导入词典（支持 .mdx / StarDict 格式）</p>' +
      '<button class="b3-button" id="hiword-dict-manage-btn">去导入词典</button>' +
    "</div>"
  );
}

// ========== 工具函数 ==========

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function htmlToPlainText(html: string): string {
  return stripHtmlTags(html)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// 折叠/展开词性区块的纯逻辑（独立模块，便于单元测试直接引用）
