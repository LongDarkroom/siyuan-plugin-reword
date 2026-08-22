/**
 * StarDict 词典格式解析器
 *
 * 支持 StarDict 标准格式（.ifo / .idx / .dict 或 .dict.dz）：
 *   - .ifo：词典元信息（文本 key=value）
 *   - .idx：词表索引（二进制，每条 = 单词\0 + offset(4B) + size(4B)），已排序
 *   - .dict / .dict.dz：释义数据（纯文本或 gzip 压缩）
 *   - .syn（可选）：同义词索引
 *
 * 设计原则与 dict-engine.ts 的 MDX 直读对齐：
 *   - 构造时仅解析 .ifo 元信息 + .idx 索引常驻内存
 *   - 释义按需从 .dict/.dict.dz 读取，内存友好
 *   - 依赖 node:fs / node:zlib（SiYuan 桌面端 Electron 提供）
 */

import * as fs from "node:fs";
import * as zlib from "node:zlib";
import * as path from "node:path";
import { getLogger } from "../core/logger.ts";

/** .ifo 解析结果 */
export interface StarDictInfo {
  bookname: string;
  wordcount: number;
  idxfilesize: number;
  idxoffsetbits: number; // 32 或 64
  sametypesequence: string; // 释义编码类型串
  [key: string]: string | number;
}

/** .idx 中的一条索引记录 */
interface IdxEntry {
  word: string;
  offset: number;
  size: number;
}

/** StarDict 实例 —— 对外接口尽量与 js-mdict MDX 对齐 */
export class StarDict {
  private info: StarDictInfo;
  private idxEntries: IdxEntry[] = [];
  private dictPath: string;       // .dict 或 .dict.dz 路径
  private isCompressed: boolean;  // 是否为 .dict.dz
  private dictBuffer: Buffer | null = null; // 小文件一次性读入；大文件按需 seek

  constructor(ifoPath: string, idxPath?: string, dictPath?: string) {
    // 1) 解析 .ifo
    this.info = this.parseIfo(ifoPath);

    // 2) 推导伴生文件路径
    const base = ifoPath.replace(/\.ifo$/i, "");
    const resolvedIdx = idxPath || base + ".idx";
    const resolvedDict = dictPath || (fs.existsSync(base + ".dict.dz") ? base + ".dict.dz" : base + ".dict");

    this.dictPath = resolvedDict;
    this.isCompressed = /\.dict\.dz$/i.test(resolvedDict);

    // 3) 加载 .idx 索引
    this.loadIdx(resolvedIdx, this.info.idxoffsetbits === 64);
  }

  /** 词典名称 */
  get name(): string {
    return this.info.bookname || "StarDict";
  }

  /** 词表总数 */
  get count(): number {
    return this.idxEntries.length;
  }

  /** 词表列表（用于 UI 展示） */
  get keywordList(): string[] {
    return this.idxEntries.map((e) => e.word);
  }

  // ---- .ifo 解析 ----

  private parseIfo(filePath: string): StarDictInfo {
    const raw = fs.readFileSync(filePath, "utf-8");
    const info: Record<string, string | number> = {};
    // StarDict .ifo 格式：首行 "StarDict's dict ifo file"，后续 key=value 行
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("StarDict")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        const key = trimmed.substring(0, eq).trim().toLowerCase();
        let val: string | number = trimmed.substring(eq + 1).trim();
        // 数值字段自动转数字
        if (/^\d+$/.test(val)) val = parseInt(val, 10);
        info[key] = val;
      }
    }
    return info as unknown as StarDictInfo;
  }

  // ---- .idx 二进制加载 ----

  private loadIdx(filePath: string, is64bit: boolean) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`StarDict 索引文件不存在: ${filePath}`);
    }

    const buf = fs.readFileSync(filePath);
    // 验证文件大小与 ifo 声明的一致性（允许一定误差）
    const declaredSize = this.info.idxfilesize || buf.length;
    if (Math.abs(buf.length - declaredSize) > 4) {
      getLogger().warn(`[StarDict] .idx 大小(${buf.length})与 ifo 声明(${declaredSize})不一致，继续使用实际大小`);
    }

    const entrySize = is64bit ? 12 : 8; // 64bit: offset(8)+size(4); 32bit: offset(4)+size(4)
    const entries: IdxEntry[] = [];
    let pos = 0;

    while (pos < buf.length) {
      // 找单词字符串结尾的 \0
      const nullPos = buf.indexOf(0, pos);
      if (nullPos < pos || nullPos + entrySize > buf.length) break;

      const word = buf.toString("utf-8", pos, nullPos);
      const dataStart = nullPos + 1;

      let offset: number;
      let size: number;

      if (is64bit) {
        // 64-bit: offset 为 8 字节 little-endian
        const rawOffset = buf.readBigUInt64LE(dataStart);
        size = buf.readUInt32LE(dataStart + 8);
        // 转为 Number（大多数 StarDict 词库偏移在安全整数范围内）
        offset = Number(rawOffset);
      } else {
        offset = buf.readUInt32LE(dataStart);
        size = buf.readUInt32LE(dataStart + 4);
      }

      entries.push({ word, offset, size });
      pos = dataStart + entrySize;
    }

    this.idxEntries = entries;
    getLogger().info(`[StarDict] 索引加载完成: ${entries.length} 条 (${filePath})`);
  }

  // ---- .dict / .dict.dz 读取 ----

  /**
   * 读取指定偏移处的释义数据
   * @param offset .dict 文件内的字节偏移
   * @param size   释义数据长度
   * @returns 原始释义 Buffer
   */
  private readDefinition(offset: number, size: number): Buffer {
    if (!fs.existsSync(this.dictPath)) {
      throw new Error(`StarDict 释义文件不存在: ${this.dictPath}`);
    }

    if (this.isCompressed) {
      // .dict.dz 是 gzip 格式，需要解压后按偏移查找
      return this.readFromDz(offset, size);
    } else {
      // 普通 .dict 文件直接 seek+read
      const fd = fs.openSync(this.dictPath, "r");
      try {
        const buf = Buffer.alloc(size);
        fs.readSync(fd, buf, 0, size, offset);
        return buf;
      } finally {
        fs.closeSync(fd);
      }
    }
  }

  /**
   * 从 .dict.dz (gzip 压缩) 中读取指定块
   *
   * .dict.dz 结构：
   *   gzip 压缩流，解压后即完整的 .dict 内容。
   *   为避免每次查词都全量解压，首次调用时缓存解压后的完整 buffer。
   */
  private readFromDz(offset: number, size: number): Buffer {
    if (!this.dictBuffer) {
      // 首次：全量解压并缓存
      const compressed = fs.readFileSync(this.dictPath);
      try {
        this.dictBuffer = zlib.gunzipSync(compressed);
      } catch (e) {
        throw new Error(`StarDict .dict.dz 解压失败: ${e}`);
      }
    }

    if (offset + size > this.dictBuffer.length) {
      throw new Error(`StarDict 读取越界: offset=${offset}, size=${size}, fileSize=${this.dictBuffer.length}`);
    }

    return this.dictBuffer.subarray(offset, offset + size);
  }

  // ---- 查词接口（对齐 MDX） ----

  /**
   * 精确查词（大小写不敏感，二分查找）
   * @returns { keyText: string, definition: string } 或 null
   */
  lookup(word: string): { keyText: string; definition: string } | null {
    const clean = (word || "").trim().toLowerCase();
    if (!clean || this.idxEntries.length === 0) return null;

    // 二分查找（.idx 已排序）
    let lo = 0;
    let hi = this.idxEntries.length - 1;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const cmp = this.idxEntries[mid].word.localeCompare(clean, undefined, { sensitivity: "base" });

      if (cmp === 0) {
        // 精确命中
        return this.fetchEntry(this.idxEntries[mid]);
      } else if (cmp < 0) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return null;
  }

  /**
   * 大小写多形态尝试查词（兼容 MDX 接口的容错模式）
   */
  lookupFlexible(word: string): { keyText: string; definition: string } | null {
    const clean = (word || "").trim();
    if (!clean) return null;

    // 尝试多种形态
    const candidates = [
      clean,
      clean.toLowerCase(),
      clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase(),
      clean.toUpperCase(),
    ];

    for (const c of candidates) {
      const r = this.lookup(c);
      if (r) return r;
    }

    return null;
  }

  /**
   * 前缀搜索（用于联想补全）
   * @param prefix 前缀
   * @param limit  最大返回数
   * @returns 匹配词条数组 { keyText, definition? }
   */
  associate(prefix: string, limit: number = 20): { keyText: string }[] {
    const p = (prefix || "").trim().toLowerCase();
    if (!p) return [];

    const results: { keyText: string }[] = [];
    // .idx 已排序，找到前缀匹配区间
    const start = this.lowerBound(p);
    for (let i = start; i < this.idxEntries.length && results.length < limit; i++) {
      if (!this.idxEntries[i].word.toLowerCase().startsWith(p)) break;
      results.push({ keyText: this.idxEntries[i].word });
    }
    return results;
  }

  /**
   * 子串模糊搜索
   * @param query  搜索词
   * @param limit  最大返回数
   * @returns 匹配词条数组
   */
  contains(query: string, caseSensitive: boolean = false, limit: number = 50): { keyText: string }[] {
    const q = (query || "").trim();
    if (!q) return [];

    const searchQ = caseSensitive ? q : q.toLowerCase();
    const results: { keyText: string }[] = [];

    for (const entry of this.idxEntries) {
      const w = caseSensitive ? entry.word : entry.word.toLowerCase();
      if (w.includes(searchQ)) {
        results.push({ keyText: entry.word });
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  // ---- 内部方法 ----

  /**
   * 根据 idx 条目读取并解析释义
   */
  private fetchEntry(entry: IdxEntry): { keyText: string; definition: string } | null {
    try {
      const raw = this.readDefinition(entry.offset, entry.size);
      const definition = this.decodeDefinition(raw);
      return { keyText: entry.word, definition };
    } catch (e) {
      getLogger().warn("[StarDict] 读取「${entry.word}」释义失败:", { error: e });
      return null;
    }
  }

  /**
   * 解码原始释义数据
   *
   * StarDict sametypesequence 定义了编码方式：
   *   'm' = 纯文本
   *   'h' = HTML
   *   'x' = xdx (xdxf) XML
   *   'y' = yinbu (deprecated)
   *   'g' = Pango markup
   *   't' = transcription (pronunciation)
   *   'r' = resource (file reference)
   *   'W' = Wadoku audio
   *   'P' = picture/data (base64-encoded length-prefixed)
   *   'X' = unknown length-prefixed
   *
   * 若未声明 sametypesequence，则默认每条以 \0 结尾的纯文本。
   */
  private decodeDefinition(raw: Buffer): string {
    const seq = this.info.sametypesequence || "";

    if (!seq) {
      // 无 sametypesequence：默认纯文本，以 \0 结尾
      let text = raw.toString("utf-8");
      // 去掉末尾 \0
      if (text.endsWith("\0")) text = text.slice(0, -1);
      return this.escapeHtml(text);
    }

    // 按 sametypesequence 逐段解码
    const parts: string[] = [];
    let pos = 0;

    for (const type of seq) {
      if (pos >= raw.length) break;

      switch (type) {
        case "m": {
          // 纯文本：以 \0 结尾
          const end = raw.indexOf(0, pos);
          const text = end >= 0 ? raw.toString("utf-8", pos, end) : raw.toString("utf-8", pos);
          parts.push(this.escapeHtml(text));
          pos = end >= 0 ? end + 1 : raw.length;
          break;
        }
        case "h": {
          // HTML：以 \0 结尾
          const end = raw.indexOf(0, pos);
          const html = end >= 0 ? raw.toString("utf-8", pos, end) : raw.toString("utf-8", pos);
          parts.push(html); // HTML 不 escape
          pos = end >= 0 ? end + 1 : raw.length;
          break;
        }
        case "x": {
          // xdxf XML：以 \0 结尾
          const end = raw.indexOf(0, pos);
          const xml = end >= 0 ? raw.toString("utf-8", pos, end) : raw.toString("utf-8", pos);
          parts.push(this.convertXdxfToHtml(xml));
          pos = end >= 0 ? end + 1 : raw.length;
          break;
        }
        case "g": {
          // Pango markup → 简单 HTML
          const end = raw.indexOf(0, pos);
          const pango = end >= 0 ? raw.toString("utf-8", pos, end) : raw.toString("utf-8", pos);
          parts.push(this.pangoToHtml(pango));
          pos = end >= 0 ? end + 1 : raw.length;
          break;
        }
        case "t": {
          // 音标（通常很短）
          const end = raw.indexOf(0, pos);
          const text = end >= 0 ? raw.toString("utf-8", pos, end) : raw.toString("utf-8", pos);
          parts.push(`<span class="hiword-phonetic">${this.escapeHtml(text)}</span>`);
          pos = end >= 0 ? end + 1 : raw.length;
          break;
        }
        case "P":
        case "X":
        case "W":
        case "r": {
          // 长度前缀数据：4 字节长度 + 数据
          if (pos + 4 > raw.length) break;
          const len = raw.readUInt32BE(pos);
          pos += 4;
          if (pos + len > raw.length) break;
          if (type === "r") {
            // 资源引用（跳过或显示文件名）
            const ref = raw.toString("utf-8", pos, pos + len);
            parts.push(`<span class="hiword-resource">[资源: ${this.escapeHtml(ref)}]</span>`);
          }
          // P/X/W 类型数据跳过（图片/音频等无法在面板展示）
          pos += len;
          break;
        }
        default: {
          // 未知类型：尝试当作 \0 结尾文本
          const end = raw.indexOf(0, pos);
          const text = end >= 0 ? raw.toString("utf-8", pos, end) : raw.toString("utf-8", pos);
          parts.push(this.escapeHtml(text));
          pos = end >= 0 ? end + 1 : raw.length;
          break;
        }
      }
    }

    return parts.join("<br/>");
  }

  /** 二分下界：找到第一个 >= target 的位置 */
  private lowerBound(target: string): number {
    let lo = 0;
    let hi = this.idxEntries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.idxEntries[mid].word.localeCompare(target, undefined, { sensitivity: "base" }) < 0) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  // ---- 工具方法 ----

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * 简单 xdxf → HTML 转换
   * xdxf 是 StarDict 的 XML 释义格式，常见标签：
   *   <def> <cit> <k> <opt> <sr> <abr> <ex> <pos> etc.
   */
  private convertXdxfToHtml(xml: string): string {
    // 简化处理：去掉 xdxf 命名空间和外围标签，保留内容
    let html = xml
      .replace(/<[^>]*:/g, "<") // 去命名空间前缀
      .replace(/xmlns(:\w+)?="[^"]*"/g, "") // 去 xmlns
      .replace(/<\/?ar>/gi, "") // 去外围 ar 标签
      .replace(/<\/?k>/gi, "") // 去关键词标签（已有独立字段）
      .replace(/<\/?def>/gi, "")
      .replace(/<\/?cit>/gi, "<i>") // 引用斜体
      .replace(/<\/\/cit>/gi, "</i>");

    // 安全起见，只保留少量标签
    html = html.replace(/<(?!\/?(i|b|br|sup|sub|span)\b)[^>]*>/g, "");
    return html;
  }

  /**
   * Pango markup → 简单 HTML
   * Pango 常用标签：b, i, big, small, sup, sub, u, span (with fgcolor/bgcolor attributes)
   */
  private pangoToHtml(pango: string): string {
    return pango
      .replace(/<b>/gi, "<strong>")
      .replace(/<\/b>/gi, "</strong>")
      .replace(/<i>/gi, "<em>")
      .replace(/<\/i>/gi, "</em>")
      .replace(/<big>/gi, '<span style="font-size:larger">')
      .replace(/<\/big>/gi, "</span>")
      .replace(/<small>/gi, '<span style="font-size:smaller">')
      .replace(/<\/small>/gi, "</span>")
      .replace(/<sup>/gi, "<sup>")
      .replace(/<\/sup>/gi, "</sup>")
      .replace(/<sub>/gi, "<sub>")
      .replace(/<\/sub>/gi, "</sub>")
      .replace(/ fgcolor="[^"]*"/gi, "")
      .replace(/ bgcolor="[^"]*"/gi, "")
      .replace(/<u>/gi, "<u>")
      .replace(/<\/u>/gi, "</u>");
  }

  // ---- 资源管理 ----

  /** 关闭 / 释放资源 */
  close(): void {
    this.dictBuffer = null; // 释放解压缓存
    this.idxEntries = [];   // 释放索引
    getLogger().info("[StarDict] 资源已释放");
  }
}
