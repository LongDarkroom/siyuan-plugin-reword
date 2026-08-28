import { logSwallow } from "../core/safe.ts";
/**
 * 阅读器 - 字体管理
 * ---------------------------------------------------------------
 * 两种来源：
 * 1. 「跟随思源」：扫描宿主页面的 @font-face（CSSFontFaceRule，src 转绝对 URL）
 *    + 取 document.body 计算后的字体栈，一并注入阅读器 iframe；
 *    思源主题/字体插件换字体，阅读器自动跟随。
 * 2. 「自定义导入」：用户上传 ttf/otf/woff/woff2，存 /data/plugins/<name>/fonts/，
 *    注册表持久化 hiword-reader-fonts.json；生成 @font-face 注入。
 */

import { putFile, getFileBlob, removeFile } from "../siyuan/api";
import { writable } from "svelte/store";

export interface CustomFont {
  id: string;
  /** font-family 名（文件名去扩展名） */
  name: string;
  /** 思源 data 内路径 */
  path: string;
  /** ttf / otf / woff / woff2 */
  ext: string;
  size: number;
  addedAt: number;
}

const FONTS_KEY = "hiword-reader-fonts.json";
const FONTS_DIR = (pluginName: string) => `/data/plugins/${pluginName}/fonts`;

export class FontStore {
  private fonts: CustomFont[] = [];
  private loaded = false;
  /** 内部 Svelte store：让消费者可订阅字体列表变化（导入/删除后自动刷新） */
  private _store = writable<CustomFont[]>([]);
  // 显式字段声明（避免 constructor parameter property，Node 24 strip-types 不支持）
  private plugin: any;

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  /** 实现 Svelte store 契约：返回退订函数 */
  subscribe(run: (value: CustomFont[]) => void, invalidate?: (value?: CustomFont[]) => void): () => void {
    return this._store.subscribe(run, invalidate as any);
  }

  get list(): CustomFont[] {
    return [...this.fonts].sort((a, b) => b.addedAt - a.addedAt);
  }

  get(id: string): CustomFont | undefined {
    return this.fonts.find((f) => f.id === id);
  }

  async load(): Promise<void> {
    if (this.loaded) {
      this._store.set([...this.fonts]);
      return;
    }
    try {
      const data = await this.plugin.loadData(FONTS_KEY);
      if (Array.isArray(data)) this.fonts = data;
    } catch {
      this.fonts = [];
    }
    this.loaded = true;
    this._store.set([...this.fonts]);
  }

  private async save(): Promise<void> {
    try {
      await this.plugin.saveData(FONTS_KEY, this.fonts);
    } catch (e) {
      console.warn("[REword] 字体注册表持久化失败:", e);
    }
  }

  /** 导入自定义字体文件 */
  async importFont(file: File): Promise<CustomFont> {
    await this.load();
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "ttf").toLowerCase();
    if (!["ttf", "otf", "woff", "woff2"].includes(ext)) {
      throw new Error("仅支持 ttf / otf / woff / woff2 字体文件");
    }
    const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const path = `${FONTS_DIR(this.plugin.name)}/${id}.${ext}`;
    const ok = await putFile(path, false, file);
    if (!ok) throw new Error("字体文件上传失败");
    const font: CustomFont = {
      id,
      name: file.name.replace(/\.(ttf|otf|woff|woff2)$/i, "") || file.name,
      path,
      ext,
      size: file.size,
      addedAt: Date.now(),
    };
    this.fonts.push(font);
    await this.save();
    this._store.set([...this.fonts]);
    return font;
  }

  /** 删除自定义字体（文件 + 注册） */
  async removeFont(id: string): Promise<void> {
    await this.load();
    const font = this.get(id);
    if (font) {
      try {
        await removeFile(font.path);
      } catch (__swallowErr) { logSwallow(__swallowErr, "reader-fonts.ts · removeFont", "warn"); }
      this.fonts = this.fonts.filter((f) => f.id !== id);
      await this.save();
      this._store.set([...this.fonts]);
    }
  }
}

/** src 的 format 提示（用于 @font-face 注入） */
export function fontFormat(ext: string): string {
  return ext === "ttf" ? "truetype" : ext === "otf" ? "opentype" : ext;
}

/**
 * 扫描宿主页面的全部 @font-face 规则 + 已注册到 document.fonts 的 FontFace
 * - 跨域 stylesheet 读取 cssRules 会抛 SecurityError → 跳过
 * - 相对 URL 基于 document.baseURI 转绝对（iframe 内无法解析相对路径）
 * - 2026-08-23 增强：思源「霞鹜文楷」等字体插件常通过 `document.fonts.add(new FontFace(...))`
 *   注册字体（不生成 stylesheet 规则），旧实现扫不到。现在同时扫 document.fonts，
 *   为每个已注册 family 生成 local() fallback @font-face，让本机已装字体可继承。
 *   即使宿主进程注入的字体文件本身跨进程拿不到，至少 local() 命中的本机字体可用。
 *
 * 接受可选 doc 参数：测试用 jsdom 注入，生产用全局 document。
 */
export function collectHostFontFaces(doc?: Document): string[] {
  const d = doc ?? (typeof document !== "undefined" ? document : undefined);
  if (!d) return [];
  const out: string[] = [];
  const base = d.baseURI;
  // 1) 扫 stylesheets 中的 @font-face 规则
  try {
    for (const sheet of Array.from(d.styleSheets)) {
      let rules: CSSRuleList | null = null;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // 跨域 stylesheet
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof (d.defaultView as any).CSSFontFaceRule)) continue;
        let css = rule.cssText;
        css = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_m, q: string, urlStr: string) => {
          const u = urlStr.trim();
          if (/^(data:|blob:|https?:|\/)/i.test(u)) return `url(${q}${u}${q})`;
          try {
            return `url(${q}${new URL(u, base).href}${q})`;
          } catch {
            return _m;
          }
        });
        if (css && !out.includes(css)) out.push(css);
      }
    }
  } catch (__swallowErr) { logSwallow(__swallowErr, "reader-fonts.ts · collectHostFontFaces", "debug"); }
  // 2) 扫 document.fonts 已注册 FontFace（思源字体插件常用 API）
  //    拿到每个 family，注入 local() fallback @font-face
  //    - 命中本机已装字体 → 立即可用
  //    - 命中跨进程已加载字体 → 在多数浏览器也可用（同源继承）
  try {
    const seen = new Set<string>();
    const fonts: any = (d as any).fonts;
    if (fonts && typeof fonts.forEach === "function") {
      fonts.forEach((face: any) => {
        const family = face?.family;
        if (!family || typeof family !== "string") return;
        if (seen.has(family)) return;
        seen.add(family);
        // 多个 local() 候选：用户可能装的是 "LXGW WenKai" 或 "LXGWWenKai-Regular" 或 "霞鹜文楷"
        const css =
          `@font-face{font-family:"${family}";` +
          `src:local("${family}"),local("${family.replace(/\s+/g, "")}");` +
          `font-display:swap;}`;
        if (!out.includes(css)) out.push(css);
      });
    }
  } catch (__swallowErr) { logSwallow(__swallowErr, "reader-fonts.ts · try { const seen = new Set<string>(); const fonts: any = (d as …", "debug"); }
  return out;
}

/**
 * 宿主当前正文字体栈（已解析的计算值，如 -apple-system, "PingFang SC", ...）
 * 2026-08-23 问题 2 修复：
 * - **优先读思源文档字体变量 --b3-font-family**（霞鹜文楷等字体插件就挂在这个变量上，
 *   作用于文档正文而非 body 全局）→ 读 CSS 变量，再读 body / html 计算字体兜底。
 * 接受可选 doc + computedStyle 参数（测试可注入 mock）。
 */
export function getHostFontStack(
  doc?: Document,
  computedStyle?: (el: Element) => CSSStyleDeclaration
): string {
  const d = doc ?? (typeof document !== "undefined" ? document : undefined);
  if (!d) return "";
  const cs = computedStyle ?? ((el: Element) => getComputedStyle(el));
  // 1) 思源文档字体变量（霞鹜文楷等挂在此）
  try {
    const cssVar = cs(d.documentElement).getPropertyValue("--b3-font-family");
    if (cssVar && cssVar.trim()) return cssVar.trim();
  } catch (__swallowErr) { logSwallow(__swallowErr, "reader-fonts.ts · getHostFontStack", "debug"); }
  // 2) body 计算字体
  try {
    const body = cs(d.body).fontFamily;
    if (body) return body.trim();
  } catch (__swallowErr) { logSwallow(__swallowErr, "reader-fonts.ts · getHostFontStack", "debug"); }
  // 3) html 计算字体（兜底）
  try {
    const html = cs(d.documentElement).fontFamily;
    if (html) return html.trim();
  } catch (__swallowErr) { logSwallow(__swallowErr, "reader-fonts.ts · getHostFontStack", "debug"); }
  return "";
}

/**
 * 从宿主 @font-face 规则中提取字体文件 src URL（带 family 名）。
 * 2026-08-23 问题 2 修复核心：
 * - 霞鹜文楷等网页字体的 `@font-face` src 是字体文件 URL（网络/CDN/插件本地资源）。
 * - foliate iframe 跨文档拿不到这些文件，`local()` 又不命中（网页字体未装系统）。
 * - 解法：把 URL 提取出来 → 宿主 fetch → blob → 注入 iframe 的 @font-face（blob 同源可加载）。
 * 返回去重的 { url, family } 列表（http(s)/相对路径可 fetch；data:/blob: 已可直接加载，跳过）。
 */
export function collectHostFontUrls(doc?: Document): { url: string; family: string }[] {
  const d = doc ?? (typeof document !== "undefined" ? document : undefined);
  if (!d) return [];
  const out: { url: string; family: string }[] = [];
  const base = d.baseURI;
  try {
    for (const sheet of Array.from(d.styleSheets)) {
      let rules: CSSRuleList | null = null;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // 跨域 stylesheet
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof (d.defaultView as any).CSSFontFaceRule)) continue;
        const css = rule.cssText || "";
        const m = css.match(/url\(\s*(['"]?)([^'")]+)\1\s*\)/);
        if (!m) continue;
        const u = m[2].trim();
        if (/^(data:|blob:)/i.test(u)) continue; // 已可直接加载，无需 fetch
        const fam = css.match(/font-family:\s*(['"]?)([^'";]+)\1/i)?.[2].trim() ?? "";
        if (!fam) continue;
        let abs: string;
        try {
          abs = /^https?:/i.test(u) ? u : new URL(u, base).href;
        } catch {
          continue;
        }
        if (!out.some((x) => x.url === abs)) out.push({ url: abs, family: fam });
      }
    }
  } catch (__swallowErr) { logSwallow(__swallowErr, "reader-fonts.ts · stFontUrls", "debug"); }
  return out;
}

/** 自定义字体 → @font-face CSS（blob URL 由调用方提供） */
export function customFontFaceCss(font: CustomFont, blobUrl: string): string {
  const format = fontFormat(font.ext);
  return `@font-face{font-family:"${font.name}";src:url("${blobUrl}") format("${format}");font-display:swap;}`;
}
