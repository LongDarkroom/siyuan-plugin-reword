<script lang="ts">
  import type { ModelParamOverride } from "../ai-settings.ts";
  /**
   * 模型列表管理（第 1 批从 index.ts 迁移）。
   *
   * 能力：搜索过滤 / 从 /models 拉取（多选浮层）/ 手动添加 / 删除 /
   *       按模型覆写 temperature / maxTokens（T6）/
   *       流式三态开关 + 专属系统提示词（2026-09-07 R2）+ 参数摘要行（R3）。
   * 样式沿用全局 .hiword-ai-model-* 与 .hiword-ai-picker-* 类，视觉与旧面板一致。
   *
   * 拉取动作由外部注入 `fetchModels`（插件侧封装了 forwardProxy），本组件不碰网络。
   * R1（2026-09-07）：原「选平台快速填入」下拉已上移为独立磁贴组件
   * AiPlatformGrid（挂设置面板 AI 服务组顶部），此处不再保留第二入口。
   */
  export let models: string[] = [];
  export let baseUrl = "";
  export let apiKey = "";
  /** T6/R2：按模型的参数覆写表（key = 模型名）。UI 只负责编辑，生效在 toEngineSettings / 编排层 */
  export let modelParams: Record<string, ModelParamOverride> = {};
  /** T6：全局值，仅用于输入框 placeholder「未设置时跟随 N」的提示 */
  export let globalTemperature = 0.3;
  export let globalMaxTokens = 2048;
  export let onChange: (models: string[]) => void = () => {};
  export let onChangeParams: (next: Record<string, ModelParamOverride>) => void = () => {};
  export let fetchModels: (
    baseUrl: string,
    apiKey: string
  ) => Promise<{ ok: boolean; models?: string[]; error?: string }> = async () => ({ ok: false });
  export let onMessage: (msg: string, kind: "" | "ok" | "error") => void = () => {};

  let search = "";
  /** T6：展开了参数编辑区的模型 */
  let expanded = new Set<string>();
  let picking = false;
  let pickerModels: string[] = [];
  let pickerFilter = "";
  let pickerChecked = new Set<string>();

  function visible(list: string[], q: string): string[] {
    const key = q.trim().toLowerCase();
    if (!key) return list;
    return list.filter((m) => m.toLowerCase().includes(key));
  }

  function remove(m: string) {
    onChange(models.filter((x) => x !== m));
  }

  // ── T6/R2：按模型参数 ─────────────────────────────────────────
  function toggleParams(m: string) {
    if (expanded.has(m)) expanded.delete(m);
    else expanded.add(m);
    expanded = expanded; // Svelte4：Set 需重新赋值才触发更新
  }
  function hasOverride(m: string): boolean {
    const ov = modelParams[m];
    return !!ov && (
      typeof ov.temperature === "number" ||
      typeof ov.maxTokens === "number" ||
      typeof ov.stream === "boolean" ||
      !!(ov.systemPrompt && ov.systemPrompt.trim())
    );
  }
  /** 输入框取值：未设置时留空（由 placeholder 提示跟随全局） */
  function paramVal(m: string, field: "temperature" | "maxTokens"): string {
    const v = modelParams[m]?.[field];
    return typeof v === "number" ? String(v) : "";
  }
  /** R2：流式三态取值（"" 跟随全局 / "on" 强制开启 / "off" 强制关闭） */
  function streamVal(m: string): string {
    const v = modelParams[m]?.stream;
    return v === true ? "on" : v === false ? "off" : "";
  }
  function setParam(m: string, field: "temperature" | "maxTokens", raw: string) {
    const cur = { ...(modelParams[m] || {}) };
    const num = raw === "" ? NaN : Number(raw);
    if (Number.isFinite(num)) cur[field] = field === "maxTokens" ? Math.round(num) : num;
    else delete cur[field];
    commitParams(m, cur);
  }
  /** R2：写入流式覆写（三态 select 的 onChange） */
  function setStream(m: string, v: string) {
    const cur = { ...(modelParams[m] || {}) };
    if (v === "on") cur.stream = true;
    else if (v === "off") cur.stream = false;
    else delete cur.stream;
    commitParams(m, cur);
  }
  /** R2：写入专属系统提示词（trim 后空 = 删除该字段） */
  function setSysPrompt(m: string, raw: string) {
    const cur = { ...(modelParams[m] || {}) };
    if (raw.trim()) cur.systemPrompt = raw;
    else delete cur.systemPrompt;
    commitParams(m, cur);
  }
  /** T6/R2 共用落盘：空覆写条目直接删掉（与「未设置」等价，避免留空壳） */
  function commitParams(m: string, cur: ModelParamOverride) {
    const next = { ...modelParams };
    if (Object.keys(cur).length) next[m] = cur;
    else delete next[m];
    onChangeParams(next);
  }
  function clearParams(m: string) {
    const next = { ...modelParams };
    delete next[m];
    onChangeParams(next);
  }
  /** R3：覆写摘要行——只显示显式设置过的维度，未覆写返回空串不渲染 */
  function summaryOf(m: string): string {
    const ov = modelParams[m];
    if (!ov) return "";
    const parts: string[] = [];
    if (typeof ov.temperature === "number") parts.push(`Temp ${ov.temperature}`);
    if (typeof ov.maxTokens === "number") parts.push(`Max ${ov.maxTokens}`);
    if (ov.stream === true) parts.push("流式开");
    else if (ov.stream === false) parts.push("流式关");
    if (ov.systemPrompt && ov.systemPrompt.trim()) parts.push("有专属提示词");
    return parts.join(" · ");
  }

  // ── 平台预设（T8→R1）─────────────────────────────────────────
  // R1：pickPlatform 及其下拉已整体上移到 AiSettingsPanel（配 AiPlatformGrid 磁贴）。

  function addManual() {
    const name = (globalThis.prompt?.("请输入模型名称（如 gpt-4o）：") || "").trim();
    if (!name) return;
    if (models.includes(name)) {
      onMessage("模型已存在", "error");
      return;
    }
    onChange([...models, name]);
  }

  async function fetchFromApi() {
    if (!baseUrl.trim()) { onMessage("请先填写 API 地址", "error"); return; }
    if (!apiKey.trim()) { onMessage("请先填写 API Key", "error"); return; }
    onMessage("正在获取模型列表…", "");
    const r = await fetchModels(baseUrl.trim(), apiKey.trim());
    if (!r.ok || !r.models) {
      onMessage("获取失败：" + (r.error || "未知错误"), "error");
      return;
    }
    const existing = new Set(models);
    const available = r.models.filter((m) => !existing.has(m));
    if (available.length === 0) {
      onMessage(`已获取 ${r.models.length} 个模型，但全部已在列表中`, "ok");
      return;
    }
    pickerModels = available;
    pickerFilter = "";
    pickerChecked = new Set<string>();
    picking = true;
    onMessage("", "");
  }

  function togglePick(m: string, on: boolean) {
    if (on) pickerChecked.add(m); else pickerChecked.delete(m);
    pickerChecked = pickerChecked; // 触发 Svelte 更新
  }
  function setAllVisible(on: boolean) {
    visible(pickerModels, pickerFilter).forEach((m) => {
      if (on) pickerChecked.add(m); else pickerChecked.delete(m);
    });
    pickerChecked = pickerChecked;
  }
  function confirmPick() {
    const toAdd = pickerModels.filter((m) => pickerChecked.has(m));
    onChange([...models, ...toAdd]);
    picking = false;
    onMessage(`已添加 ${toAdd.length} 个模型`, "ok");
  }

  /* 2026-09-15：currentColor SVG 图标（替代固定色 emoji / 特殊字符） */
  const ICONS: Record<string, string> = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>',
    gear: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"/>',
  };
  function iconSvg(n: string): string {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
  }
</script>

<div class="hiword-ai-model-mgr">
  <div class="hiword-ai-model-search">
    <input
      class="hiword-ai-input"
      placeholder="搜索模型..."
      bind:value={search}
    />
    <button class="hiword-ai-btn hiword-ai-btn--ghost hiword-ai-btn--sm" on:click={fetchFromApi}>
      <span class="ais-ml-btn-icon">{@html iconSvg("search")}</span>获取模型
    </button>
    <button class="hiword-ai-btn hiword-ai-btn--ghost hiword-ai-btn--sm" on:click={addManual}>
      + 添加
    </button>
  </div>
  <div class="hiword-ai-model-list">
    {#each visible(models, search) as m (m)}
      <div class="hiword-ai-model-item">
        <div class="hiword-ai-model-row">
          <span class="hiword-ai-model-name">{m}</span>
          {#if hasOverride(m)}
            <span class="hiword-ai-model-flag" title="已单独设置参数"><span class="ais-ml-flag-dot"></span></span>
          {/if}
          <button
            class="hiword-ai-model-param-btn"
            title="按模型设置温度 / 最大 Token / 流式 / 专属提示词"
            aria-expanded={expanded.has(m)}
            on:click={() => toggleParams(m)}>{@html iconSvg("gear")}</button
          >
          <button class="hiword-ai-model-del" title="删除" on:click={() => remove(m)}>&times;</button>
        </div>
        <!-- R3：覆写摘要行——只列显式设置过的维度 -->
        {#if !expanded.has(m) && summaryOf(m)}
          <div class="hiword-ai-model-summary">{summaryOf(m)}</div>
        {/if}
        {#if expanded.has(m)}
          <div class="hiword-ai-model-params">
            <label>
              <span>温度</span>
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={paramVal(m, "temperature")}
                placeholder={`全局 ${globalTemperature}`}
                on:change={(e) => setParam(m, "temperature", e.currentTarget.value)}
              />
            </label>
            <label>
              <span>最大 Token</span>
              <input
                type="number"
                min="16"
                max="32768"
                step="1"
                value={paramVal(m, "maxTokens")}
                placeholder={`全局 ${globalMaxTokens}`}
                on:change={(e) => setParam(m, "maxTokens", e.currentTarget.value)}
              />
            </label>
            <!-- R2：流式三态开关。强制关闭 = 该模型降级非流式请求（端点不支持 SSE 时用）；
                 强制开启在有回调链路上本就是默认行为，仅作显式标记 -->
            <label>
              <span>流式输出</span>
              <select class="hiword-ai-input hiword-ai-stream-select"
                value={streamVal(m)}
                on:change={(e) => setStream(m, e.currentTarget.value)}
              >
                <option value="">跟随全局</option>
                <option value="on">强制开启</option>
                <option value="off">强制关闭</option>
              </select>
            </label>
            <button
              class="hiword-ai-btn hiword-ai-btn--outline hiword-ai-btn--sm"
              on:click={() => clearParams(m)}>恢复全局</button
            >
          </div>
          <!-- R2：专属系统提示词。非空时最高优先级（覆盖 AI 角色提示词），生效点在编排层组装 system 处 -->
          <textarea
            class="hiword-ai-input hiword-ai-model-sysprompt"
            rows="2"
            placeholder="专属系统提示词（留空 = 使用 AI 角色的提示词；非空时优先）"
            spellcheck="false"
            value={modelParams[m]?.systemPrompt || ""}
            on:change={(e) => setSysPrompt(m, e.currentTarget.value)}
          ></textarea>
          <div class="hiword-ai-model-params-hint">留空 = 跟随全局；生效于精读 / 对话 / 批注 AI</div>
        {/if}
      </div>
    {/each}
    {#if visible(models, search).length === 0}
      <div class="ais-empty">无匹配模型</div>
    {/if}
  </div>
</div>

{#if picking}
  <!-- 遮罩层：点自身关闭 + Esc 关闭。role=dialog 已声明语义，
       svelte 的 a11y 规则仍会对 div 上的 click/keydown 报警，故显式忽略。 -->
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="hiword-ai-model-picker-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="选择要添加的模型"
    tabindex="-1"
    on:click|self={() => (picking = false)}
    on:keydown={(e) => { if (e.key === "Escape") picking = false; }}
  >
    <div class="hiword-ai-model-picker">
      <div class="hiword-ai-picker-header">
        <span>可选 {pickerModels.length} 个新模型</span>
        <span class="hiword-ai-picker-sub">已选 {pickerChecked.size}</span>
        <button class="hiword-ai-picker-close" on:click={() => (picking = false)}>&times;</button>
      </div>
      <div class="hiword-ai-picker-search">
        <input placeholder="筛选模型..." bind:value={pickerFilter} />
      </div>
      <div class="hiword-ai-picker-actions">
        <button class="hiword-ai-btn hiword-ai-btn--primary hiword-ai-btn--sm" on:click={() => setAllVisible(true)}>全选</button>
        <button class="hiword-ai-btn hiword-ai-btn--outline hiword-ai-btn--sm" on:click={() => setAllVisible(false)}>取消全选</button>
        <button class="hiword-ai-btn hiword-ai-btn--primary" on:click={confirmPick}>添加选中 ({pickerChecked.size})</button>
      </div>
      <div class="hiword-ai-picker-list">
        {#each visible(pickerModels, pickerFilter) as m (m)}
          <label class="hiword-ai-picker-item" class:checked={pickerChecked.has(m)}>
            <input type="checkbox" checked={pickerChecked.has(m)} on:change={(e) => togglePick(m, e.currentTarget.checked)} />
            <span class="hiword-ai-picker-name">{m}</span>
          </label>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .ais-empty {
    padding: 10px;
    font-size: 12px;
    opacity: 0.6;
    text-align: center;
  }
  /* 2026-09-15：搜索按钮图标（currentColor SVG） */
  .ais-ml-btn-icon {
    display: inline-flex;
    align-items: center;
    vertical-align: -2px;
    margin-right: 4px;
  }
  .ais-ml-btn-icon :global(svg) {
    width: 12px;
    height: 12px;
  }
  /* 2026-09-15：覆写标记改为 CSS 圆点（替代 ● 字符） */
  .hiword-ai-model-flag {
    color: var(--b3-theme-primary, #4285f4);
    display: inline-flex;
    align-items: center;
    line-height: 1;
  }
  .ais-ml-flag-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  /* T6：模型行 = 名称 +（覆写标记）+ 参数齿轮 + 删除 */
  .hiword-ai-model-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
  }
  .hiword-ai-model-row .hiword-ai-model-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hiword-ai-model-param-btn {
    background: none;
    border: none;
    cursor: pointer;
    opacity: 0.55;
    padding: 0 2px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .hiword-ai-model-param-btn :global(svg) {
    width: 13px;
    height: 13px;
  }
  .hiword-ai-model-param-btn:hover { opacity: 1; }
  .hiword-ai-model-params {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 6px 2px 2px;
    width: 100%;
  }
  .hiword-ai-model-params label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    opacity: 0.8;
  }
  .hiword-ai-model-params input {
    width: 84px;
  }
  .hiword-ai-model-params-hint {
    font-size: 11px;
    opacity: 0.5;
    padding: 0 2px 4px;
  }
  /* R3：覆写摘要行（模型名下方小字，如 Temp 0.7 · Max 4096 · 流式关） */
  .hiword-ai-model-summary {
    font-size: 11px;
    opacity: 0.55;
    padding: 1px 2px 3px;
    line-height: 1.4;
  }
  /* R2：流式三态与专属提示词（窄控件，与温度/Token 同行风格） */
  .hiword-ai-stream-select {
    width: 108px;
  }
  .hiword-ai-model-sysprompt {
    width: 100%;
    margin-top: 6px;
    padding: 6px 8px;
    font-size: 12px;
    line-height: 1.5;
    resize: vertical;
    box-sizing: border-box;
  }
</style>
