<script lang="ts">
  /**
   * AI 精读设置面板（第 1 批：替换 index.ts 的 540 行 innerHTML 实现）。
   *
   * 结构：左侧 9 组导航 + 右侧滚动内容区 + 底部保存栏（沿用旧面板的
   * .hiword-ai-settings-* 全局类，视觉不变）。
   *
   * 数据流（对应方案 §5.3）：
   *  - 编辑只写 `draft`，不碰插件的 aiSettings；
   *  - 标 `live` 的项（字号、启用开关、输入框模式）额外走 onLive 立即热生效；
   *  - 点「保存」把 draft 交给外部，由 index.ts 做 merge + normalize 后落盘
   *    （merge 是第 0 批修 P0-1 的成果，此处**绝不**整体替换）。
   */
  import { Dialog } from "siyuan";
  import type { AiSettings } from "../ai-settings.ts";
  import { DEFAULT_AI_SETTINGS } from "../ai-settings.ts";
  // 2026-09-10 多语言：中文原文即 key，渲染时查表替换（见 src/i18n/index.ts 文件头）
  import { t } from "../../i18n/index.ts";
  import {
    SETTING_GROUPS,
    itemsOfGroup,
    isTranslateSideKey,
    countTranslateSideKeys,
    type SettingGroup,
    type SettingGroupId,
    type SettingItem,
  } from "./ai-settings-items.ts";
  import { runDiagnose, formatDiagnose } from "./ai-settings-diagnose.ts";
  import type { AiPlatform, ModelParamOverride } from "../ai-settings.ts";
  import AiSettingRow from "./AiSettingRow.svelte";
  import AiModelList from "./AiModelList.svelte";
  import AiPlatformManager from "./AiPlatformManager.svelte";

  export let settings: AiSettings;
  /**
   * 嵌入统一设置面板时为 true（独立 AI 设置对话框为 false）。
   *
   * 2026-09-15 排版：嵌入时本面板底部的保存栏正好落在外层「取消 / 保存所有设置」
   * 上方，两栏都画 border-top 就成「双横线夹一条缝」。embedded 下把本栏降级为
   * 内容区附属操作（去上边框、收窄间距），全局主操作留给外层 footer。
   * 功能不变：本栏依旧只提交 AI 精读这一页的 draft。
   */
  export let embedded = false;
  export let onSave: (patch: Partial<AiSettings>) => void = () => {};
  export let onCancel: () => void = () => {};
  /** 热生效：改了立即应用到运行中的面板，不必等保存 */
  export let onLive: (key: string, v: unknown) => void = () => {};
  export let testConnection: (cfg: AiSettings) => Promise<{ ok: boolean; error?: string }> = async () => ({ ok: false });
  export let fetchModels: (baseUrl: string, apiKey: string) => Promise<{ ok: boolean; models?: string[]; error?: string }> = async () => ({ ok: false });
  export let verifySoulDoc: (id: string) => Promise<boolean> = async () => false;
  /** 「默认精读角色」下拉的动态选项（来自预设库，index.ts 注入；空库时为空数组） */
  export let presetOptions: { value: string; label: string }[] = [];

  let active: SettingGroupId = "general";
  let draft: Record<string, unknown> = {};
  let testMsg = "";
  let testKind: "" | "ok" | "error" = "";
  let testing = false;

  function valOfKey(k: string): unknown {
    if (k in draft) return draft[k];
    return (settings as unknown as Record<string, unknown>)[k];
  }

  // 2026-09-07 修构建：原模板里 `as AiPlatform[]` 类型断言触发 Svelte 预处理器解析错误
  // （svelte-preprocess 默认不剥离 inline TS cast）。提取到脚本层避免模板 TS。
  $: platformsVal = (valOfKey("platforms") as AiPlatform[] | undefined) || [];

  function valOf(item: SettingItem): unknown {
    return valOfKey(item.key);
  }

  /** 模型列表专用取值：unknown → string[]（模板里做类型收窄会触发 svelte-check 报错） */
  function modelsOf(item: SettingItem): string[] {
    const v = valOf(item);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string");
  }

  /**
   * T6：按模型参数覆写表（unknown → 覆写表）。
   * 与 modelsOf 同理：模板里做类型收窄会触发 svelte-check 报错，故在 script 里收窄。
   */
  function paramsOf(): Record<string, ModelParamOverride> {
    const v = valOfKey("modelParams");
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return v as Record<string, ModelParamOverride>;
  }

  function isDisabled(item: SettingItem): boolean {
    if (!item.requires) return false;
    return !valOfKey(item.requires);
  }

  function onChange(key: string, v: unknown) {
    draft[key] = v;
    draft = draft; // 触发更新
    const it = itemsOfGroup(active).find((x) => x.key === key);
    if (it?.live) onLive(key, v);
  }

  /** 合成完整配置：draft 覆盖 settings（与第 0 批「测试连接」的 merge 口径一致） */
  function merged(): AiSettings {
    return { ...settings, ...draft } as AiSettings;
  }

  async function onAction(action: string) {
    if (action === "test") {
      const cfg = merged();
      if (!cfg.apiKey) {
        testMsg = "请先填写 API Key";
        testKind = "error";
        return;
      }
      testing = true;
      testMsg = "正在连接…";
      testKind = "";
      const r = await testConnection(cfg);
      testing = false;
      testMsg = r.ok ? "连接成功 ✓" : "失败：" + (r.error || "请检查配置");
      testKind = r.ok ? "ok" : "error";
      return;
    }

    if (action === "verify-soul") {
      const id = String(valOfKey("soulDocId") || "").trim();
      if (!id) {
        testMsg = "请输入文档 ID";
        testKind = "error";
        return;
      }
      testMsg = "验证中…";
      testKind = "";
      const ok = await verifySoulDoc(id);
      testMsg = ok ? "✓ 有效文档" : "✗ 未找到该文档";
      testKind = ok ? "ok" : "error";
      return;
    }

    if (action === "diagnose") {
      const r = runDiagnose();
      const text = formatDiagnose(r);
      const dlg = new Dialog({
        title: "AI 设置接线诊断",
        width: "680px",
        height: "520px",
        content: `<div style="padding:12px;height:100%;box-sizing:border-box;">
          <textarea readonly spellcheck="false"
            style="width:100%;height:calc(100% - 44px);box-sizing:border-box;font-family:var(--b3-font-family-code);font-size:12px;line-height:1.6;resize:none;">${escapeHtml(text)}</textarea>
          <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end;">
            <button class="b3-button b3-button--outline" id="rw-ais-diag-copy">复制报告</button>
            <button class="b3-button b3-button--primary" id="rw-ais-diag-close">关闭</button>
          </div>
        </div>`,
      });
      dlg.element.querySelector("#rw-ais-diag-close")?.addEventListener("click", () => dlg.destroy());
      dlg.element.querySelector("#rw-ais-diag-copy")?.addEventListener("click", () => {
        void navigator.clipboard?.writeText(text);
      });
      return;
    }

    if (action === "reset") {
      // T3（2026-09-07 拍板）：只重置 AI 精读侧，**保留翻译引擎密钥**。
      // 早先实现是 `onSave({...DEFAULT_AI_SETTINGS})` —— 连 API Key 与五大引擎密钥一起清空，
      // 用户点一次「重置」就要重新录入全部密钥，等于把 P0-1 那类"保存即丢数据"的体验
      // 又造了一遍。改为：默认值打底 + 翻译侧字段原样回填。
      const keepCount = countTranslateSideKeys();
      const dlg = new Dialog({
        title: "重置为默认",
        width: "400px",
        content: `<div style="padding:16px;line-height:1.7;">
          将把 <b>AI 精读</b> 相关设置恢复为默认（含 AI 服务的 baseUrl / API Key / 模型、提示词、
          精读行为、防幻觉、记忆与词库、导出与诊断）。<br />
          <b>保留</b>翻译引擎侧 ${keepCount} 项配置（腾讯 / 有道 / 百度 / 微软 / Libre 的密钥与开关、翻译提示词、双语风格）。<br />
          <span style="opacity:.75">此操作不可撤销。</span>
          <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end;">
            <button class="b3-button b3-button--outline" id="rw-ais-reset-no">取消</button>
            <button class="b3-button b3-button--primary" id="rw-ais-reset-yes">确认重置</button>
          </div>
        </div>`,
      });
      dlg.element.querySelector("#rw-ais-reset-no")?.addEventListener("click", () => dlg.destroy());
      dlg.element.querySelector("#rw-ais-reset-yes")?.addEventListener("click", () => {
        // 以「当前值（含未保存的编辑）」为准挑保留项：用户在面板里刚改过引擎 Key
        // 却还没保存时，重置也不该把这段编辑吞掉。
        const cur = merged() as unknown as Record<string, unknown>;
        const keep: Record<string, unknown> = {};
        for (const k of Object.keys(cur)) {
          if (isTranslateSideKey(k)) keep[k] = cur[k];
        }
        draft = {};
        onSave({ ...DEFAULT_AI_SETTINGS, ...keep } as Partial<AiSettings>);
        dlg.destroy();
      });
    }
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function save() {
    onSave({ ...draft } as Partial<AiSettings>);
  }

  // 「默认精读角色」的选项 = 静态「无」+ 预设库动态项（批次 2 P0-4 落地）
  $: currentItems = itemsOfGroup(active).map((it) =>
    it.key === "defaultPresetId" && presetOptions.length
      ? { ...it, options: [...(it.options || []), ...presetOptions] }
      : it
  );

  // 当前分组（内容区头部用；Svelte4 的 @const 只能放进块内，故提为响应式声明）
  $: grp = SETTING_GROUPS.find((g) => g.id === active);

  /* 分组导航图标：SVG path 映射（currentColor 跟随主题，替代固定色 emoji）。
     与 ai-settings-items.ts 的 icon key 对应；key 未命中时回退空白（不渲染缺字形）。 */
  const GRP_ICONS: Record<string, string> = {
    gear: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"/>',
    plug: '<path d="M9 2v6M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-12 0V8Z"/><path d="M12 17v5"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
    brain: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M12 14v8"/><circle cx="5" cy="12" r="3"/><path d="M5 9V5a2 2 0 0 1 4 0"/><path d="M5 15v4a2 2 0 0 0 4 0"/><circle cx="19" cy="12" r="3"/><path d="M19 9V5a2 2 0 0 0-4 0"/><path d="M19 15v4a2 2 0 0 1-4 0"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z"/>',
    steth: '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a13.5 13.5 0 0 1 0 18 13.5 13.5 0 0 1 0-18Z"/>',
  };

  function grpIcon(g: SettingGroup): string {
    const p = GRP_ICONS[g.icon];
    return p
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`
      : "";
  }
</script>

<div class="hiword-ai-settings-panel" class:is-embedded={embedded}>
  <nav class="hiword-ai-settings-nav">
    {#each SETTING_GROUPS as g}
      <button
        type="button"
        class="hiword-ai-settings-tab ais-tab"
        class:active={active === g.id}
        on:click={() => (active = g.id)}
      >
        <span class="ais-tab-icon" aria-hidden="true">{@html grpIcon(g)}</span>
        <span class="ais-tab-label">{t(g.label)}</span>
      </button>
    {/each}
  </nav>

  <main class="hiword-ai-settings-main">
    <div class="ais-body">
      <!-- 分组头部：当前类目 + 一句话说明（2026-09-07 UI 打磨） -->
      {#if grp}
        <header class="ais-head">
          <span class="ais-head-icon" aria-hidden="true">{@html grpIcon(grp)}</span>
          <div class="ais-head-text">
            <h3 class="ais-head-title">{t(grp.label)}</h3>
            {#if grp.desc}<p class="ais-head-desc">{t(grp.desc || "")}</p>{/if}
          </div>
        </header>
      {/if}
      <!-- 2026-09-07 改动点 1/2：平台配置管理区（页签 + 表单 + 每平台模型内联参数） -->
      {#if active === "service"}
        <AiPlatformManager
          platforms={platformsVal}
          activePlatformId={String(valOfKey("activePlatformId") || "")}
          model={String(valOfKey("model") || "")}
          globalTemperature={Number(valOfKey("temperature") ?? 0.3)}
          globalMaxTokens={Number(valOfKey("maxTokens") ?? 2048)}
          onChangePlatforms={(p) => onChange("platforms", p)}
          onChangeActive={(id) => onChange("activePlatformId", id)}
          onChangeModel={(m) => onChange("model", m)}
          {fetchModels}
          onMessage={(m, kind) => { testMsg = m; testKind = kind; }}
        />
      {/if}
      <!-- 2026-09-15 视觉重排：同一分组的设置项合并进一张大卡（.hiword-ai-setting-card），
           行间由 .hiword-ai-setting-group + .hiword-ai-setting-group 的分隔线划分，
           取代原来一项一卡的碎卡片布局 -->
      {#if currentItems.length > 0}
        <div class="hiword-ai-setting-card">
          {#each currentItems as item (item.key + item.title + item.type)}
            {#if item.type === "models"}
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">{t(item.title)}</span>
                  {#if item.desc}<span class="hiword-ai-setting-desc">{t(item.desc || "")}</span>{/if}
                </div>
                <AiModelList
                  models={modelsOf(item)}
                  baseUrl={String(valOfKey("baseUrl") || "")}
                  apiKey={String(valOfKey("apiKey") || "")}
                  modelParams={paramsOf()}
                  globalTemperature={Number(valOfKey("temperature") ?? 0.3)}
                  globalMaxTokens={Number(valOfKey("maxTokens") ?? 2048)}
                  {fetchModels}
                  onMessage={(m, kind) => { testMsg = m; testKind = kind; }}
                  onChange={(list) => onChange(item.key, list)}
                  onChangeParams={(next) => onChange("modelParams", next)}
                />
              </div>
            {:else}
              <AiSettingRow
                {item}
                value={valOf(item)}
                disabled={isDisabled(item)}
                msg={item.type === "actions" && (item.group === "service" || item.group === "guard") ? testMsg : ""}
                msgKind={testKind}
                {onChange}
                onAction={onAction}
              />
            {/if}
          {/each}
        </div>
      {/if}
    </div>

    <div class="hiword-ai-settings-savebar">
      <span class="ais-dirty">{Object.keys(draft).length ? `未保存：${Object.keys(draft).length} 项` : ""}</span>
      <button class="b3-button b3-button--outline" on:click={onCancel}>取消</button>
      <button class="b3-button b3-button--primary" on:click={save} disabled={testing}>保存设置</button>
    </div>
  </main>
</div>

<style>
  /* 面板整体高度由外层容器决定，这里只保证内部滚动。
     min-height:0 —— 作为 flex item 时允许被压缩到分配高度，否则内容会把容器撑开、
     内部滚动失效（宿主容器的 flex 链见 index.less 的 .hiword-up-page[data-page="ai"]）。 */
  .hiword-ai-settings-panel {
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
  }

  /* 旧实现里内容区自己滚动、保存栏 appendChild 在末尾随内容滚走。
     新实现改为：内容区内部滚动，保存栏常驻底部。 */
  .hiword-ai-settings-main {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 12px 20px 12px;
  }

  .ais-body {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0 8px;
    min-height: 0;
    scrollbar-width: thin;
  }

  .hiword-ai-settings-savebar {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: flex-end;
    flex-shrink: 0;
    padding-top: 10px;
    border-top: 1px solid var(--b3-border-color, #e8e8e8);
  }

  .ais-dirty {
    margin-right: auto;
    font-size: 12px;
    opacity: 0.65;
  }

  /* 2026-09-15 嵌入统一设置面板时的排版收敛：
     本栏下面是外层的「取消 / 保存所有设置」，两条 border-top 上下相邻 = 双横线夹一条缝。
     这里去掉本栏上边框并压薄上下间距，让它看起来是 AI 内容区的附属操作，
     而不是第二个工具栏；外层 footer 独占唯一的分隔线。 */
  .hiword-ai-settings-panel.is-embedded .hiword-ai-settings-savebar {
    border-top: 0;
    padding-top: 4px;
    padding-bottom: 2px;
  }
  .hiword-ai-settings-panel.is-embedded .hiword-ai-settings-main {
    padding-bottom: 8px;
  }

  /* 导航项用原生 button（可键盘聚焦，规避 a11y 警告），需重置默认外观 */
  .ais-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    width: auto;
    margin: 2px 10px;
    padding: 7px 12px;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 6px;
    font: inherit;
    font-size: 13.5px;
    cursor: pointer;
  }
  .ais-tab-icon {
    /* 2026-09-15：emoji 改 currentColor SVG，尺寸由 svg 元素控制 */
    display: flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    opacity: 0.75;
  }
  .ais-tab-icon :global(svg) {
    width: 15px;
    height: 15px;
  }
  .ais-tab.active .ais-tab-icon {
    opacity: 1;
  }
  .ais-tab-label {
    flex: 1;
  }

  /* 分组头部（2026-09-07 打磨）：图标 + 类目名 + 一句话说明，替代原顶部大标题 */
  .ais-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 2px 4px 12px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--b3-border-color, #e8e8e8);
  }
  .ais-head-icon {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    background: color-mix(in srgb, var(--b3-theme-primary, #06b6d4) 10%, transparent);
    flex-shrink: 0;
  }
  .ais-head-icon :global(svg) {
    width: 17px;
    height: 17px;
    color: var(--b3-theme-primary, #06b6d4);
  }
  .ais-head-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--b3-theme-on-surface, #222);
    line-height: 1.3;
  }
  .ais-head-desc {
    margin: 1px 0 0;
    font-size: 12px;
    color: var(--b3-theme-on-surface-light, #999);
    line-height: 1.4;
  }
</style>
