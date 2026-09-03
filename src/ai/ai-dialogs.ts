/**
 * REword · AI 面板弹窗 HTML 生成
 * ------------------------------------------------------------------
 * 纯 HTML 片段生成函数（不含事件绑定），用于解耦 ai-panel.ts 的体积。
 * 事件绑定在 ai-panel.ts 中完成，这里只负责根据数据产出 DOM 字符串。
 *
 * 所有输出复用 panel 内的样式类（见 index.less 的 hiword-ai-* 系列），
 * 通过 data-* 钩子暴露交互点。
 */

import { escapeHtml } from "./ai-render.ts";
import type { AiPreset } from "./ai-preset.ts";
import type { AiPromptTemplate } from "./ai-prompt-templates.ts";

/** 模型下拉菜单（返回内部 item HTML，不包含外层容器） */
export function renderModelMenu(models: string[], current: string): string {
  const items = (models && models.length ? models : [current]).map(
    (m) => `
      <button class="hiword-ai-model-item${m === current ? " hiword-ai-model-item--active" : ""}" data-model="${escapeHtml(m)}">
        ${m === current ? '<span class="hiword-ai-model-check">✓</span>' : ""}
        <span class="hiword-ai-model-name">${escapeHtml(m)}</span>
      </button>`
  ).join("");
  return items;
}

/** 提示词模板列表面板 */
export function renderPromptPanel(templates: AiPromptTemplate[]): string {
  const items = templates.length
    ? templates.map((t) => `
        <div class="hiword-ai-tpl-item" data-id="${escapeHtml(t.id)}">
          <div class="hiword-ai-tpl-item-main" data-act="use">
            <div class="hiword-ai-tpl-item-name">${escapeHtml(t.name)}</div>
            <div class="hiword-ai-tpl-item-preview">${escapeHtml(t.content.slice(0, 60))}${t.content.length > 60 ? "…" : ""}</div>
          </div>
          <div class="hiword-ai-tpl-item-actions">
            <button class="hiword-ai-tpl-btn" data-act="edit" title="编辑">✏️</button>
            <button class="hiword-ai-tpl-btn" data-act="del" title="删除">🗑</button>
          </div>
        </div>`).join("")
    : `<div class="hiword-ai-tpl-empty">暂无快捷指令，点击下方「新建」添加。</div>`;
  return `
    <div class="hiword-ai-tpl-list">${items}</div>
    <div class="hiword-ai-tpl-new-row">
      <button class="hiword-ai-tpl-new" data-act="new">＋ 新建提示词</button>
    </div>`;
}

/** 通用浮层 titlebar（左标题 + 右 ✕），2026-08-16 重构统一两个对话框样式 */
function renderOverlayTitlebar(title: string): string {
  return `
    <div class="hiword-ai-overlay-titlebar">
      <span class="hiword-ai-overlay-title">${escapeHtml(title)}</span>
      <button class="hiword-ai-overlay-close" data-act="close-overlay" aria-label="关闭">✕</button>
    </div>`;
}

/** 预设摘要副标题（用于列表卡片） */
function renderPresetSummary(p: AiPreset): string {
  const ctx = p.contextMessages === -1 ? "无限制" : `${p.contextMessages} 条`;
  const mode = p.templateType === "learning" ? "结构化精读" : "问答模式";
  return `上下文消息数: ${ctx} | 聊天模式: ${mode}`;
}

/** 预设列表视图（2026-08-16 重做：titlebar + 大紫色新建按钮 + 搜索框 + 卡片列表） */
export function renderPresetListView(presets: AiPreset[], activeId: string, opts?: { keyword?: string }): string {
  const kw = (opts?.keyword || "").trim().toLowerCase();
  const filtered = kw
    ? presets.filter((p) => p.name.toLowerCase().includes(kw))
    : presets;
  const cards = filtered.length
    ? filtered.map((p) => {
        const isActive = p.id === activeId;
        return `
        <div class="hiword-ai-preset-item${isActive ? " active" : ""}" data-id="${escapeHtml(p.id)}">
          <div class="hiword-ai-preset-item-main" data-act="open">
            <div class="hiword-ai-preset-item-name">${escapeHtml(p.name)}${isActive ? '<span class="hiword-ai-preset-active-chip">· 使用中</span>' : ""}</div>
            <div class="hiword-ai-preset-item-sub">${escapeHtml(renderPresetSummary(p))}</div>
          </div>
          <div class="hiword-ai-preset-item-actions">
            <button class="hiword-ai-preset-icon" data-act="edit" title="编辑">✎</button>
            <button class="hiword-ai-preset-icon" data-act="del" title="删除">🗑</button>
          </div>
        </div>`;
      }).join("")
    : `<div class="hiword-ai-preset-empty">${
        presets.length === 0
          ? "还没有 AI 角色，点击「＋ 新建角色」创建你的第一个角色"
          : "没有匹配「" + escapeHtml(opts?.keyword || "") + "」的 AI 角色"
      }</div>`;

  return `
    <div class="hiword-ai-preset-list-view">
      ${renderOverlayTitlebar("AI 角色")}
      <div class="hiword-ai-preset-list-body">
        <button class="hiword-ai-preset-new" data-act="new">＋ 新建角色</button>
        <input class="hiword-ai-preset-search" data-field="keyword" placeholder="搜索 AI 角色" value="${escapeHtml(opts?.keyword || "")}" />
        <div class="hiword-ai-preset-list" data-field="list">${cards}</div>
      </div>
    </div>`;
}

/** 预设编辑面板（保留原编辑器逻辑，外层加 titlebar 统一风格） */
export function renderPresetPanel(preset: AiPreset, opts?: { activeId?: string; isNew?: boolean }): string {
  const isActive = opts?.activeId === preset.id && !!opts?.activeId;
  const title = opts?.isNew ? "新建 AI 角色" : "编辑 AI 角色";
  return `
    <div class="hiword-ai-preset-panel">
      ${renderOverlayTitlebar(title)}
      <div class="hiword-ai-preset-panel-subbar">
        <button class="hiword-ai-btn hiword-ai-btn--ghost" data-act="preset-list" title="返回 AI 角色列表">� 角色列表</button>
        <div class="hiword-ai-preset-top-actions">
          ${isActive ? `<button class="hiword-ai-btn hiword-ai-btn--ghost" data-act="close-preset" title="关闭角色，恢复自由对话">✕ 关闭角色</button>` : ""}
          <button class="hiword-ai-btn hiword-ai-btn--primary" data-act="save-preset">保存</button>
        </div>
      </div>
      <div class="hiword-ai-preset-form" data-preset-id="${escapeHtml(preset.id)}">
        <div class="hiword-ai-preset-field">
          <label class="hiword-ai-preset-label">角色名称</label>
          <input class="hiword-ai-preset-input" data-field="name" value="${escapeHtml(preset.name)}" />
        </div>

        <div class="hiword-ai-preset-field">
          <label class="hiword-ai-preset-label">输出形态</label>
          <select class="hiword-ai-preset-select" data-field="templateType">
            <option value="learning" ${preset.templateType === "learning" ? "selected" : ""}>📖 结构化精读（约束自由对话，联动词库/批注）</option>
            <option value="chat" ${preset.templateType === "chat" ? "selected" : ""}>💬 自由对话</option>
          </select>
        </div>

        <div class="hiword-ai-preset-field">
          <label class="hiword-ai-preset-label">上下文消息数 <em data-val="context">${preset.contextMessages === -1 ? "无限制" : preset.contextMessages}</em></label>
          <input class="hiword-ai-preset-slider" data-field="contextMessages" type="range" min="-1" max="50" step="1" value="${preset.contextMessages}" />
        </div>

        <div class="hiword-ai-preset-field">
          <div class="hiword-ai-preset-switch-row">
            <label class="hiword-ai-switch">
              <input type="checkbox" data-field="temperatureEnabled" ${preset.temperatureEnabled ? "checked" : ""} />
              <span class="hiword-ai-switch-track"></span>
            </label>
            <span class="hiword-ai-preset-label">自定义温度 <em data-val="temp">${preset.temperature}</em></span>
          </div>
          <input class="hiword-ai-preset-slider" data-field="temperature" type="range" min="0" max="2" step="0.1" value="${preset.temperature}" />
        </div>

        <div class="hiword-ai-preset-field">
          <label class="hiword-ai-preset-label">输出模板（系统提示词，约束 AI 返回的固定格式；留空 = 用全局）</label>
          <textarea class="hiword-ai-preset-textarea" data-field="systemPrompt" spellcheck="false" placeholder="例如：请严格按 JSON 返回 {words:[...], sentences:[...], summary:...}">${escapeHtml(preset.systemPrompt)}</textarea>
        </div>

        <div class="hiword-ai-preset-field">
          <div class="hiword-ai-preset-switch-row">
            <label class="hiword-ai-switch">
              <input type="checkbox" data-field="autoCollectWords" ${preset.autoCollectWords ? "checked" : ""} />
              <span class="hiword-ai-switch-track"></span>
            </label>
            <span class="hiword-ai-preset-label">AI 结果支持批量入库词库</span>
          </div>
        </div>

        <div class="hiword-ai-preset-field">
          <div class="hiword-ai-preset-switch-row">
            <label class="hiword-ai-switch">
              <input type="checkbox" data-field="autoAnnotateSentences" ${preset.autoAnnotateSentences ? "checked" : ""} />
              <span class="hiword-ai-switch-track"></span>
            </label>
            <span class="hiword-ai-preset-label">AI 结果支持批量写入批注</span>
          </div>
        </div>

        <div class="hiword-ai-preset-field hiword-ai-preset-danger">
          <button class="hiword-ai-btn hiword-ai-btn--danger" data-act="delete-preset">🗑 删除此角色</button>
        </div>
      </div>
    </div>`;
}

/** 文档搜索对话框（2026-08-16 重做：titlebar + 搜索框 + 文档结果卡片） */
export function renderDocSearchDialog(): string {
  return `
    <div class="hiword-ai-docsearch">
      <div class="hiword-ai-overlay-titlebar">
        <span class="hiword-ai-overlay-title">搜索文档</span>
        <button class="hiword-ai-overlay-close" data-act="close-overlay" aria-label="关闭">✕</button>
      </div>
      <div class="hiword-ai-docsearch-body">
        <input class="hiword-ai-docsearch-input" data-field="keyword" placeholder="输入关键词搜索，留空显示当前文档" />
        <div class="hiword-ai-docsearch-list" data-field="list">
          <div class="hiword-ai-docsearch-empty">输入关键词搜索，或留空查看最近文档</div>
        </div>
      </div>
    </div>`;
}

/** 文档搜索结果列表项（2026-08-16 重做：title + 路径 + 右侧「添加到上下文」按钮） */
export function renderDocSearchItems(
  docs: { id: string; title: string; hpath?: string }[]
): string {
  if (!docs.length) return `<div class="hiword-ai-docsearch-empty">未找到匹配的文档</div>`;
  return docs.map((d) => `
    <div class="hiword-ai-docsearch-item" data-doc-id="${escapeHtml(d.id)}">
      <div class="hiword-ai-docsearch-item-main">
        <div class="hiword-ai-docsearch-item-name">${escapeHtml(d.title)}</div>
        ${d.hpath ? `<div class="hiword-ai-docsearch-item-path">${escapeHtml(d.hpath)}</div>` : ""}
      </div>
      <button class="hiword-ai-docsearch-add" data-act="add">添加到上下文</button>
    </div>`).join("");
}

/** 消息下方工具栏（复制 Markdown / TXT、保存、编辑、重试） */
export function renderMessageToolbar(role: "user" | "assistant"): string {
  const isUser = role === "user";
  return `
    <div class="hiword-ai-msg-toolbar" data-role="${role}">
      <button class="hiword-ai-msg-tool" data-act="copy-md" title="复制 Markdown" aria-label="复制 Markdown"><span class="hiword-ai-msg-tool-icon hiword-ai-msg-tool-icon--md">MD</span></button>
      <button class="hiword-ai-msg-tool" data-act="copy-txt" title="复制纯文本" aria-label="复制纯文本"><span class="hiword-ai-msg-tool-icon hiword-ai-msg-tool-icon--txt">TXT</span></button>
      <button class="hiword-ai-msg-tool" data-act="save-note" title="保存到笔记" aria-label="保存到笔记"><span class="hiword-ai-msg-tool-icon">💾</span></button>
      <button class="hiword-ai-msg-tool" data-act="edit" title="编辑" aria-label="编辑"><span class="hiword-ai-msg-tool-icon">✏️</span></button>
      ${isUser ? "" : `<button class="hiword-ai-msg-tool" data-act="retry" title="重新生成" aria-label="重新生成"><span class="hiword-ai-msg-tool-icon">🔄</span></button>`}
    </div>`;
}

export interface SaveToNoteDialogData {
  notebooks: { id: string; name: string }[];
  defaultName?: string;
  defaultPath?: string;
}

/** 「保存到笔记」对话框：笔记本 + 文档树选择器 + 手动路径 + 文档名 */
export function renderSaveToNoteDialog(data: SaveToNoteDialogData): string {
  const notebookOpts = data.notebooks.length
    ? data.notebooks.map((n) => `<option value="${escapeHtml(n.id)}">${escapeHtml(n.name)}</option>`).join("")
    : `<option value="">暂无笔记本</option>`;
  return `
    <div class="hiword-ai-savenote">
      ${renderOverlayTitlebar("保存到笔记")}
      <div class="hiword-ai-savenote-body">
        <div class="hiword-ai-savenote-field">
          <label class="hiword-ai-savenote-label">文档名称</label>
          <input class="hiword-ai-savenote-input" data-field="title" placeholder="留空则自动生成" value="${escapeHtml(data.defaultName || "")}" />
        </div>
        <div class="hiword-ai-savenote-field">
          <label class="hiword-ai-savenote-label">笔记本</label>
          <select class="hiword-ai-savenote-select" data-field="notebook">${notebookOpts}</select>
        </div>
        <div class="hiword-ai-savenote-field">
          <label class="hiword-ai-savenote-label">路径（可选）</label>
          <input class="hiword-ai-savenote-input" data-field="path" placeholder="留空为笔记本根目录，或从下方文档树选择" value="${escapeHtml(data.defaultPath || "")}" />
        </div>
        <div class="hiword-ai-savenote-tree" data-field="tree">
          <div class="hiword-ai-savenote-empty">请选择笔记本以加载文档树</div>
        </div>
        <div class="hiword-ai-savenote-footer">
          <label class="hiword-ai-savenote-switch">
            <input type="checkbox" data-field="openAfterSave" checked />
            <span>保存后打开笔记</span>
          </label>
          <div class="hiword-ai-savenote-actions">
            <button class="hiword-ai-btn hiword-ai-btn--ghost" data-act="cancel">取消</button>
            <button class="hiword-ai-btn hiword-ai-btn--primary" data-act="confirm">确定</button>
          </div>
        </div>
      </div>
    </div>`;
}

/** 文档树节点渲染（递归） */
export function renderSaveToNoteTree(
  nodes: { id: string; name: string; path: string; children?: any[] }[],
  level = 0
): string {
  if (!nodes.length) return `<div class="hiword-ai-savenote-empty">该目录下暂无文档</div>`;
  return `
    <div class="hiword-ai-savenote-list" style="--level:${level}">
      ${nodes.map((n) => `
        <div class="hiword-ai-savenote-node${n.children ? " has-children" : ""}" data-path="${escapeHtml(n.path)}" data-id="${escapeHtml(n.id)}" style="padding-left:${level * 16 + 8}px">
          <span class="hiword-ai-savenote-toggle">${n.children ? "▸" : "·"}</span>
          <span class="hiword-ai-savenote-name">${escapeHtml(n.name)}</span>
        </div>
        ${n.children ? `<div class="hiword-ai-savenote-children" style="display:none">${renderSaveToNoteTree(n.children, level + 1)}</div>` : ""}
      `).join("")}
    </div>`;
}
