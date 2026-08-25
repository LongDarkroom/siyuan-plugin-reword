// 阅读器 - 字体收集 / 宿主栈测试（2026-08-23 增强跨文档字体继承）
// ----------------------------------------------------------------
// 用户反馈：选「跟随思源」后，书籍文本仍用系统字体（不是思源 LXGW WenKai）。
//
// 根因（旧实现）：
//   collectHostFontFaces() 只扫 document.styleSheets 中的 @font-face 规则。
//   思源「霞鹜文楷」等字体插件常用 `document.fonts.add(new FontFace(...))` 注册，
//   不生成 stylesheet 规则，导致扫描结果为空，iframe 内拿不到字体。
//
// 增强：
//   1. collectHostFontFaces(doc?) 同时扫 document.fonts（FontFaceSet），
//      为每个已注册 family 生成 local() fallback @font-face
//   2. getHostFontStack(doc?, computedStyle?) 增加 html 元素兜底（body 没设时取 html）
//   3. 返回前 trim 防止空格污染
//
// 测试用 stub document（不依赖 jsdom 因其 getComputedStyle 行为受限）。
// 不依赖：foliate / siyuan SDK

import { test } from "node:test";
import assert from "node:assert/strict";

/** 构造 stub document：可控 styleSheets / fonts / body+html fontFamily */
function mkDoc({ stylesheets = [], fonts = [], bodyFont = "", htmlFont = "", url = "http://localhost:6806/" } = {}) {
  return {
    baseURI: url,
    styleSheets: stylesheets.map((rules) => ({ cssRules: rules })),
    fonts: {
      forEach(cb) { fonts.forEach(f => cb({ family: f.family, status: f.status || "loaded" })); },
    },
    body: { _fontFamily: bodyFont },
    documentElement: { _fontFamily: htmlFont },
    defaultView: { CSSFontFaceRule: class CSSFontFaceRule {} },
  };
}

/** 兼容新版 reader-fonts.ts 的 getHostFontStack(doc?, computedStyle?) 签名 */
function getHostFontStackWithDoc(doc) {
  return import("../src/reader/reader-fonts.ts").then((fonts) =>
    fonts.getHostFontStack(doc, (el) => ({ fontFamily: el._fontFamily || "" }))
  );
}

function collectHostFontFacesWithDoc(doc) {
  return import("../src/reader/reader-fonts.ts").then((fonts) =>
    fonts.collectHostFontFaces(doc)
  );
}

test("collectHostFontFaces 空输入返回空数组", async () => {
  const doc = mkDoc();
  const out = await collectHostFontFacesWithDoc(doc);
  assert.ok(Array.isArray(out));
  assert.equal(out.length, 0, `expected empty, got ${JSON.stringify(out)}`);
});

test("collectHostFontFaces 扫 document.fonts：每个 family 生成 local() @font-face", async () => {
  const doc = mkDoc({
    fonts: [{ family: "LXGW WenKai" }, { family: "霞鹜文楷" }],
  });
  const out = await collectHostFontFacesWithDoc(doc);
  assert.equal(out.length, 2, `expected 2 local() @font-face, got ${out.length}: ${out.join("\n")}`);
  const lxgw = out.find(c => c.includes("LXGW WenKai") && c.includes("local"));
  assert.ok(lxgw, "should have LXGW WenKai @font-face with local()");
  assert.match(lxgw, /local\("LXGW WenKai"\)/);
  assert.match(lxgw, /local\("LXGWWenKai"\)/, "should also include no-space variant");
  const cn = out.find(c => c.includes("霞鹜文楷"));
  assert.ok(cn, "should have 霞鹜文楷 @font-face");
  assert.match(cn, /local\("霞鹜文楷"\)/);
});

test("collectHostFontFaces stylesheet 扫到 + document.fonts 扫到 → 合并去重", async () => {
  const doc = mkDoc({
    stylesheets: [
      [
        {
          constructor: { name: "CSSFontFaceRule" },
          cssText: '@font-face { font-family: "LXGW WenKai"; src: url("/fonts/lxgw.ttf") format("truetype"); }',
        },
      ],
    ],
    fonts: [{ family: "LXGW WenKai" }, { family: "OtherFont" }],
  });
  // 修复：构造 CSSFontFaceRule 实例
  const CSSFontFaceRule = doc.defaultView.CSSFontFaceRule;
  doc.styleSheets = [
    {
      cssRules: [
        Object.assign(new CSSFontFaceRule(), {
          cssText: '@font-face { font-family: "LXGW WenKai"; src: url("/fonts/lxgw.ttf") format("truetype"); }',
        }),
      ],
    },
  ];
  const out = await collectHostFontFacesWithDoc(doc);
  // 1 stylesheet + 1 fonts (LXGW 重复) + 1 fonts (OtherFont) = 3
  assert.equal(out.length, 3, `expected 3 unique entries, got ${out.length}: ${out.join("\n")}`);
  // 第一个应是 stylesheet 中的 @font-face（含 url()）
  assert.ok(out[0].includes("url("), "first entry should be the stylesheet @font-face");
  assert.ok(out[0].includes("LXGW WenKai"));
  // 应有 OtherFont 的 local() @font-face
  const other = out.find(c => c.includes("OtherFont"));
  assert.ok(other);
});

test("collectHostFontFaces document.fonts 无 forEach（旧浏览器）应安全跳过", async () => {
  const doc = mkDoc({});
  // 移除 fonts.forEach
  doc.fonts = {};
  const out = await collectHostFontFacesWithDoc(doc);
  assert.ok(Array.isArray(out));
  assert.equal(out.length, 0);
});

test("collectHostFontFaces document.fonts.forEach 抛错时安全跳过", async () => {
  const doc = mkDoc({});
  doc.fonts = {
    forEach() { throw new Error("simulated browser bug"); },
  };
  const out = await collectHostFontFacesWithDoc(doc);
  assert.ok(Array.isArray(out));
  assert.equal(out.length, 0);
});

test("getHostFontStack 从 body 取（含 trim）", async () => {
  const doc = mkDoc({ bodyFont: ' "LXGW WenKai", -apple-system, "PingFang SC" ' });
  const out = await getHostFontStackWithDoc(doc);
  assert.equal(out, '"LXGW WenKai", -apple-system, "PingFang SC"');
  assert.ok(!out.startsWith(" "), "should be trimmed");
});

test("getHostFontStack body 无 fontFamily 时从 html 兜底", async () => {
  const doc = mkDoc({ htmlFont: '"霞鹜文楷", serif' });
  const out = await getHostFontStackWithDoc(doc);
  assert.equal(out, '"霞鹜文楷", serif');
});

test("getHostFontStack body + html 都没设时返回空字符串", async () => {
  const doc = mkDoc();
  const out = await getHostFontStackWithDoc(doc);
  assert.equal(out, "");
});

test("getHostFontStack body 优先于 html（body 设了就用 body）", async () => {
  const doc = mkDoc({ bodyFont: '"BodyFont"', htmlFont: '"HtmlFont"' });
  const out = await getHostFontStackWithDoc(doc);
  assert.equal(out, '"BodyFont"');
});

test("[回归] 修复后 LXGW WenKai 能通过 local() 注入到 iframe", async () => {
  const doc = mkDoc({ fonts: [{ family: "LXGW WenKai" }] });
  const out = await collectHostFontFacesWithDoc(doc);
  const lxgw = out.find(c => c.includes('"LXGW WenKai"') && c.includes("local"));
  assert.ok(lxgw, `LXGW WenKai should be injected via local() @font-face, got: ${out.join("\n")}`);
  assert.ok(lxgw.endsWith(";") || lxgw.endsWith("}"), "should be valid CSS rule");
});

test("[回归] 修复后跨域 stylesheet（cssRules 抛错）安全跳过", async () => {
  const doc = mkDoc({});
  doc.styleSheets = [
    {
      get cssRules() { throw new Error("SecurityError: cross-origin stylesheet"); },
    },
  ];
  const out = await collectHostFontFacesWithDoc(doc);
  assert.ok(Array.isArray(out));
  // 跨域 stylesheet 跳过，不抛错
  assert.equal(out.length, 0);
});

test("[回归] 真实场景：思源 LXGW 插件用 document.fonts.add + body 设了 LXGW WenKai", async () => {
  // 模拟完整场景：思源笔记装了 LXGW 插件，body 用了 LXGW WenKai
  const doc = mkDoc({
    fonts: [{ family: "LXGW WenKai" }],
    bodyFont: '"LXGW WenKai", "PingFang SC", sans-serif',
  });
  const faces = await collectHostFontFacesWithDoc(doc);
  const stack = await getHostFontStackWithDoc(doc);
  // faces 应含 LXGW WenKai 的 local() @font-face
  const lxgw = faces.find(c => c.includes("LXGW WenKai"));
  assert.ok(lxgw);
  // stack 应含 LXGW WenKai
  assert.match(stack, /LXGW WenKai/);
  // 整体产出可被 foliate setStyles 消费
  const combined = faces.join("\n") + `\nbody { font-family: ${stack} !important; }`;
  assert.match(combined, /font-family: "LXGW WenKai", "PingFang SC", sans-serif !important/);
  assert.match(combined, /local\("LXGW WenKai"\)/);
});
