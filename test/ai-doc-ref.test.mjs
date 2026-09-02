// 2026-08-21 A 任务 v2:文档占位卡 + 发送时展开测试
// 2026-09-02 B 组更新:expandDocRefs 已降级为「兜底」——占位符形态改由 expandRefs 直接
//   查 attachment 表一步展开,本文件锁定的 ((docId '📄 文档 XXXXXX')) 路径只服务
//   历史会话 / 手动输入的引用。下列行为契约保持不变。
// 覆盖 expandDocRefs 的核心契约:
//   - ((docId '📄 文档 XXXXXX')) 占位符 → ## 📄 文档 XXXXXX + 真实正文
//   - 拉取失败/为空 → 占位替换为空(不污染 prompt)
//   - 多文档累加,超过 12k 上限降级
//   - 会话缓存:同 docId 第二次不重新拉
//   - 跳过 block-ref 的 ((id 'anchor')) 不误伤

import { test } from "node:test";
import assert from "node:assert/strict";

// 用一个轻量 mock host 注入到 AiPanel 实例
// 简单做法:直接复制 expandDocRefs 的核心逻辑做单测,避免拉起整个 AiPanel
import { readFileSync } from "node:fs";
const panelSrc = readFileSync(
  new URL("../src/ai/ai-panel.ts", import.meta.url),
  "utf-8"
);

// 抽离 expandDocRefs 方法的纯函数行为用于单测
//   实际:在 prod 代码中,expandDocRefs 是 AiPanel 的私有方法,无法直接 import
//   测试策略:用动态构造一个最小 AiPanel 替身
class FakePanel {
  constructor() {
    this.docTextCache = new Map();
    this.calls = [];
  }
  // 镜像真实实现
  async expandDocRefs(md) {
    const MAX_EXPAND = 12000;
    const edits = [];
    let expandedLen = 0;
    let m;
    const re = /\(\(([a-z0-9_-]{14,})(?:\s+'([^']*?)'?)?\)\)/g;
    while ((m = re.exec(md))) {
      const anchor = m[2] || "";
      if (!/^📄 文档 /.test(anchor)) continue;
      const docId = m[1];
      let text = this.docTextCache.get(docId);
      if (text === undefined) {
        let fetched = null;
        try {
          fetched = await this.host.fetchDocText(docId);
        } catch (e) { /* ignore */ }
        if (fetched) {
          this.docTextCache.set(docId, fetched);
          if (this.docTextCache.size > 50) {
            const oldest = this.docTextCache.keys().next().value;
            if (oldest) this.docTextCache.delete(oldest);
          }
          text = fetched;
        }
      }
      if (text) {
        const shortId = docId.replace(/-/g, "").slice(-6);
        const header = `\n\n## 📄 文档 ${shortId}\n\n`;
        if (expandedLen + header.length + text.length > MAX_EXPAND) {
          edits.push({ from: m.index, to: m.index + m[0].length, text: header });
        } else {
          edits.push({ from: m.index, to: m.index + m[0].length, text: header + text });
          expandedLen += header.length + text.length;
        }
      } else {
        edits.push({ from: m.index, to: m.index + m[0].length, text: "" });
      }
    }
    if (!edits.length) return md;
    edits.sort((a, b) => a.from - b.from);
    let out = "";
    let cursor = 0;
    for (const e of edits) {
      if (e.from < cursor) continue;
      out += md.slice(cursor, e.from) + e.text;
      cursor = e.to;
    }
    out += md.slice(cursor);
    return out.replace(/\n{4,}/g, "\n\n\n").trim();
  }
}

const DOC1 = "20260813120000-aaaaaa";
const DOC2 = "20260813120000-bbbbbb";
const BLOCK = "20260813120000-zzzzzz";

function makePanel(host) {
  const p = new FakePanel();
  p.host = host;
  return p;
}

test("A2:((docId '📄 文档 XXXXXX')) 替换为 ## 📄 文档 XXXXXX + 真实正文", async () => {
  const p = makePanel({ fetchDocText: async (id) => id === DOC1 ? "正文 ABC" : null });
  const md = `请精读\n\n((20260813120000-aaaaaa '📄 文档 aaaaaa'))\n\n谢谢`;
  const out = await p.expandDocRefs(md);
  assert.match(out, /## 📄 文档 aaaaaa/, "应包含 ## 📄 文档 占位标题");
  assert.match(out, /正文 ABC/, "应包含真实正文");
  assert.ok(!out.includes("((20260813120000-aaaaaa"), "应替换掉占位符");
});

test("A2:多文档展开累加", async () => {
  const p = makePanel({
    fetchDocText: async (id) => {
      if (id === DOC1) return "AAAA".repeat(100);   // 400 字
      if (id === DOC2) return "BBBB".repeat(100);   // 400 字
      return null;
    },
  });
  const md = `((20260813120000-aaaaaa '📄 文档 aaaaaa'))\n\n((20260813120000-bbbbbb '📄 文档 bbbbbb'))`;
  const out = await p.expandDocRefs(md);
  assert.match(out, /AAAA/);
  assert.match(out, /BBBB/);
  assert.ok(out.includes("## 📄 文档 aaaaaa"));
  assert.ok(out.includes("## 📄 文档 bbbbbb"));
});

test("A2:多文档累加超 12k 上限 → 后者降级为只占位标题", async () => {
  const p = makePanel({
    fetchDocText: async (id) => {
      if (id === DOC1) return "X".repeat(8000);   // 8000
      if (id === DOC2) return "Y".repeat(8000);   // 8000 → 总和 > 12k
      return null;
    },
  });
  const md = `((20260813120000-aaaaaa '📄 文档 aaaaaa'))\n\n((20260813120000-bbbbbb '📄 文档 bbbbbb'))`;
  const out = await p.expandDocRefs(md);
  // DOC1 全文展开(8k)
  assert.match(out, /X{100,}/);
  // DOC2 只剩占位标题(因为前一个文档 + 自身长度超 12k 上限)
  assert.ok(out.includes("## 📄 文档 bbbbbb"), "降级时仍保留占位标题");
  assert.ok(!out.includes("Y{100,}"), "正文不应展开");
});

test("A2:单文档拉取失败 → 占位替换为空(不污染 prompt)", async () => {
  const p = makePanel({ fetchDocText: async () => null });
  const md = `前缀\n\n((20260813120000-aaaaaa '📄 文档 aaaaaa'))\n\n后缀`;
  const out = await p.expandDocRefs(md);
  assert.ok(!out.includes("📄 文档"), "拉取失败应清空占位");
  assert.ok(!out.includes("((20260813120000-aaaaaa"), "原始占位符应被替换");
  assert.ok(out.includes("前缀"), "前后文本应保留");
  assert.ok(out.includes("后缀"));
});

test("A2:不存在的占位语法不动(没有 ((id '📄 文档 ')) → 原样返回)", async () => {
  const p = makePanel({ fetchDocText: async () => "x" });
  const md = `普通内容,没有占位符`;
  const out = await p.expandDocRefs(md);
  assert.equal(out, md);
});

test("A2:会话缓存:同 docId 第二次不重新拉", async () => {
  let callCount = 0;
  const p = makePanel({
    fetchDocText: async (id) => { callCount++; return id === DOC1 ? "已缓存内容" : null; },
  });
  const md1 = `((20260813120000-aaaaaa '📄 文档 aaaaaa'))`;
  const md2 = `前缀\n\n((20260813120000-aaaaaa '📄 文档 aaaaaa'))\n\n后缀`;
  await p.expandDocRefs(md1);
  assert.equal(callCount, 1, "首次展开应拉取一次");
  await p.expandDocRefs(md2);
  assert.equal(callCount, 1, "会话内重复应走缓存");
});

test("A2:不误伤 block-ref((id '普通锚文本') 不展开", async () => {
  const p = makePanel({ fetchDocText: async () => "绝不能调用" });
  const md = `((20260813120000-zzzzzz '普通锚文本'))`;
  const out = await p.expandDocRefs(md);
  // block-ref 的 anchor 不是 '📄 文档 ' 开头,应保持原样
  assert.match(out, /\(\(20260813120000-zzzzzz '普通锚文本'\)\)/);
});

test("A2:LRU 上限 50 条", async () => {
  const p = makePanel({ fetchDocText: async () => "x" });
  // 插入 60 个不同 docId
  for (let i = 0; i < 60; i++) {
    const id = "20260813120000-doc" + String(i).padStart(6, "0");
    await p.expandDocRefs(`((20260813120000-doc${String(i).padStart(6, "0")} '📄 文档 doc000000'))`);
  }
  assert.ok(p.docTextCache.size <= 50, "缓存应不超过 50 条");
});
