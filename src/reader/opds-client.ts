/**
 * OPDS 在线书源客户端（B · 在线书源 / OPDS 搜书）
 * ------------------------------------------------------------------
 * 复用 SiYuan 内核代理 forwardProxy 拉取（CORS 安全）+ vendored foliate opds.js 解析。
 * 仅实现 OPDS 1.x（Atom XML）为主，附带 OPDS 2 JSON 最小解析分支。
 * 下载走 forwardProxy base64 → Blob → File，复用现有 store.importBook 导入流程。
 */

import { forwardProxyRaw } from "../siyuan/api";
// @ts-ignore - foliate vendor 为纯 JS，无类型声明（仅运行时 import）
import { getFeed, getOpenSearch, REL, SYMBOL } from "./vendor/foliate-js/opds.js";

const UA = "REword/1.4 (+SiYuan plugin)";

export interface OpdsLink {
  rel: string;
  href: string;
  type?: string;
  title?: string;
}

export interface OpdsEntry {
  kind: "publication" | "navigation";
  id?: string;
  title?: string;
  author?: string;
  summary?: string;
  cover?: string;
  /** publication：可下载链接 */
  download?: { href: string; type?: string };
  /** navigation：子目录地址 */
  href?: string;
}

export interface OpdsFeed {
  title?: string;
  entries: OpdsEntry[];
  /** 顶层 feed 链接（用于 OpenSearch 搜索检测） */
  links?: OpdsLink[];
}

export interface OpdsCatalog {
  id: string;
  name: string;
  url: string;
  /** Basic Auth：user:pass（可选） */
  auth?: string;
  /** 搜索 URL 模板，{q} 占位关键词 */
  searchTemplate?: string;
}

/** 内置公共书源（用户可增删，存本地） */
export const BUILTIN_CATALOGS: OpdsCatalog[] = [
  {
    id: "standardebooks",
    name: "Standard Ebooks",
    url: "https://standardebooks.org/opds/all",
    searchTemplate: "https://standardebooks.org/opds/search?query={q}",
  },
  {
    id: "gutenberg",
    name: "Project Gutenberg",
    url: "https://www.gutenberg.org/ebooks.opds",
  },
];

interface FetchResult {
  body: string;
  contentType: string;
}

async function fetchText(url: string, auth?: string): Promise<FetchResult> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept:
      "application/atom+xml, application/xml, text/xml, application/opds+json, application/json, */*",
  };
  if (auth) headers["Authorization"] = "Basic " + btoa(auth);
  const r = await forwardProxyRaw({
    url,
    method: "GET",
    responseEncoding: "text",
    headers,
    timeout: 60000,
  });
  if (r.code !== 0 || r.status >= 400) {
    throw new Error(`OPDS 拉取失败（HTTP ${r.status}）${r.msg ? "：" + r.msg : ""}`);
  }
  return {
    body: r.body,
    contentType: r.headers["content-type"] || r.headers["Content-Type"] || "application/xml",
  };
}

/** 取二进制为 base64（下载书籍 / 封面） */
async function fetchBase64(url: string, auth?: string): Promise<{ b64: string; type: string }> {
  const headers: Record<string, string> = { "User-Agent": UA };
  if (auth) headers["Authorization"] = "Basic " + btoa(auth);
  const r = await forwardProxyRaw({
    url,
    method: "GET",
    responseEncoding: "base64",
    headers,
    timeout: 120000,
  });
  if (r.code !== 0 || r.status >= 400) {
    throw new Error(`下载失败（HTTP ${r.status}）`);
  }
  return { b64: r.body, type: r.headers["content-type"] || r.headers["Content-Type"] || "" };
}

function parseXmlDoc(body: string): Document {
  const doc = new DOMParser().parseFromString(body, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("OPDS 返回不是合法 XML");
  return doc;
}

/** 从链接数组里挑一个最佳可下载链接（优先 epub，其次 pdf） */
function pickDownload(links: any[]): { href: string; type?: string } | undefined {
  if (!Array.isArray(links)) return undefined;
  const acq = links.filter((l) => {
    const rel = l.rel || "";
    if (!rel.startsWith(REL.ACQ) && rel !== "http://opds-spec.org/acquisition") return false;
    if (/buy|borrow|subscription|sample/i.test(rel)) return false;
    return true;
  });
  if (!acq.length) return undefined;
  const pref =
    acq.find((l) => /epub|kepub/i.test(l.type || "")) ||
    acq.find((l) => /pdf/i.test(l.type || "")) ||
    acq.find((l) => /mobi|azw|fb2|cbz/i.test(l.type || "")) ||
    acq[0];
  return { href: pref.href, type: pref.type };
}

function mapPublication(raw: any): OpdsEntry {
  const meta = raw.metadata || {};
  const links: any[] = raw.links || [];
  const coverLink = raw.images && raw.images[0] ? raw.images[0].href : undefined;
  const author = Array.isArray(meta.author)
    ? meta.author.map((a: any) => (typeof a === "string" ? a : a.name)).filter(Boolean).join(", ")
    : (typeof meta.author === "string" ? meta.author : meta.author?.name) || undefined;
  return {
    kind: "publication",
    id: meta.id,
    title: meta.title,
    author,
    summary: meta.summary || meta.subtitle,
    cover: coverLink,
    download: pickDownload(links),
  };
}

function mapNavigation(raw: any): OpdsEntry {
  // getFeed 对 navigation 直接把 link 对象当 item：带 href/type/title + SYMBOL.SUMMARY
  return {
    kind: "navigation",
    title: raw.title,
    summary: raw[SYMBOL.SUMMARY],
    href: raw.href,
  };
}

export async function fetchOpdsFeed(url: string, auth?: string): Promise<OpdsFeed> {
  const { body, contentType } = await fetchText(url, auth);
  if (/json/i.test(contentType) || body.trim().startsWith("{")) {
    try {
      const j = JSON.parse(body);
      const entries: OpdsEntry[] = [];
      for (const p of j.publications || []) {
        const links = (p.links || []).map((l: any) => ({ rel: l.rel, href: l.href, type: l.type }));
        entries.push({
          kind: "publication",
          title: p.metadata?.title,
          author: (p.metadata?.author || []).map((a: any) => a.name).join(", "),
          summary: p.metadata?.summary,
          cover: p.images?.[0]?.href,
          download: pickDownload(links),
        });
      }
      for (const n of j.navigation || []) {
        entries.push({ kind: "navigation", title: n.title, href: n.href });
      }
      return { title: j.metadata?.title, entries, links: j.links || [] };
    } catch {
      // 落到 XML 分支
    }
  }
  const doc = parseXmlDoc(body);
  const feed = getFeed(doc);
  const entries: OpdsEntry[] = [];
  for (const p of feed.publications || []) entries.push(mapPublication(p));
  for (const n of feed.navigation || []) entries.push(mapNavigation(n));
  return { title: feed.metadata?.title, entries, links: feed.links || [] };
}

/**
 * 搜索：优先用 catalog.searchTemplate；否则若当前 feed 含 OpenSearch 描述则解析后构造 URL。
 * 返回搜索结果 feed；无搜索能力时抛错。
 */
export async function searchOpds(
  catalog: OpdsCatalog,
  query: string,
  currentFeedLinks?: OpdsLink[]
): Promise<OpdsFeed> {
  const q = query.trim();
  if (!q) throw new Error("请输入关键词");
  if (catalog.searchTemplate) {
    const url = catalog.searchTemplate.replace("{q}", encodeURIComponent(q));
    return fetchOpdsFeed(url, catalog.auth);
  }
  // OpenSearch：在当前 feed 的 links 里找 search 描述
  const osLink = (currentFeedLinks || []).find(
    (l) => /opensearch/i.test(l.type || "") && /search/i.test(l.rel || "")
  );
  if (osLink?.href) {
    const { body } = await fetchText(osLink.href, catalog.auth);
    const doc = parseXmlDoc(body);
    const os = getOpenSearch(doc);
    const url = os.search(new Map([[undefined, new Map([["searchTerms", q]])]]));
    return fetchOpdsFeed(url, catalog.auth);
  }
  throw new Error("该书源未提供搜索，请用浏览");
}

/** 封面转 dataURL（经 forwardProxy 取二进制，规避 CORS/混合内容） */
export async function fetchImageDataUrl(url: string, auth?: string): Promise<string | null> {
  try {
    const { b64, type } = await fetchBase64(url, auth);
    if (!b64) return null;
    return `data:${type || "image/jpeg"};base64,${b64}`;
  } catch {
    return null;
  }
}

/** 下载书籍为 File（复用现有 importBook） */
export async function downloadAsFile(
  url: string,
  auth?: string,
  filenameHint?: string
): Promise<File> {
  const { b64, type } = await fetchBase64(url, auth);
  if (!b64) throw new Error("下载内容为空");
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: type || "application/octet-stream" });
  const ext = (type.match(/epub|pdf|mobi|azw|fb2|cbz/i)?.[0] || "epub").toLowerCase();
  const name = (filenameHint || "book").replace(/[\\/:*?"<>|]/g, "_");
  return new File([blob], `${name}.${ext}`, { type: type || "application/epub+zip" });
}
