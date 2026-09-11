<!--
  PDF 界面专属设置分区（2026-09-02 从 ReaderView.svelte 拆出）

  仅在 PDF 模式注入：「视图模式 / 滚动方向 / 反色」。
  与它互斥的是图书界面的「文本设置 / 段落设置 / 朗读设置」——那三项对固定版式 PDF 无效。

  设置值仍由 ReaderView 通过 settingsStore 统一持久化，本组件只发回调。
-->
<script lang="ts">
  import { t } from "../i18n/index.ts";
  import type { ReaderSettings } from "./reader-settings";

  export let settings: ReaderSettings;
  /** 当前翻页流模式；滚动方向只在 scrolled 下有意义 */
  export let flow: string = "paginated";
  export let onSetPdfViewMode: (key: string) => void = () => {};
  export let onSetPdfScrollDir: (key: string) => void = () => {};
  export let onSetPdfInvert: (e: Event) => void = () => {};
  /** 2026-09-04 P2：PDF 文本标注类型开关回调 */
  export let onSetPdfAnnotHighlight: (e: Event) => void = () => {};
  export let onSetPdfAnnotUnderline: (e: Event) => void = () => {};
  export let onSetPdfAnnotAnnotate: (e: Event) => void = () => {};
</script>

<details class="reader-setting-section">
  <summary class="reader-setting-section-title">📄 {t("PDF 显示")}</summary>

  <!-- 视图模式：单页 / 双页 / 书籍（映射 foliate spread） -->
  <div class="reader-setting-row">
    <span class="reader-setting-label">{t("视图模式")}</span>
    <div class="reader-setting-control">
      {#each [["single", "单页"], ["double", "双页"], ["book", "书籍"]] as [key, label]}
        <button
          class="reader-seg"
          class:reader-seg-active={(settings.pdfViewMode ?? "single") === key}
          on:click={() => onSetPdfViewMode(key)}
        >{t(label)}</button>
      {/each}
    </div>
  </div>

  <!-- 滚动方向：仅「滚动」模式生效（映射 foliate scroll-direction） -->
  {#if flow === "scrolled"}
  <div class="reader-setting-row">
    <span class="reader-setting-label">{t("滚动方向")}</span>
    <div class="reader-setting-control">
      {#each [["vertical", "垂直"], ["horizontal", "水平"]] as [key, label]}
        <button
          class="reader-seg"
          class:reader-seg-active={(settings.pdfScrollDir ?? "vertical") === key}
          on:click={() => onSetPdfScrollDir(key)}
        >{t(label)}</button>
      {/each}
    </div>
  </div>
  {/if}

  <!-- 反色 / 暗色：PDF 画布级 pageColors 反色，独立于阅读器通用主题 -->
  <div class="reader-setting-row reader-setting-toggle-row">
    <span class="reader-setting-label">{t("反色 / 暗色")}</span>
    <label class="reader-switch" title={t("PDF 画布级反色（黑底白字），独立于阅读器主题")}>
      <input
        type="checkbox"
        checked={!!settings.pdfInvert}
        on:change={onSetPdfInvert}
      />
      <span class="reader-switch-track"></span>
    </label>
  </div>

  <!-- 2026-09-04 P2：PDF 文本标注类型开关（精简聚焦：高亮 / 下划线 / 批注） -->
  <div class="reader-setting-subtitle">{t("标注类型")}</div>
  <div class="reader-setting-row reader-setting-toggle-row">
    <span class="reader-setting-label">{t("高亮（背景）")}</span>
    <label class="reader-switch" title={t("允许在 PDF 上做背景高亮标注")}>
      <input type="checkbox" checked={!!settings.pdfAnnotHighlight} on:change={onSetPdfAnnotHighlight} />
      <span class="reader-switch-track"></span>
    </label>
  </div>
  <div class="reader-setting-row reader-setting-toggle-row">
    <span class="reader-setting-label">{t("下划线 / 波浪线")}</span>
    <label class="reader-switch" title={t("允许在 PDF 上做直线段 / 波浪线下划线标注")}>
      <input type="checkbox" checked={!!settings.pdfAnnotUnderline} on:change={onSetPdfAnnotUnderline} />
      <span class="reader-switch-track"></span>
    </label>
  </div>
  <div class="reader-setting-row reader-setting-toggle-row">
    <span class="reader-setting-label">{t("批注（气泡）")}</span>
    <label class="reader-switch" title={t("允许在 PDF 上做带批注内容的气泡")}>
      <input type="checkbox" checked={!!settings.pdfAnnotAnnotate} on:change={onSetPdfAnnotAnnotate} />
      <span class="reader-switch-track"></span>
    </label>
  </div>
</details>
