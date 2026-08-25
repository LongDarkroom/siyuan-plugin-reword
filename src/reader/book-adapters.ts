/**
 * 阅读器 - TXT / Markdown 纯文本适配器
 * ---------------------------------------------------------------
 * foliate-js 原生支持 EPUB/MOBI/FB2/CBZ/PDF，但不支持 TXT/MD。
 * 本模块实现 foliate 的 book 接口（sections/metadata/resolveHref），
 * 把纯文本按章节切片成 HTML 文档，供 <foliate-view> 分页渲染。
 *
 * 安全性：所有动态文本先 escapeHtml 再格式替换，无 XSS 风险。
 * 阅读排版（字号/行距/主题）由 reader-settings 在渲染后注入，本节只给最小可读样式。
 */

import { escapeHtml } from "../core/markdown";
// 编码探测/解码已抽到 text-encoding.ts（book-adapters 与 foliate view-light 共用）
import { decodeText, detectTextEncoding } from "./text-encoding";
export { detectTextEncoding, decodeText } from "./text-encoding";

/** 每节最大字符数（避免单节 DOM 过大拖慢分页） */
const MAX_CHUNK = 24000;

/**
 * 判定一行是否为章节标题（TXT 小说通用）
 * 兼容：第一章 / 第 1 章 / 第X回·卷·节·篇·部 / Chapter 1 / Chapter I
 * 兼容标题后跟分隔符 + 标题文字（第一章：初入江湖 / 第一章 初入江湖）
 *
 * 返回 { label: toc 用的标题, text: 整行原文本（渲染进正文） } 或 null
 * 防误判：整行 ≤ 60 字符才算标题（正文长句以"第X章"开头的不算）
 */
function matchChapterHeading(line: string): { label: string; text: string } | null {
  const t = line.trim();
  if (!t || t.length > 60) return null;
  const m =
    t.match(/^(第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章回卷节篇部集])(.*)$/) ||
    t.match(/^([Cc]hapter\s+[0-9ivxlcdm]+)(.*)$/);
  if (!m) return null;
  const head = m[1].replace(/\s+/g, "");
  const rest = m[2].trim();
  // 标题文字：分隔符（：:、. -）之后的内容，截前 24 字符避免 toc 过长
  const titleText = rest
    .replace(/^[：:、.\-—\s]+/, "")
    .replace(/[。！？.;!?，,]+$/, "")
    .slice(0, 24);
  return {
    label: titleText ? `${head} ${titleText}` : head,
    text: t,
  };
}

/** 是否为阅读器支持的纯文本格式 */
export function isTextBookFile(name: string): boolean {
  return /\.(txt|md|markdown)$/i.test(name);
}

/** 是否支持的文件（含 foliate 原生格式） */
export function isSupportedBookFile(name: string): boolean {
  return isTextBookFile(name) || /\.(epub|mobi|azw3|fb2|cbz)$/i.test(name);
}

// 编码探测/解码见 ./text-encoding（此处统一 re-export，保持对外接口）

/** 按段落边界切片，保证每节 ≤ maxChars（单段超长则硬切） */
function splitChunks(text: string, max = MAX_CHUNK): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    if (buf && buf.length + trimmed.length + 2 > max) {
      chunks.push(buf);
      buf = "";
    }
    // 超长段落硬切
    let rest = trimmed;
    while (rest.length > max) {
      chunks.push(rest.slice(0, max));
      rest = rest.slice(max);
    }
    buf = buf ? buf + "\n\n" + rest : rest;
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [""];
}

/** 行内格式（输入为已 escape 文本） */
function inlineFormat(t: string): string {
  return t
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_w, text: string, url: string) => {
      const safe = /^(https?:|mailto:|#)/i.test(url) ? url : "";
      return safe ? `<a href="${safe}">${text}</a>` : text;
    });
}

/** 最小 Markdown → HTML（仅标题/段落/列表/引用/代码/分割线/行内格式） */
function mdToHtml(src: string): string {
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let inQuote = false;
  let quoteBuf: string[] = [];
  let listType: "" | "ul" | "ol" = "";
  let listBuf: string[] = [];

  const flushList = () => {
    if (listType && listBuf.length) {
      out.push(`<${listType}>${listBuf.map((x) => `<li>${x}</li>`).join("")}</${listType}>`);
    }
    listType = "";
    listBuf = [];
  };
  const flushQuote = () => {
    if (inQuote && quoteBuf.length) {
      out.push(`<blockquote>${quoteBuf.map((x) => `<p>${x}</p>`).join("")}</blockquote>`);
    }
    inQuote = false;
    quoteBuf = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    // 代码块
    if (/^```/.test(line.trim())) {
      if (inCode) {
        out.push(`<pre><code>${codeBuf.map((x) => escapeHtml(x)).join("\n")}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushList();
        flushQuote();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    const t = line.trim();
    if (!t) {
      flushList();
      flushQuote();
      continue;
    }
    // 引用
    const qm = t.match(/^&gt;\s?(.*)$/) || t.match(/^>\s?(.*)$/);
    if (qm) {
      flushList();
      if (!inQuote) {
        inQuote = true;
        quoteBuf = [];
      }
      quoteBuf.push(inlineFormat(escapeHtml(qm[1])));
      continue;
    }
    flushQuote();
    // 标题
    const hm = t.match(/^(#{1,4})\s+(.*)$/);
    if (hm) {
      flushList();
      const lvl = hm[1].length;
      out.push(`<h${lvl}>${inlineFormat(escapeHtml(hm[2]))}</h${lvl}>`);
      continue;
    }
    // 分割线
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      flushList();
      out.push("<hr>");
      continue;
    }
    // 无序列表
    const um = t.match(/^[-*]\s+(.*)$/);
    if (um) {
      if (listType !== "ul") {
        flushList();
        listType = "ul";
      }
      listBuf.push(inlineFormat(escapeHtml(um[1])));
      continue;
    }
    // 有序列表
    const om = t.match(/^\d+[.)]\s+(.*)$/);
    if (om) {
      if (listType !== "ol") {
        flushList();
        listType = "ol";
      }
      listBuf.push(inlineFormat(escapeHtml(om[1])));
      continue;
    }
    flushList();
    out.push(`<p>${inlineFormat(escapeHtml(t))}</p>`);
  }
  flushList();
  flushQuote();
  if (inCode && codeBuf.length) {
    out.push(`<pre><code>${codeBuf.map((x) => escapeHtml(x)).join("\n")}</code></pre>`);
  }
  return out.join("\n");
}

/** 纯文本 → HTML（段落 + 换行） */
function txtToHtml(src: string): string {
  return src
    .split(/\n{2,}/)
    .map((p) => {
      const t = p.trim();
      if (!t) return "";
      return `<p>${escapeHtml(t).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

/** 组装完整 HTML 文档（分页渲染需要完整 document） */
function docHtml(body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; padding: 2em 1.5em; line-height: 1.7; word-break: break-word; overflow-wrap: break-word; }
  p { margin: 0 0 0.9em; text-indent: 0; }
  h1, h2, h3, h4 { margin: 1.2em 0 0.5em; line-height: 1.35; }
  h1 { font-size: 1.5em; } h2 { font-size: 1.3em; } h3 { font-size: 1.15em; } h4 { font-size: 1.05em; }
  pre { background: rgba(128,128,128,.12); padding: .8em 1em; border-radius: 6px; overflow-x: auto; font-size: .92em; }
  code { background: rgba(128,128,128,.15); padding: .1em .3em; border-radius: 4px; font-size: .92em; }
  pre code { background: none; padding: 0; }
  blockquote { margin: .6em 0; padding: .2em 1em; border-left: 3px solid rgba(128,128,128,.5); opacity: .9; }
  ul, ol { margin: .4em 0 .8em; padding-left: 1.6em; }
  li { margin: .2em 0; }
  img { max-width: 100%; height: auto; }
  a { color: #378ADD; }
  hr { border: none; border-top: 1px solid rgba(128,128,128,.4); margin: 1.4em 0; }
</style>
</head>
<body>${body}</body>
</html>`;
}

/**
 * 按行扫描，识别章节标题行。
 * - TXT：匹配「第X章/回/卷」或 Chapter N（matchChapterHeading）
 * - MD：额外匹配 Markdown 标题行（# 一级标题，作为章节锚点）
 * 返回 [{ line: 行号, label, text }]（text 为标题行原文本，渲染进正文）
 */
function detectChapters(text: string, isMD: boolean): { line: number; label: string; text: string }[] {
  const lines = text.split(/\r?\n/);
  const out: { line: number; label: string; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const hit = matchChapterHeading(lines[i]);
    if (hit) {
      out.push({ line: i, label: hit.label, text: hit.text });
      continue;
    }
    // MD 一级标题：# 标题（不含二级及以下，避免 toc 过深）
    if (isMD && /^#{1}\s+\S/.test(line)) {
      const label = line.replace(/^#\s+/, "").trim().slice(0, 24);
      out.push({ line: i, label, text: line });
    }
  }
  return out;
}

/**
 * 按章节边界切片：以标题行（含标题行本身）为章节起点，下一标题行前为章节内容。
 * 章内超长（> MAX_CHUNK）再子切片，避免单章 DOM 过大。
 * 返回 [{ heading?: {label,text}, chunks: string[] }]
 */
function splitByChapters(
  text: string,
  chapters: { line: number; label: string; text: string }[]
): { heading?: { label: string; text: string }; chunks: string[] }[] {
  const lines = text.split(/\r?\n/);
  if (!chapters.length) {
    // 无章节标题：全文按段落硬切（原行为）
    return [{ heading: undefined, chunks: splitChunks(text) }];
  }
  const out: { heading?: { label: string; text: string }; chunks: string[] }[] = [];
  for (let ci = 0; ci < chapters.length; ci++) {
    const ch = chapters[ci];
    const start = ch.line;
    const end = ci + 1 < chapters.length ? chapters[ci + 1].line : lines.length;
    const bodyLines = lines.slice(start + 1, end);
    // 去除首尾空行
    while (bodyLines.length && !bodyLines[0].trim()) bodyLines.shift();
    while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();
    if (bodyLines.length) {
      out.push({
        heading: { label: ch.label, text: ch.text },
        chunks: splitChunks(bodyLines.join("\n")),
      });
    }
  }
  return out.length ? out : [{ heading: undefined, chunks: splitChunks(text) }];
}

/**
 * 章节正文 → HTML 标题 + 正文。
 * TXT：标题行渲染 <h1>，正文走 txtToHtml；
 * MD：标题行渲染 <h1>（MD 的 # 标题在 mdToHtml 里已处理，但章节识别出的行统一加 <h1>）。
 */
function chapterBodyHtml(heading: { label: string; text: string } | undefined, body: string, isMD: boolean): string {
  const bodyHtml = isMD ? mdToHtml(body) : txtToHtml(body);
  if (!heading) return bodyHtml;
  const titleHtml = `<h1>${escapeHtml(heading.text)}</h1>`;
  return bodyHtml ? `${titleHtml}\n${bodyHtml}` : titleHtml;
}

/** 构建纯文本 book（foliate book 接口）；自动检测编码（UTF-8/GBK/UTF-16）+ 章节识别 */
export async function makeTextBook(file: File, title?: string): Promise<any> {
  const raw = new Uint8Array(await file.arrayBuffer());
  const text = decodeText(raw);
  const isMD = /\.md$|\.markdown$/i.test(file.name);
  const chapters = detectChapters(text, isMD);
  const parts = splitByChapters(text, chapters);
  const toc: { label: string; href: string }[] = [];
  const sections: any[] = [];
  let secIndex = 0;
  for (const part of parts) {
    const secStart = secIndex;
    for (const chunk of part.chunks) {
      const i = secIndex++;
      const bodyHtml = chapterBodyHtml(part.heading, chunk, isMD);
      let url: string | null = null;
      sections.push({
        load: async () => {
          if (!url) {
            const html = docHtml(bodyHtml);
            url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
          }
          return url;
        },
        unload: () => {
          if (url) {
            URL.revokeObjectURL(url);
            url = null;
          }
        },
        createDocument: async () => {
          const html = docHtml(bodyHtml);
          return new DOMParser().parseFromString(html, "text/html");
        },
        size: chunk.length,
        linear: "yes",
      });
      if (part.heading && i === secStart) {
        // 章节首节挂 toc：label + href（foliate 用 href 定位 section）
        toc.push({ label: part.heading.label, href: `section-${i}` });
      }
    }
  }
  const baseName = title || file.name.replace(/\.(txt|md|markdown)$/i, "");
  return {
    sections,
    metadata: {
      title: baseName,
      language: undefined,
      author: undefined,
    },
    toc,
    resolveHref: (href: string) => {
      const m = href && href.match(/^section-(\d+)$/);
      const idx = m ? Number(m[1]) : -1;
      if (idx < 0 || idx >= sections.length) return null;
      const s = sections[idx];
      // foliate 契约：{ index, href, anchor? }；anchor 缺省时 paginator 定位到 section 开头
      return { index: idx, href: `section-${idx}`, anchor: undefined, total: s.size || 0 };
    },
    isExternal: () => false,
  };
}
