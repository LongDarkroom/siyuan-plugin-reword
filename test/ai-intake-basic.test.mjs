// 2026-09-08 基础链路验证：从「拖入块」到「AI 收到正文」的 B 组数据层
//
// 目标：
//   ① 验证普通段落块拖入后 AI 能读到完整正文 —— 基础链路（拖入→fetchBlockText→登记→展开）是否通；
//   ② 用证据锁定「标题块只取到标题那一行、下属内容丢失」= 真机「AI 读不到内容」的根因，
//      范围选择（标题块含下属内容）留待下一步实现，本文件只验证与取证，不改逻辑。
//
// 说明：DOM 插入（protyle.insert / Lute 序列化）不影响 attachments 数据层，
// 故用 registerRef 注入「insertBlockRef 预取到的正文」来等价模拟拖入的登记动作，
// 聚焦「正文能否进 attachments 并被 expandRefs 展开」这一数据核心（与现有 panel 测试同范式）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { AiPanel } from "../src/ai/ai-panel.ts";
import { refPlaceholderOf } from "../src/ai/ai-refs.ts";

const PARA_ID = "20260813120000-pppppp"; // 普通段落块
const HEAD_ID = "20260813120000-hhhhhh"; // 四级标题块

// host：模拟真实 fetchBlockText（单块 kramdown 形态）
//  - 段落块 → 完整段落正文（getBlockKramdown 对段落块返回整段）
//  - 标题块 → 仅标题那一行（标题下属的段落/列表是独立块，getBlockKramdown 取不到）
function makeHost() {
  const blockBodies = {
    [PARA_ID]: "这是一段普通段落。它包含完整的句子，AI 应当能读到这整段内容。",
    [HEAD_ID]: "#### 我的小节标题", // 标题块 kramdown 仅此一行，下属块不在其中
  };
  const base = {
    fetchBlockText: async (id) => blockBodies[id] ?? null,
    fetchDocText: async () => null,
  };
  return new Proxy(base, {
    get(t, p) { return p in t ? t[p] : () => null; },
  });
}

// 等价 insertBlockRef 的「预取正文 + 登记」核心：先 fetchBlockText 再 registerRef
async function registerDragged(panel, host, id) {
  const body = await host.fetchBlockText(id);
  panel.registerRef({
    kind: "block",
    id,
    title: id.slice(-6),
    body: body || undefined,
    status: body ? "ready" : "failed",
  });
}

test("基础链路：普通段落块拖入 → AI 收到完整正文（占位符被消费、正文入消息）", async () => {
  const host = makeHost();
  const panel = new AiPanel(host);
  await registerDragged(panel, host, PARA_ID);
  const out = await panel.expandRefs(`请翻译：${refPlaceholderOf(PARA_ID)}`);
  assert.match(out, /这是一段普通段落。它包含完整的句子/, "基础链路：段落正文必须进入 AI 消息");
  assert.ok(!out.includes("@@REWORD_REF_"), "占位符必须被消费掉");
});

test("范围问题取证：标题块拖入 → AI 只收到标题行（下属内容丢失 = 当前根因）", async () => {
  const host = makeHost();
  const panel = new AiPanel(host);
  await registerDragged(panel, host, HEAD_ID);
  const out = await panel.expandRefs(`请总结：${refPlaceholderOf(HEAD_ID)}`);
  assert.match(out, /我的小节标题/, "标题本身应进入消息");
  // 证据：标题块 kramdown 不含下属段落，展开的只有标题行 —— 这正是「读不到内容」的来源
  assert.equal(
    out.includes("这是一段普通段落"),
    false,
    "标题块下属内容当前未进入正文（范围缺陷，待标题块范围选择实现）"
  );
});

test("序列化阶段不丢预取正文：readInputValue 的 registerRef 合并保留 body", async () => {
  // 复现真实双登记：拖入预取带 body，序列化时 readInputValue 仅带 anchor（无 body）
  const host = makeHost();
  const panel = new AiPanel(host);
  panel.registerRef({ kind: "block", id: PARA_ID, title: "预览前六字", body: "这是一段普通段落。它包含完整的句子，AI 应当能读到这整段内容。", status: "ready" });
  // 序列化阶段只带 anchor（模拟 readInputValue 的 registerRef 调用形态）
  panel.registerRef({ kind: "block", id: PARA_ID, title: "新锚文本" });
  const out = await panel.expandRefs(refPlaceholderOf(PARA_ID));
  assert.match(out, /这是一段普通段落。它包含完整的句子/, "序列化兜底不得清空预取正文");
});
