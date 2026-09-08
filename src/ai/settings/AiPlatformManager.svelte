<script lang="ts">
  /**
   * 2026-09-07 改动点 1/2：平台配置管理区（替代原 AiPlatformGrid 磁贴 + 服务组的
   * baseUrl/apiKey/模型列表/模型参数独立项）。
   *
   * 结构：
   *  - 平台页签行：固定「硅基流动」(不可删) + 自定义平台 + 「+」新建按钮；
   *  - 当前平台配置表单：名称（自定义可改、地址自动识别）、API 地址、API Key
   *    （📋 剪贴板导入 + 👁 显隐），附「仅存本地」提示；
   *  - 模型参数区：复用 AiModelList，按当前平台的 models / modelParams 内联渲染，
   *    每模型一张卡片直接改温度 / Max / 流式 / 专属提示词（改动点 2）。
   *
   * 数据流：本组件不碰持久化，所有改动经 onChangePlatforms / onChangeActive / onChangeModel
   * 写回设置面板的 draft，由 index.ts 合并 + normalize 后落盘（normalize 会同步顶层镜像）。
   */
  import type { AiPlatform, ModelParamOverride } from "../ai-settings.ts";
  import { detectPlatformName } from "../ai-settings.ts";
  import AiModelList from "./AiModelList.svelte";

  export let platforms: AiPlatform[] = [];
  export let activePlatformId = "";
  export let model = "";
  export let globalTemperature = 0.3;
  export let globalMaxTokens = 2048;
  export let onChangePlatforms: (p: AiPlatform[]) => void = () => {};
  export let onChangeActive: (id: string) => void = () => {};
  export let onChangeModel: (m: string) => void = () => {};
  export let fetchModels: (
    baseUrl: string,
    apiKey: string
  ) => Promise<{ ok: boolean; models?: string[]; error?: string }> = async () => ({ ok: false });
  export let onMessage: (msg: string, kind: "" | "ok" | "error") => void = () => {};

  $: active = platforms.find((p) => p.id === activePlatformId) || platforms[0];

  /** 改当前平台某字段，产出新数组回传（不原地改 props） */
  function updateActive(patch: Partial<AiPlatform>) {
    if (!active) return;
    const next = platforms.map((p) => (p.id === active.id ? { ...p, ...patch } : p));
    onChangePlatforms(next);
  }

  function switchTab(id: string) {
    onChangeActive(id);
  }

  function removePlatform(id: string) {
    const target = platforms.find((p) => p.id === id);
    if (!target || target.fixed) return; // 固定平台不可删
    const next = platforms.filter((p) => p.id !== id);
    onChangePlatforms(next);
    if (activePlatformId === id) {
      const newActive = next[0];
      onChangeActive(newActive.id);
      onChangeModel(newActive?.models?.[0] || "");
    }
  }

  // ── 新建平台弹窗（命名 + 配置表单合一）──────────────────────
  let adding = false;
  let newName = "";
  let newBaseUrl = "";
  let newApiKey = "";
  let nameTouched = false; // 用户手动改过名称则不随地址自动覆盖

  function openAdd() {
    adding = true;
    newName = "";
    newBaseUrl = "";
    newApiKey = "";
    nameTouched = false;
  }
  function closeAdd() {
    adding = false;
  }
  function onNewUrlInput(e: Event) {
    newBaseUrl = (e.currentTarget as HTMLInputElement).value;
    if (!nameTouched) newName = detectPlatformName(newBaseUrl) || "";
  }
  function onNewNameInput(e: Event) {
    newName = (e.currentTarget as HTMLInputElement).value;
    nameTouched = true;
  }
  function confirmAdd() {
    const baseUrl = newBaseUrl.trim();
    if (!baseUrl) {
      onMessage("请填写 API 地址", "error");
      return;
    }
    const id = "plat-" + Math.random().toString(36).slice(2, 9);
    const name = newName.trim() || detectPlatformName(baseUrl) || "我的平台";
    const created: AiPlatform = {
      id,
      name,
      baseUrl,
      apiKey: newApiKey.trim(),
      models: [],
      modelParams: {},
      fixed: false,
    };
    onChangePlatforms([...platforms, created]);
    onChangeActive(id);
    closeAdd();
  }

  // ── API Key 显隐 + 剪贴板导入 ─────────────────────────────
  let showKey = false;
  async function importKey() {
    try {
      const txt = (await navigator.clipboard?.readText?.()) || "";
      if (txt.trim()) {
        updateActive({ apiKey: txt.trim() });
        onMessage("已从剪贴板填入 API Key", "ok");
      }
    } catch {
      onMessage("无法读取剪贴板，请手动粘贴", "error");
    }
  }
</script>

<div class="ais-pmgr">
  <!-- 平台页签行 -->
  <div class="ais-pmgr-tabs" role="tablist">
    {#each platforms as p (p.id)}
      <div class="ais-pmgr-tabwrap">
        <button
          type="button"
          class="ais-pmgr-tab"
          class:active={active && p.id === active.id}
          role="tab"
          aria-selected={active && p.id === active.id}
          on:click={() => switchTab(p.id)}
        >{p.name}</button>
        {#if !p.fixed}
          <button
            type="button"
            class="ais-pmgr-del"
            title="删除该平台"
            aria-label={`删除 ${p.name}`}
            on:click={() => removePlatform(p.id)}>×</button
          >
        {/if}
      </div>
    {/each}
    <button type="button" class="ais-pmgr-add" title="新建平台" on:click={openAdd}>+ 新建</button>
  </div>

  {#if active}
    <!-- 当前平台配置表单 -->
    <div class="ais-pmgr-form">
      <label class="ais-pmgr-field">
        <span class="ais-pmgr-label">平台名称</span>
        {#if active.fixed}
          <input class="hiword-ai-input" value={active.name} readonly disabled />
        {:else}
          <input
            class="hiword-ai-input"
            value={active.name}
            on:input={(e) => updateActive({ name: e.currentTarget.value })}
          />
        {/if}
      </label>
      <label class="ais-pmgr-field">
        <span class="ais-pmgr-label">API 地址</span>
        <input
          class="hiword-ai-input"
          placeholder="https://api.openai.com/v1"
          value={active.baseUrl}
          on:input={(e) => updateActive({ baseUrl: e.currentTarget.value })}
        />
      </label>
      <label class="ais-pmgr-field">
        <span class="ais-pmgr-label">API Key</span>
        <span class="ais-pmgr-keywrap">
          <input
            class="hiword-ai-input"
            type={showKey ? "text" : "password"}
            placeholder="sk-..."
            value={active.apiKey}
            on:input={(e) => updateActive({ apiKey: e.currentTarget.value })}
          />
          <button type="button" class="ais-pmgr-keybtn" title="从剪贴板导入" on:click={importKey}>📋</button>
          <button
            type="button"
            class="ais-pmgr-keybtn"
            title={showKey ? "隐藏" : "显示"}
            on:click={() => (showKey = !showKey)}>{showKey ? "👁" : "🙈"}</button
          >
        </span>
      </label>
      <p class="ais-pmgr-note">API Key 仅保存在本机插件数据（hiword-ai.json），不会上传。</p>
    </div>

    <!-- 改动点 2：模型参数内联到每个平台下方 -->
    <div class="ais-pmgr-models">
      <AiModelList
        models={active.models}
        baseUrl={active.baseUrl}
        apiKey={active.apiKey}
        modelParams={active.modelParams || {}}
        {globalTemperature}
        {globalMaxTokens}
        {fetchModels}
        onMessage={(m, kind) => onMessage(m, kind)}
        onChange={(list) => updateActive({ models: list })}
        onChangeParams={(mp) => updateActive({ modelParams: mp })}
      />
    </div>
  {:else}
    <div class="ais-empty">尚未配置任何平台</div>
  {/if}
</div>

{#if adding}
  <!-- 新建平台弹窗（命名 + 配置表单） -->
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="ais-pmgr-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="新建平台"
    tabindex="-1"
    on:click|self={closeAdd}
    on:keydown={(e) => { if (e.key === "Escape") closeAdd(); }}
  >
    <div class="ais-pmgr-dialog">
      <h4 class="ais-pmgr-dtitle">新建平台</h4>
      <label class="ais-pmgr-field">
        <span class="ais-pmgr-label">平台名称（可留空，按地址自动识别）</span>
        <input class="hiword-ai-input" placeholder="如 硅基流动 / OpenAI" value={newName} on:input={onNewNameInput} />
      </label>
      <label class="ais-pmgr-field">
        <span class="ais-pmgr-label">API 地址</span>
        <input
          class="hiword-ai-input"
          placeholder="https://api.openai.com/v1"
          value={newBaseUrl}
          on:input={onNewUrlInput}
        />
      </label>
      <label class="ais-pmgr-field">
        <span class="ais-pmgr-label">API Key</span>
        <input class="hiword-ai-input" type="password" placeholder="sk-..." value={newApiKey} on:input={(e) => (newApiKey = e.currentTarget.value)} />
      </label>
      <div class="ais-pmgr-dactions">
        <button class="hiword-ai-btn hiword-ai-btn--outline hiword-ai-btn--sm" on:click={closeAdd}>取消</button>
        <button class="hiword-ai-btn hiword-ai-btn--primary" on:click={confirmAdd}>创建</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .ais-pmgr { margin-bottom: 6px; }
  /* 平台页签行：与设置导航胶囊同语言 */
  .ais-pmgr-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    margin-bottom: 10px;
  }
  .ais-pmgr-tabwrap {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--b3-border-color, #e0e0e0);
    border-radius: 99px;
    background: var(--b3-theme-surface, #fff);
    overflow: hidden;
  }
  .ais-pmgr-tabwrap:focus-within,
  .ais-pmgr-tabwrap:hover {
    border-color: var(--b3-theme-primary, #06b6d4);
  }
  .ais-pmgr-tab {
    border: none;
    background: transparent;
    color: var(--b3-theme-on-surface, #333);
    font: inherit;
    font-size: 12.5px;
    padding: 4px 12px;
    cursor: pointer;
    opacity: 0.75;
  }
  .ais-pmgr-tab.active {
    background: var(--b3-theme-primary, #06b6d4);
    color: var(--b3-theme-primary-text, #fff);
    opacity: 1;
  }
  .ais-pmgr-del {
    border: none;
    background: transparent;
    color: var(--b3-theme-on-surface, #999);
    font: inherit;
    font-size: 13px;
    line-height: 1;
    padding: 0 8px 0 2px;
    cursor: pointer;
  }
  .ais-pmgr-del:hover { color: #ea4335; }
  .ais-pmgr-add {
    border: 1px dashed var(--b3-border-color, #e0e0e0);
    background: transparent;
    color: var(--b3-theme-on-surface, #555);
    font: inherit;
    font-size: 12.5px;
    padding: 4px 12px;
    border-radius: 99px;
    cursor: pointer;
  }
  .ais-pmgr-add:hover { border-color: var(--b3-theme-primary, #06b6d4); color: var(--b3-theme-primary, #06b6d4); }

  /* 配置表单 */
  .ais-pmgr-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--b3-border-color, #e8e8e8);
    border-radius: 8px;
    background: color-mix(in srgb, var(--b3-theme-surface, #fff) 96%, var(--b3-theme-primary, #06b6d4) 4%);
    margin-bottom: 12px;
  }
  .ais-pmgr-field { display: flex; flex-direction: column; gap: 3px; }
  .ais-pmgr-label { font-size: 12px; opacity: 0.8; }
  .ais-pmgr-keywrap { display: flex; gap: 4px; align-items: center; }
  .ais-pmgr-keywrap .hiword-ai-input { flex: 1; min-width: 0; }
  .ais-pmgr-keybtn {
    border: 1px solid var(--b3-border-color, #e0e0e0);
    background: var(--b3-theme-surface, #fff);
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    padding: 0 8px;
    height: 28px;
  }
  .ais-pmgr-keybtn:hover { border-color: var(--b3-theme-primary, #06b6d4); }
  .ais-pmgr-note {
    margin: 0;
    font-size: 11px;
    opacity: 0.5;
    line-height: 1.4;
  }
  .ais-pmgr-models { margin-top: 4px; }

  /* 新建弹窗 */
  .ais-pmgr-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  }
  .ais-pmgr-dialog {
    width: 360px;
    max-width: 92vw;
    background: var(--b3-theme-surface, #fff);
    border-radius: 10px;
    padding: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ais-pmgr-dtitle { margin: 0 0 2px; font-size: 15px; }
  .ais-pmgr-dactions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }
  .ais-empty { padding: 10px; font-size: 12px; opacity: 0.6; text-align: center; }
</style>
