import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { AnnEditor } from "../src/annotation/ann-editor.ts";

class FakeLute {
  constructor() {
    this.calls = [];
  }
  BlockDOM2Md(d) { this.calls.push(["BlockDOM2Md", d]); return d; }
  Md2BlockDOM(m) { this.calls.push(["Md2BlockDOM", m]); return m; }
  HTML2Md(h) { this.calls.push(["HTML2Md", h]); return h; }
  SetGFMTable(v) { this.calls.push(["SetGFMTable", v]); }
  SetGFMStrikethrough(v) { this.calls.push(["SetGFMStrikethrough", v]); }
  SetKramdownIAL(v) { this.calls.push(["SetKramdownIAL", v]); }
  SetBlockRef(v) { this.calls.push(["SetBlockRef", v]); }
  SetMark(v) { this.calls.push(["SetMark", v]); }
  SetTag(v) { this.calls.push(["SetTag", v]); }
  SetSup(v) { this.calls.push(["SetSup", v]); }
  SetSub(v) { this.calls.push(["SetSub", v]); }
  SetSuperBlock(v) { this.calls.push(["SetSuperBlock", v]); }
  SetCallout(v) { this.calls.push(["SetCallout", v]); }
}

const PH =
  '<div data-reword-placeholder="1" data-node-id="placeholder" data-type="NodeParagraph">' +
  '<div contenteditable="true">__TXT__</div></div>';

function makeEditor(wysiwygHTML) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
  const el = dom.window.document.getElementById("host");
  const editor = new AnnEditor(el, { app: {}, onEmptyChange() {} });
  const wysiwyg = dom.window.document.createElement("div");
  wysiwyg.innerHTML = wysiwygHTML;
  // 直接注入假 protyle，跳过 mount() 的 rAF / 尺寸 / SiYuan SDK 构造
  editor.protyle = {
    protyle: { wysiwyg: { element: wysiwyg }, lute: new FakeLute() },
    focus() {},
  };
  return editor;
}

test("新建空批注：占位段落为空 → read 返回空", () => {
  assert.equal(makeEditor(PH.replace("__TXT__", "<br>")).read(), "");
});

test("核心回归：用户在占位段落输入文字 → read 不误删", () => {
  const out = makeEditor(PH.replace("__TXT__", "啥事")).read();
  assert.ok(out.includes("啥事"), `应保留用户输入，实际：${out}`);
});

test("编辑已有批注：真实内容节点（无占位）→ read 正常", () => {
  const html = '<div data-type="NodeParagraph"><div contenteditable="true">既有批注</div></div>';
  assert.ok(makeEditor(html).read().includes("既有批注"));
});

test("占位段落含块引用 → 不被误删", () => {
  const html = PH.replace(
    "__TXT__",
    '<span data-type="block-ref" data-id="x">引用</span>'
  );
  const out = makeEditor(html).read();
  assert.ok(out.includes("block-ref"), `应保留块引用，实际：${out}`);
});

test("write() 对 Kramdown 表格开启 SetGFMTable 并补空行", () => {
  const note = "上文\n| 列1 | 列2 |\n| --- | --- |\n| a | b |\n下文";
  const editor = makeEditor("");
  editor.write(note);
  const lute = editor.protyle.protyle.lute;
  assert.ok(lute.calls.some(([n, v]) => n === "SetGFMTable" && v === true), "应调用 SetGFMTable(true)");
  const mdCall = lute.calls.find(([n]) => n === "Md2BlockDOM");
  assert.ok(mdCall, "应调用 Md2BlockDOM");
  const passedMd = mdCall[1];
  // 表格前应有空行
  const lines = passedMd.split("\n");
  const tableIdx = lines.findIndex((l) => /^\s*\| 列1/.test(l));
  assert.ok(tableIdx > 0 && lines[tableIdx - 1].trim() === "", "表格前应插入空行");
});

test("write() 对 HTML 表格先 HTML2Md 再开启表格能力", () => {
  const note = "<table><tr><th>A</th></tr><tr><td>1</td></tr></table>";
  const editor = makeEditor("");
  editor.write(note);
  const lute = editor.protyle.protyle.lute;
  assert.ok(lute.calls.some(([n]) => n === "HTML2Md"), "应先调用 HTML2Md");
  assert.ok(lute.calls.some(([n, v]) => n === "SetGFMTable" && v === true), "应调用 SetGFMTable(true)");
});

test("write() 对缺失 setter 的 Lute 实例容错", () => {
  const lute = {
    Md2BlockDOM(m) { return m; },
    HTML2Md(h) { return h; },
    // 无 SetGFMTable 等 setter
  };
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host2"></div></body></html>');
  const el = dom.window.document.getElementById("host2");
  const editor = new AnnEditor(el, { app: {}, onEmptyChange() {} });
  const wysiwyg = dom.window.document.createElement("div");
  editor.protyle = {
    protyle: { wysiwyg: { element: wysiwyg }, lute },
    focus() {},
  };
  // 不应抛错
  assert.doesNotThrow(() => editor.write("| a | b |\n|---|---|"));
});
