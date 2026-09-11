/**
 * REword · AI 面板弹窗 HTML 生成
 * ------------------------------------------------------------------
 * 纯 HTML 片段生成函数（不含事件绑定），用于解耦 ai-panel.ts 的体积。
 * 事件绑定在 ai-panel.ts 中完成，这里只负责根据数据产出 DOM 字符串。
 *
 * 所有输出复用 panel 内的样式类（见 index.less 的 hiword-ai-* 系列），
 * 通过 data-* 钩子暴露交互点。
 */

import { t } from "../i18n/index.ts";
import { escapeHtml } from "./ai-render.ts";
import type { AiPlatform } from "./ai-settings.ts";
import type { AiPreset } from "./ai-preset.ts";
import type { AiPromptTemplate } from "./ai-prompt-templates.ts";

/**
 * 2026-09-07 改动点 3：两级（平台 → 模型）模型选择器。
 * - 按平台分组，分组默认展开（带折叠头）；
 * - 模型行显示有效 T:/Max: 摘要（无覆写时回退全局默认），去掉图标；
 * - 单选即时生效；空状态由调用方（ai-panel.ts）处理。
 * 返回内部 HTML（外层容器在 ai-panel.ts 的浮层里），不含搜索框。
 */
export function renderModelSelector(
  platforms: AiPlatform[],
  activePlatformId: string,
  current: string,
  globalTemp: number,
  globalMax: number
): string {
  const list = Array.isArray(platforms) ? platforms : [];
  if (!list.length) {
    return `<div class="hiword-ai-model-empty">${t("请先去设置页添加模型")}</div>`;
  }
  const groups = list
    .map((p) => {
      const pid = escapeHtml(p.id);
      const collapsed = p.id !== activePlatformId; // 非激活平台默认折叠，激活平台默认展开
      const models = p.models && p.models.length ? p.models : [];
      const rows = models.length
        ? models
            .map((m) => {
              const ov = p.modelParams?.[m];
              const t = typeof ov?.temperature === "number" ? ov.temperature : globalTemp;
              const mx = typeof ov?.maxTokens === "number" ? ov.maxTokens : globalMax;
              const isCur = m === current && p.id === activePlatformId;
              return `<button class="hiword-ai-model-item${isCur ? " hiword-ai-model-item--active" : ""}" data-model="${escapeHtml(m)}" data-pid="${pid}">
                <span class="hiword-ai-model-name">${escapeHtml(m)}</span>
                <span class="hiword-ai-model-sum">T:${t} | Max:${mx}</span>
                ${isCur ? '<span class="hiword-ai-model-check">✓</span>' : ""}
              </button>`;
            })
            .join("")
        : `<div class="hiword-ai-model-empty">${t("该平台暂无模型")}</div>`;
      return `<div class="hiword-ai-model-group${collapsed ? " collapsed" : ""}" data-pid="${pid}">
        <div class="hiword-ai-model-group-head" data-act="grp" data-pid="${pid}">
          <span class="hiword-ai-model-caret">${collapsed ? "▸" : "▾"}</span>
          <span class="hiword-ai-model-gname">${escapeHtml(p.name)}</span>
        </div>
        <div class="hiword-ai-model-group-body">${rows}</div>
      </div>`;
    })
    .join("");
  return groups;
}

/** 提示词模板列表面板 */
export function renderPromptPanel(templates: AiPromptTemplate[]): string {
  const items = templates.length
    ? templates.map((tpl) => `
        <div class="hiword-ai-tpl-item" data-id="${escapeHtml(tpl.id)}">
          <div class="hiword-ai-tpl-item-main" data-act="use">
            <div class="hiword-ai-tpl-item-name">${escapeHtml(tpl.name)}</div>
            <div class="hiword-ai-tpl-item-preview">${escapeHtml(tpl.content.slice(0, 60))}${tpl.content.length > 60 ? "…" : ""}</div>
          </div>
          <div class="hiword-ai-tpl-item-actions">
            <button class="hiword-ai-tpl-btn" data-act="edit" title="${t("编辑")}">✏️</button>
            <button class="hiword-ai-tpl-btn" data-act="del" title="${t("删除")}">🗑</button>
          </div>
        </div>`).join("")
    : `<div class="hiword-ai-tpl-empty">${t("暂无快捷指令，点击下方「新建」添加。")}</div>`;
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
      <button class="hiword-ai-overlay-close" data-act="close-overlay" aria-label="${t("关闭")}">✕</button>
    </div>`;
}

/** 预设摘要副标题（用于列表卡片） */
function renderPresetSummary(p: AiPreset): string {
  const ctx = p.contextMessages === -1 ? t("无限制") : t("{n} 条", { n: p.contextMessages });
  const mode = p.templateType === "learning" ? t("结构化精读") : t("问答模式");
  return t("上下文消息数: {ctx} | 聊天模式: {mode}", { ctx, mode });
}

/**
 * 单张 AI 角色卡片（2026-09-07 T7 抽出：renderPresetListView 与搜索局部重渲共用，消重复）。
 * 搜索过滤态（allowDrag=false）禁用拖拽——过滤后的下标不等于 store 顺序，落位会错乱。
 */
export function renderPresetCard(p: AiPreset, isActive: boolean, allowDrag: boolean): string {
  return `
    <div class="hiword-ai-preset-item${isActive ? " active" : ""}" data-id="${escapeHtml(p.id)}"${allowDrag ? ' draggable="true"' : ""}>
      <div class="hiword-ai-preset-item-main" data-act="open">
        <div class="hiword-ai-preset-item-name">${escapeHtml(p.name)}${isActive ? `<span class="hiword-ai-preset-active-chip">${t("· 使用中")}</span>` : ""}</div>
        <div class="hiword-ai-preset-item-sub">${escapeHtml(renderPresetSummary(p))}</div>
      </div>
      <div class="hiword-ai-preset-item-actions">
        <button class="hiword-ai-preset-icon" data-act="edit" title="${t("编辑")}">✎</button>
        <button class="hiword-ai-preset-icon" data-act="del" title="${t("删除")}">🗑</button>
      </div>
    </div>`;
}

/** 预设列表视图（2026-08-16 重做：titlebar + 大紫色新建按钮 + 搜索框 + 卡片列表） */
export function renderPresetListView(presets: AiPreset[], activeId: string, opts?: { keyword?: string }): string {
  const kw = (opts?.keyword || "").trim().toLowerCase();
  const filtered = kw
    ? presets.filter((p) => p.name.toLowerCase().includes(kw))
    : presets;
  const allowDrag = !kw; // 过滤态禁拖（见 renderPresetCard 注释）
  const cards = filtered.length
    ? filtered.map((p) => renderPresetCard(p, p.id === activeId, allowDrag)).join("")
    : `<div class="hiword-ai-preset-empty">${
        presets.length === 0
          ? t("还没有 AI 角色，点击「＋ 新建角色」创建你的第一个角色")
          : t("没有匹配「{kw}」的 AI 角色", { kw: escapeHtml(opts?.keyword || "") })
      }</div>`;

  return `
    <div class="hiword-ai-preset-list-view">
      ${renderOverlayTitlebar(t("AI 角色"))}
      <div class="hiword-ai-preset-list-body">
        <button class="hiword-ai-preset-new" data-act="new">＋ 新建角色</button>
        <input class="hiword-ai-preset-search" data-field="keyword" placeholder="${t("搜索 AI 角色")}" value="${escapeHtml(opts?.keyword || "")}" />
        <div class="hiword-ai-preset-list" data-field="list">${cards}</div>
      </div>
    </div>`;
}

/** 预设编辑面板（保留原编辑器逻辑，外层加 titlebar 统一风格） */
export function renderPresetPanel(preset: AiPreset, opts?: { activeId?: string; isNew?: boolean }): string {
  const isActive = opts?.activeId === preset.id && !!opts?.activeId;
  const title = opts?.isNew ? t("新建 AI 角色") : t("编辑 AI 角色");
  return `
    <div class="hiword-ai-preset-panel">
      ${renderOverlayTitlebar(title)}
      <div class="hiword-ai-preset-panel-subbar">
        <button class="hiword-ai-btn hiword-ai-btn--ghost" data-act="preset-list" title="${t("返回 AI 角色列表")}">� 角色列表</button>
        <div class="hiword-ai-preset-top-actions">
          ${isActive ? `<button class="hiword-ai-btn hiword-ai-btn--ghost" data-act="close-preset" title="${t("关闭角色，恢复自由对话")}">✕ ${t("关闭角色")}</button>` : ""}
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
          <label class="hiword-ai-preset-label">上下文消息数 <em data-val="context">${preset.contextMessages === -1 ? t("无限制") : preset.contextMessages}</em></label>
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
          <textarea class="hiword-ai-preset-textarea" data-field="systemPrompt" spellcheck="false" placeholder="${t("例如：请严格按 JSON 返回 {words:[...], sentences:[...], summary:...}")}">${escapeHtml(preset.systemPrompt)}</textarea>
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
        <button class="hiword-ai-overlay-close" data-act="close-overlay" aria-label="${t("关闭")}">✕</button>
      </div>
      <div class="hiword-ai-docsearch-body">
        <input class="hiword-ai-docsearch-input" data-field="keyword" placeholder="${t("输入关键词搜索，留空显示当前文档")}" />
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
  if (!docs.length) return `<div class="hiword-ai-docsearch-empty">${t("未找到匹配的文档")}</div>`;
  return docs.map((d) => `
    <div class="hiword-ai-docsearch-item" data-doc-id="${escapeHtml(d.id)}">
      <div class="hiword-ai-docsearch-item-main">
        <div class="hiword-ai-docsearch-item-name">${escapeHtml(d.title)}</div>
        ${d.hpath ? `<div class="hiword-ai-docsearch-item-path">${escapeHtml(d.hpath)}</div>` : ""}
      </div>
      <button class="hiword-ai-docsearch-add" data-act="add">添加到上下文</button>
    </div>`).join("");
}

/**
 * 消息工具栏单色 SVG 图标（2026-09-10：替换 MD/TXT 文字徽章 + 💾✏️🔄 三个 emoji）。
 * 原因：emoji 的颜色/造型由系统字体决定，亮暗主题下观感不可控，且与文字徽章风格割裂。
 * 统一为 stroke:currentColor 的 feather 风格线性图标——hover 时按钮 color 变主题色，
 * 图标自动跟随，无需额外状态样式。MD = Markdown 标志形、TXT = 文档形。
 * 2026-09-10 晚二次打磨（用户反馈第一版不好看）：
 * · 线宽 1.8 → 1.7（15/16px 下 1.8 显糊），线帽/拐角保持 round；
 * · md：M 与箭头重新配比，右移箭头与 M 拉开 1.6px 间距，不再挤在一起；
 * · txt：折角改为标准 file-text 几何（折角线由闭合斜边 + 内折角线双描），正文行一长一短；
 * · save：软盘（过时隐喻）→ 「下载到托盘」（download tray），更贴合「保存到笔记」语义；
 * · edit：去掉铅笔下的底横线（那是一条 20px 长横线，16px 下喧宾夺主），纯铅笔收尾干净；
 * · retry：保持 rotate-cw 弧形箭头，收窄到 22 内框避免贴边被裁。
 */
const TOOLBAR_ICONS = {
  md: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.2 14.5v-5l3.1 3.1 3.1-3.1v5"/><path d="M16.9 9.5v5M14.7 12.3l2.2 2.2 2.2-2.2"/></svg>`,
  txt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5L14.5 3z"/><path d="M14.5 3v4.5H19"/><path d="M9 13.2h6M9 16.6h4"/></svg>`,
  save: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5V13"/><path d="M8.5 9.5 12 13l3.5-3.5"/><path d="M4.5 15.5V18a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-2.5"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.3 3.7a2.05 2.05 0 0 1 2.9 2.9L8.7 18.1l-4.2 1.4 1.4-4.2L17.3 3.7z"/></svg>`,
  retry: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="21.5 4.5 21.5 10.5 15.5 10.5"/><path d="M20.2 14.9a8.3 8.3 0 1 1-1.96-8.66L21.5 10.5"/></svg>`,
} as const;

/** 消息下方工具栏（复制 Markdown / TXT、保存、编辑、重试） */
export function renderMessageToolbar(role: "user" | "assistant"): string {
  const isUser = role === "user";
  return `
    <div class="hiword-ai-msg-toolbar" data-role="${role}">
      <button class="hiword-ai-msg-tool" data-act="copy-md" title="${t("复制 Markdown")}" aria-label="${t("复制 Markdown")}"><span class="hiword-ai-msg-tool-icon">${TOOLBAR_ICONS.md}</span></button>
      <button class="hiword-ai-msg-tool" data-act="copy-txt" title="${t("复制纯文本")}" aria-label="${t("复制纯文本")}"><span class="hiword-ai-msg-tool-icon">${TOOLBAR_ICONS.txt}</span></button>
      <button class="hiword-ai-msg-tool" data-act="save-note" title="${t("保存到笔记")}" aria-label="${t("保存到笔记")}"><span class="hiword-ai-msg-tool-icon">${TOOLBAR_ICONS.save}</span></button>
      <button class="hiword-ai-msg-tool" data-act="edit" title="${t("编辑")}" aria-label="${t("编辑")}"><span class="hiword-ai-msg-tool-icon">${TOOLBAR_ICONS.edit}</span></button>
      ${isUser ? "" : `<button class="hiword-ai-msg-tool" data-act="retry" title="${t("重新生成")}" aria-label="${t("重新生成")}"><span class="hiword-ai-msg-tool-icon">${TOOLBAR_ICONS.retry}</span></button>`}
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
    : `<option value="">${t("暂无笔记本")}</option>`;
  return `
    <div class="hiword-ai-savenote">
      ${renderOverlayTitlebar(t("保存到笔记"))}
      <div class="hiword-ai-savenote-body">
        <div class="hiword-ai-savenote-field">
          <label class="hiword-ai-savenote-label">文档名称</label>
          <input class="hiword-ai-savenote-input" data-field="title" placeholder="${t("留空则自动生成")}" value="${escapeHtml(data.defaultName || "")}" />
        </div>
        <div class="hiword-ai-savenote-field">
          <label class="hiword-ai-savenote-label">笔记本</label>
          <select class="hiword-ai-savenote-select" data-field="notebook">${notebookOpts}</select>
        </div>
        <div class="hiword-ai-savenote-field">
          <label class="hiword-ai-savenote-label">路径（可选）</label>
          <input class="hiword-ai-savenote-input" data-field="path" placeholder="${t("留空为笔记本根目录，或从下方文档树选择")}" value="${escapeHtml(data.defaultPath || "")}" />
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
  if (!nodes.length) return `<div class="hiword-ai-savenote-empty">${t("该目录下暂无文档")}</div>`;
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
