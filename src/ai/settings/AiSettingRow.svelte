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
   *
   * 2026-09-15 视觉重排：
   *  - 行布局从「标题在上、控件在下」改为「左标签右控件」两列（textarea/readonly 仍纵向整行）；
   *  - 图标全部 emoji → currentColor 内联 SVG（剪贴板 / 显隐 / 本地锁 / 徽标圆点）；
   *  - 徽标用 SVG/CSS 圆点 + 文字，不再带固定色 emoji。
   */
  import RWSwitch from "../../ui/controls/RWSwitch.svelte";
  import RWSelect from "../../ui/controls/RWSelect.svelte";
  import type { SettingItem } from "./ai-settings-items.ts";
  // 2026-09-10 多语言：中文原文即 key，渲染时查表替换（见 src/i18n/index.ts 文件头）
  import { t } from "../../i18n/index.ts";

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

  /* 2026-09-15：currentColor SVG 图标映射（替代固定色 emoji，跟随主题明暗/主色） */
  const ICONS: Record<string, string> = {
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3.5 8 10 8a9.74 9.74 0 0 0 5.39-1.61"/><path d="M2 2l20 20"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  };
  function iconSvg(n: string): string {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
  }

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
      <div class="hiword-ai-setting-grow">
        <span class="hiword-ai-setting-name">
          {t(item.title)}
          {#if item.wired !== "yes"}
            <span class="ais-badge" data-wired={item.wired}>
              <span class="ais-badge-dot"></span>{item.wired === "partial" ? t("待接线") : t("规划中")}
            </span>
          {/if}
        </span>
        {#if item.desc}<div class="hiword-ai-setting-desc">{t(item.desc || "")}</div>{/if}
        {#if item.todoNote}<div class="ais-note" data-wired={item.wired}>{t(item.todoNote || "")}</div>{/if}
      </div>
      <div class="hiword-ai-setting-ctrl">
        <RWSwitch
          label=""
          checked={!!value}
          {disabled}
          onChange={(v) => onChange(item.key, v)}
        />
      </div>
    </div>

  {:else if item.type === "hint"}
    <div class="hiword-ai-setting-label">
      <span class="hiword-ai-setting-name">{item.title}</span>
    </div>
    <div class="ais-hint">{t(item.text || "")}</div>

  {:else if item.type === "actions"}
    <div class="hiword-ai-setting-row">
      <div class="hiword-ai-setting-grow">
        <span class="hiword-ai-setting-name">{t(item.title)}</span>
        {#if item.desc}<div class="hiword-ai-setting-desc">{t(item.desc || "")}</div>{/if}
      </div>
      <div class="hiword-ai-setting-ctrl">
        <div class="ais-actions">
          {#each item.buttons || [] as b}
            <button
              class="b3-button {b.variant === 'primary' ? 'b3-button--primary' : 'b3-button--outline'}"
              on:click={() => onAction(b.action)}
            >{t(b.label)}</button>
          {/each}
          <span class="ais-action-msg" class:is-ok={msgKind === "ok"} class:is-err={msgKind === "error"}>{msg}</span>
        </div>
      </div>
    </div>

  {:else if item.type === "textarea" || item.type === "readonly"}
    <!-- 文本域 / 只读：纵向整行（提示词编辑等长内容不适合两列挤压） -->
    <div class="hiword-ai-setting-row col">
      <div class="hiword-ai-setting-grow">
        <span class="hiword-ai-setting-name">
          {t(item.title)}
          {#if item.wired !== "yes"}
            <span class="ais-badge" data-wired={item.wired}>
              <span class="ais-badge-dot"></span>{item.wired === "partial" ? t("待接线") : t("规划中")}
            </span>
          {/if}
        </span>
        {#if item.desc}<div class="hiword-ai-setting-desc">{t(item.desc || "")}</div>{/if}
      </div>
      {#if item.type === "readonly"}
        <textarea
          class="hiword-ai-setting-textarea ais-readonly"
          rows={item.rows || 4}
          readonly
          disabled
          spellcheck="false"
        >{showVal(value)}</textarea>
      {:else}
        <textarea
          class="hiword-ai-setting-textarea"
          rows={item.rows || 4}
          placeholder={t(item.placeholder || "")}
          {disabled}
          spellcheck="false"
          on:input={onText}
        >{showVal(value)}</textarea>
      {/if}
    </div>
    {#if item.todoNote}<div class="ais-note" data-wired={item.wired}>{t(item.todoNote || "")}</div>{/if}

  {:else}
    <!-- 其余类型：经典两列 —— 左标签（名称+徽标+说明）右控件 -->
    <div class="hiword-ai-setting-row">
      <div class="hiword-ai-setting-grow">
        <span class="hiword-ai-setting-name">
          {t(item.title)}
          {#if item.wired !== "yes"}
            <span class="ais-badge" data-wired={item.wired}>
              <span class="ais-badge-dot"></span>{item.wired === "partial" ? t("待接线") : t("规划中")}
            </span>
          {/if}
        </span>
        {#if item.desc}<div class="hiword-ai-setting-desc">{t(item.desc || "")}</div>{/if}
      </div>

      <div class="hiword-ai-setting-ctrl">
        {#if item.type === "password"}
          <div class="hiword-ai-input-wrap">
            <input
              class="hiword-ai-input"
              type={revealed ? "text" : "password"}
              value={showVal(value)}
              placeholder={t(item.placeholder || "")}
              {disabled}
              spellcheck="false"
              on:input={onText}
            />
            <!-- R4：📋 一键导入剪贴板中的密钥（失败行内提示，不打断输入） -->
            <button
              class="hiword-ai-icon-btn"
              type="button"
              title={t("从剪贴板导入")}
              {disabled}
              on:click={pasteFromClipboard}
            >{@html iconSvg("copy")}</button>
            <button
              class="hiword-ai-icon-btn"
              type="button"
              title={revealed ? t("隐藏") : t("显示")}
              {disabled}
              on:click={() => (revealed = !revealed)}
            >{@html revealed ? iconSvg("eyeOff") : iconSvg("eye")}</button>
          </div>
          {#if pasteMsg}<div class="ais-paste-msg">{pasteMsg}</div>{/if}
          <!-- R4：密钥仅存本地的固定提示（所有密码类输入统一显示，防外泄） -->
          <div class="ais-local-only">{@html iconSvg("lock")}<span>{t("密钥仅保存在本机思源笔记数据目录，不会上传到任何服务器；分享配置或截图时请注意外泄。")}</span></div>

        {:else if item.type === "text"}
          <div class="hiword-ai-input-wrap">
            <input
              class="hiword-ai-input"
              type="text"
              value={showVal(value)}
              placeholder={t(item.placeholder || "")}
              {disabled}
              spellcheck="false"
              on:input={onText}
            />
          </div>

        {:else if item.type === "number"}
          <div class="hiword-ai-input-wrap">
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
          <div class="ais-range">
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
          <div class="hiword-ai-input-wrap">
            <RWSelect
              options={(item.options || []).map((o) => ({ ...o, label: t(o.label) }))}
              value={showVal(value)}
              {disabled}
              onChange={(v) => onChange(item.key, v)}
            />
          </div>
        {/if}
      </div>
    </div>
    {#if item.todoNote}<div class="ais-note" data-wired={item.wired}>{t(item.todoNote || "")}</div>{/if}
  {/if}
</div>

<style>
  /* 2026-09-15：徽标 = CSS 圆点 + 文字（圆点用 currentColor，替代固定色 emoji） */
  .ais-badge {
    margin-left: 6px;
    font-size: 11px;
    padding: 1px 8px 1px 6px;
    border-radius: 99px;
    white-space: nowrap;
    vertical-align: middle;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .ais-badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
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
    justify-content: flex-end;
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
    white-space: nowrap;
  }

  /* 2026-09-15：range 行内滑块 + 值，右对齐 */
  .ais-range {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .ais-range-val {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    min-width: 30px;
    text-align: right;
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
    margin-top: 5px;
    font-size: 11px;
    line-height: 1.5;
    opacity: 0.65;
    display: flex;
    align-items: flex-start;
    gap: 5px;
    max-width: 420px;
  }
  .ais-local-only :global(svg) {
    width: 11px;
    height: 11px;
    flex-shrink: 0;
    margin-top: 1px;
  }
</style>
