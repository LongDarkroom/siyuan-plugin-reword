/**
 * AI 对话面板消息工具栏 + 保存到笔记对话框 单测（2026-08-18 新增）。
 * 验证：
 *  - 用户消息工具栏 = 复制 MD / 复制 TXT / 保存 / 编辑 4 个按钮（无重试）
 *  - AI 消息工具栏 = 上述 4 个 + 重试（共 5 个）
 *  - 各按钮 data-act 钩子正确
 *  - 保存到笔记对话框字段完整（文档名 / 笔记本 / 路径 / 文档树容器 / 保存后打开开关 / 确定取消）
 *  - 文档树递归渲染（含子节点折叠、空目录降级）
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  renderMessageToolbar,
  renderSaveToNoteDialog,
  renderSaveToNoteTree,
} from "../src/ai/ai-dialogs.ts";

test("用户消息工具栏：4 个按钮，不含重试", () => {
  const html = renderMessageToolbar("user");
  // 工具栏容器与角色钩子
  assert.match(html, /class="hiword-ai-msg-toolbar"/, "应有工具栏容器");
  assert.match(html, /data-role="user"/, "应标记 data-role=user");
  // 4 个动作按钮
  const acts = [...html.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    acts.sort(),
    ["copy-md", "copy-txt", "edit", "save-note"].sort(),
    "user 工具栏应只有 复制MD/复制TXT/保存/编辑 四个动作"
  );
  assert.ok(!acts.includes("retry"), "user 消息不应有重试按钮");
});

test("AI 消息工具栏：5 个按钮，含重试", () => {
  const html = renderMessageToolbar("assistant");
  assert.match(html, /data-role="assistant"/, "应标记 data-role=assistant");
  const acts = [...html.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    acts.sort(),
    ["copy-md", "copy-txt", "edit", "retry", "save-note"].sort(),
    "assistant 工具栏应含 复制MD/复制TXT/保存/编辑/重试 五个动作"
  );
  // 2026-09-03：图标统一为自解释图形，↻ 改为 🔄（与 💾 / ✏️ 同一套 emoji 表意）
  assert.match(html, /data-act="retry"[\s\S]*?>🔄/, "重试按钮图标应为 🔄");
});

test("保存到笔记对话框：字段完整", () => {
  const html = renderSaveToNoteDialog({
    notebooks: [
      { id: "nb1", name: "笔记本一" },
      { id: "nb2", name: "笔记本二" },
    ],
    defaultName: "我的精读",
    defaultPath: "/2026",
  });
  // titlebar
  assert.match(html, /保存到笔记/, "应有标题「保存到笔记」");
  // 文档名 / 笔记本 / 路径 三个输入
  assert.match(html, /data-field="title"/, "应有文档名输入");
  assert.match(html, /data-field="notebook"/, "应有笔记本下拉");
  assert.match(html, /data-field="path"/, "应有路径输入");
  // 文档树容器
  assert.match(html, /data-field="tree"/, "应有文档树容器");
  // 保存后打开开关（默认勾选）
  assert.match(html, /data-field="openAfterSave"[^>]*checked/, "保存后打开开关默认勾选");
  // 确定 / 取消
  assert.match(html, /data-act="confirm"/, "应有确定按钮");
  assert.match(html, /data-act="cancel"/, "应有取消按钮");
  // 笔记本下拉含两个选项
  const opts = [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(opts.includes("nb1") && opts.includes("nb2"), "笔记本下拉应含两个笔记本选项");
  // 预填值
  assert.match(html, /value="我的精读"/, "应预填文档名");
  assert.match(html, /value="\/2026"/, "应预填路径");
});

test("保存到笔记对话框：无笔记本时降级", () => {
  const html = renderSaveToNoteDialog({ notebooks: [] });
  assert.match(html, /暂无笔记本/, "无笔记本应显示降级选项文案");
});

test("文档树渲染：节点含折叠箭头 + 名称 + data-path 钩子", () => {
  const html = renderSaveToNoteTree([
    { id: "d1", name: "第一章", path: "/第一章" },
    { id: "d2", name: "第二章", path: "/第二章" },
  ]);
  assert.match(html, /data-path="\/第一章"/, "节点应带 data-path");
  assert.match(html, /data-id="d1"/, "节点应带 data-id");
  assert.match(html, /hiword-ai-savenote-name">第一章/, "应显示节点名称");
  // 无 children 的叶子节点显示「·」而非箭头
  assert.match(html, />·</, "叶子节点应显示点缀符 ·");
});

test("文档树渲染：含子节点时默认折叠", () => {
  const html = renderSaveToNoteTree([
    {
      id: "p", name: "父文档", path: "/父",
      children: [{ id: "c", name: "子文档", path: "/父/子" }],
    },
  ], 0);
  assert.match(html, /has-children/, "含子节点应加 has-children 类");
  // 子节点容器默认隐藏
  assert.match(html, /hiword-ai-savenote-children" style="display:none"/, "子节点容器默认 display:none");
  // 父节点显示展开箭头 ▸
  assert.match(html, /hiword-ai-savenote-toggle">▸/, "父节点应显示展开箭头 ▸");
  // 递归渲染出子节点名称
  assert.match(html, /hiword-ai-savenote-name">子文档/, "应递归渲染子节点名称");
});

test("文档树渲染：空目录降级提示", () => {
  const html = renderSaveToNoteTree([], 0);
  assert.match(html, /该目录下暂无文档/, "空目录应显示降级提示");
});
