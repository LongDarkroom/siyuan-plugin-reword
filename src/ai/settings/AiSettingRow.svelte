<script lang="ts">
  /**
   * 单行设置项渲染器：按 item.type 分派控件，并按 wired 状态展示三态徽标。
   *
   * 2026-09-06 第 1 批：替换 index.ts 里 innerHTML + querySelector 的手工绑定。
   * 样式沿用全局 .hiword-ai-setting-* / .hiword-ai-input 等类，视觉与旧面板一致；
   * 仅「三态徽标」与「待办说明」是本次新增，用 scoped 类（.ais-*）。
   *
   * 用户拍板（2026-09-06）：🔵 规划项**正常显示**（不灰显），只在标题旁标徽标 +
   * 下方一行说明。故 disabled 只由 `requires` 上游开关决定，不由 wired 决定。
   */
  import RWSwitch from "../../ui/controls/RWSwitch.svelte";
  import RWSelect from "../../ui/controls/RWSelect.svelte";
  import type { SettingItem } from "./ai-settings-items.ts";

  export let item: SettingItem;
  export let value: any = undefined;
  export let disabled = false;
  export let onChange: (key: string, v: unknown) => void = () => {};
  export let onAction: (action: string) => void = () => {};
  /**
   * actions 类型右侧的状态文案（如「连接成功 ✓」）。
   * 用 prop 而非 slot：Svelte4 要求 slot 内容是组件的**直接子元素**，
   * 被 {#if} 包住会报编译错，而这里只有部分组需要它。
   */
  export let msg = "";
  export let msgKind: "" | "ok" | "error" = "";

  /** 密码类输入框的显隐切换（旧面板的 #ais-toggle-key / #up-ai-toggle-key） */
  let revealed = false;
  /** R4（2026-09-07）：剪贴板导入的行内反馈（成功/失败都短暂显示，不弹 toast 打断输入） */
  let pasteMsg = "";
  let pasteTimer: ReturnType<typeof setTimeout> | undefined;

  /** R4：从系统剪贴板读 Key 填入输入框。Electron 渲染进程 clipboard 权限受限或
   * 剪贴板为空时给行内提示，引导用户手动 Ctrl+V。 */
  async function pasteFromClipboard() {
    try {
      const text = (await navigator.clipboard?.readText())?.trim() || "";
      if (!text) {
        showPasteMsg("剪贴板为空");
        return;
      }
      onChange(item.key, text);
      showPasteMsg("已从剪贴板导入 ✓");
    } catch {
      showPasteMsg("无法读取剪贴板，请手动粘贴");
    }
  }
  function showPasteMsg(msg: string) {
    pasteMsg = msg;
    if (pasteTimer) clearTimeout(pasteTimer);
    pasteTimer = setTimeout(() => (pasteMsg = ""), 2500);
  }

  // 模板禁 `as` 断言 → 类型收窄放到 script 函数里
  function onText(e: Event) {
    const el = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
    onChange(item.key, el.value);
  }
  function onNum(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const n = parseFloat(el.value);
    onChange(item.key, Number.isFinite(n) ? n : 0);
  }
  function onRange(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    onChange(item.key, parseFloat(el.value));
  }

  function showVal(v: any): string {
    if (v == null || v === "") return "";
    return String(v);
  }
  function numVal(v: any): number {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  function rangeVal(v: any): number {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : (item.min ?? 0);
  }
</script>

<div class="hiword-ai-setting-group">
  {#if item.type === "switch"}
    <div class="hiword-ai-setting-row">
      <RWSwitch
        label=""
        checked={!!value}
        {disabled}
        onChange={(v) => onChange(item.key, v)}
      />
      <span class="ais-inline-title">{item.title}</span>
      {#if item.wired !== "yes"}
        <span class="ais-badge" data-wired={item.wired}>
          {item.wired === "partial" ? "🟡 待接线" : "🔵 规划中"}
        </span>
      {/if}
    </div>
    {#if item.desc}<div class="hiword-ai-setting-desc">{item.desc}</div>{/if}
    {#if item.todoNote}<div class="ais-note" data-wired={item.wired}>{item.todoNote}</div>{/if}

  {:else if item.type === "hint"}
    <div class="hiword-ai-setting-label">
      <span class="hiword-ai-setting-name">{item.title}</span>
    </div>
    <div class="ais-hint">{item.text}</div>

  {:else if item.type === "actions"}
    <div class="hiword-ai-setting-label">
      <span class="hiword-ai-setting-name">{item.title}</span>
      {#if item.desc}<span class="hiword-ai-setting-desc">{item.desc}</span>{/if}
    </div>
    <div class="ais-actions">
      {#each item.buttons || [] as b}
        <button
          class="b3-button {b.variant === 'primary' ? 'b3-button--primary' : 'b3-button--outline'}"
          on:click={() => onAction(b.action)}
        >{b.label}</button>
      {/each}
      <span class="ais-action-msg" class:is-ok={msgKind === "ok"} class:is-err={msgKind === "error"}>{msg}</span>
    </div>

  {:else}
    <div class="hiword-ai-setting-label">
      <span class="hiword-ai-setting-name">
        {item.title}
        {#if item.wired !== "yes"}
          <span class="ais-badge" data-wired={item.wired}>
            {item.wired === "partial" ? "🟡 待接线" : "🔵 规划中"}
          </span>
        {/if}
      </span>
      {#if item.desc}<span class="hiword-ai-setting-desc">{item.desc}</span>{/if}
    </div>

    {#if item.type === "password"}
      <div class="hiword-ai-field">
        <div class="hiword-ai-input-wrap">
          <input
            class="hiword-ai-input"
            type={revealed ? "text" : "password"}
            value={showVal(value)}
            placeholder={item.placeholder || ""}
            {disabled}
            spellcheck="false"
            on:input={onText}
          />
          <!-- R4：📋 一键导入剪贴板中的密钥（失败行内提示，不打断输入） -->
          <button
            class="hiword-ai-icon-btn"
            type="button"
            title="从剪贴板导入"
            {disabled}
            on:click={pasteFromClipboard}
          >📋</button>
          <button
            class="hiword-ai-icon-btn"
            type="button"
            title={revealed ? "隐藏" : "显示"}
            {disabled}
            on:click={() => (revealed = !revealed)}
          >{revealed ? "🙈" : "👁"}</button>
        </div>
        {#if pasteMsg}<div class="ais-paste-msg">{pasteMsg}</div>{/if}
        <!-- R4：密钥仅存本地的固定提示（所有密码类输入统一显示，防外泄） -->
        <div class="ais-local-only">🔒 密钥仅保存在本机思源笔记数据目录，不会上传到任何服务器；分享配置或截图时请注意外泄。</div>
      </div>

    {:else if item.type === "text"}
      <div class="hiword-ai-field">
        <input
          class="hiword-ai-input"
          type="text"
          value={showVal(value)}
          placeholder={item.placeholder || ""}
          {disabled}
          spellcheck="false"
          on:input={onText}
        />
      </div>

    {:else if item.type === "number"}
      <div class="hiword-ai-field">
        <input
          class="hiword-ai-input"
          type="number"
          min={item.min}
          max={item.max}
          step={item.step ?? 1}
          value={numVal(value)}
          {disabled}
          on:input={onNum}
        />
        {#if item.unit}<span class="ais-unit">{item.unit}</span>{/if}
      </div>

    {:else if item.type === "range"}
      <div class="hiword-ai-field">
        <input
          class="hiword-ai-slider"
          type="range"
          min={item.min ?? 0}
          max={item.max ?? 100}
          step={item.step ?? 1}
          value={rangeVal(value)}
          {disabled}
          on:input={onRange}
        />
        <span class="ais-range-val">{rangeVal(value)}</span>
      </div>

    {:else if item.type === "select"}
      <div class="hiword-ai-field">
        <RWSelect
          options={item.options || []}
          value={showVal(value)}
          {disabled}
          onChange={(v) => onChange(item.key, v)}
        />
      </div>

    {:else if item.type === "textarea"}
      <textarea
        class="hiword-ai-setting-textarea"
        rows={item.rows || 4}
        placeholder={item.placeholder || ""}
        {disabled}
        spellcheck="false"
        on:input={onText}
      >{showVal(value)}</textarea>

    {:else if item.type === "readonly"}
      <textarea
        class="hiword-ai-setting-textarea ais-readonly"
        rows={item.rows || 4}
        readonly
        disabled
        spellcheck="false"
      >{showVal(value)}</textarea>
    {/if}

    {#if item.todoNote}<div class="ais-note" data-wired={item.wired}>{item.todoNote}</div>{/if}
  {/if}
</div>

<style>
  .ais-inline-title {
    font-size: 13px;
    color: var(--b3-theme-on-background);
  }

  .ais-badge {
    margin-left: 6px;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 8px;
    white-space: nowrap;
    vertical-align: middle;
  }
  .ais-badge[data-wired="partial"] {
    color: var(--b3-theme-warning);
    background: var(--b3-theme-surface-lighter);
  }
  .ais-badge[data-wired="planned"] {
    color: var(--b3-theme-primary);
    background: var(--b3-theme-surface-lighter);
  }

  .ais-note {
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.5;
    opacity: 0.85;
  }
  .ais-note[data-wired="partial"] {
    color: var(--b3-theme-warning);
  }
  .ais-note[data-wired="planned"] {
    color: var(--b3-theme-primary);
  }

  .ais-hint {
    font-size: 12px;
    line-height: 1.6;
    color: var(--b3-theme-on-surface-light, #888);
    padding: 6px 8px;
    border-left: 2px solid var(--b3-theme-primary);
    background: var(--b3-theme-surface-lighter);
    border-radius: 2px;
  }

  .ais-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .ais-action-msg {
    font-size: 12px;
    color: var(--b3-theme-on-surface-light, #888);
  }
  .ais-action-msg.is-ok { color: var(--b3-theme-success, #2e7d32); }
  .ais-action-msg.is-err { color: var(--b3-theme-error, #e00); }

  .ais-unit {
    margin-left: 6px;
    font-size: 12px;
    opacity: 0.7;
  }

  .ais-range-val {
    margin-left: 8px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
  }

  .ais-readonly {
    opacity: 0.7;
    cursor: not-allowed;
  }

  /* R4：剪贴板导入的行内反馈 + 密钥仅存本地固定提示 */
  .ais-paste-msg {
    margin-top: 3px;
    font-size: 11px;
    color: var(--b3-theme-primary, #4285f4);
  }
  .ais-local-only {
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.5;
    opacity: 0.65;
  }
</style>
