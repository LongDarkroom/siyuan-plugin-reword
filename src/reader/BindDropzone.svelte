<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { getDocInfo } from "../siyuan/filetree.ts";

  /** 当前绑定的文档信息（用于展示，由父组件传入） */
  export let label = "目标文档";
  export let docId = "";
  export let docTitle = "";
  export let notebookId = "";

  const dispatch = createEventDispatcher<{
    bind: { docId: string; title: string; notebookId: string };
    clear: void;
  }>();

  let dragOver = false;
  let pasteId = "";
  let resolving = false;
  let errMsg = "";

  // 思源笔记文档树拖拽写入 dataTransfer 的 MIME 类型（常量名 Constants.SIYUAN_DROP_FILE）
  const SIYUAN_DROP_FILE = "application/siyuan-file";

  /** 从任意文本中解析出标准思源文档 ID（支持直接粘贴 ID 或 siyuan://blocks/xxxx 链接） */
  function extractDocId(raw: string): string {
    const s = (raw || "").trim();
    const m = s.match(/[0-9]{14}-[a-zA-Z0-9]{7}/);
    return m ? m[0] : s;
  }

  async function resolveAndBind(rawId: string) {
    const id = extractDocId(rawId);
    if (!id) return;
    errMsg = "";
    resolving = true;
    try {
      const info: any = await getDocInfo(id);
      // 校验返回确实对应一个存在的文档（id + 笔记本 box 必须存在）
      if (!info || !info.id || !info.box) {
        errMsg = "无法解析该文档 ID，请确认文档存在且为文档 ID。";
        return;
      }
      const title = info.name || info.title || info.hPath?.split("/").pop() || id;
      dispatch("bind", { docId: info.id, title, notebookId: info.box });
    } catch (e) {
      console.warn("[REword] 绑定文档解析失败:", e);
      errMsg = "无法解析该文档 ID，请确认文档存在。";
    } finally {
      resolving = false;
    }
  }

  function onDragOver(e: DragEvent) {
    // 仅当携带思源文档时接管拖放，避免影响其它拖拽
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes(SIYUAN_DROP_FILE)) {
      e.preventDefault();
      e.stopPropagation();
      dragOver = true;
    }
  }
  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
  }
  async function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragOver = false;
    const raw = e.dataTransfer?.getData(SIYUAN_DROP_FILE) || "";
    if (!raw) {
      errMsg = "拖入的不是思源笔记文档，请从左侧文档树拖入。";
      return;
    }
    // 思源拖拽 payload：逗号分隔的文档 data-node-id 列表，取第一个
    const firstId = raw.split(",")[0]?.trim();
    await resolveAndBind(firstId);
  }

  function onBindClick() {
    if (pasteId.trim()) resolveAndBind(pasteId);
  }

  function onClear() {
    pasteId = "";
    errMsg = "";
    dispatch("clear");
  }
</script>

<div class="bind-dropzone" class:drag-over={dragOver}>
  <div class="bind-head">
    <span class="bind-label">{label}</span>
    {#if docId}
      <span class="bind-status ok">已绑定：{docTitle || docId}</span>
    {:else}
      <span class="bind-status none">未绑定</span>
    {/if}
  </div>

  <div
    class="bind-target"
    on:dragover={onDragOver}
    on:dragleave={onDragLeave}
    on:drop={onDrop}
    role="region"
    aria-label="拖入思源笔记文档完成绑定"
  >
    {#if dragOver}
      <div class="bind-hint">松开以绑定到此文档</div>
    {:else}
      <div class="bind-hint">从左侧思源文档树拖入文档到这里</div>
    {/if}
  </div>

  <div class="bind-actions">
    <input
      class="bind-input"
      type="text"
      placeholder="粘贴文档 ID…"
      bind:value={pasteId}
      on:keydown={(e) => {
        if (e.key === "Enter") onBindClick();
      }}
    />
    <button class="bind-btn" on:click={onBindClick} disabled={resolving || !pasteId.trim()}>绑定</button>
    {#if docId}
      <button class="bind-btn bind-btn-clear" on:click={onClear}>清除</button>
    {/if}
  </div>

  {#if errMsg}
    <div class="bind-err">{errMsg}</div>
  {/if}
  {#if resolving}
    <div class="bind-err" style="color:var(--b3-theme-on-surface,#999);">解析中…</div>
  {/if}
</div>

<style>
  .bind-dropzone {
    margin: 10px 0;
    padding: 10px 12px;
    border: 1px solid var(--b3-theme-surface-lighter, #e5e5e5);
    border-radius: 8px;
    background: var(--b3-theme-background, #fafafa);
  }
  .bind-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .bind-label {
    font-weight: 600;
    font-size: 13px;
  }
  .bind-status {
    font-size: 12px;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bind-status.ok {
    color: #16a34a;
  }
  .bind-status.none {
    color: var(--b3-theme-on-surface, #999);
  }
  .bind-target {
    border: 1.5px dashed var(--b3-border-color, #c9c9c9);
    border-radius: 8px;
    padding: 14px 10px;
    text-align: center;
    color: var(--b3-theme-on-surface, #888);
    font-size: 12.5px;
    transition: background 0.15s, border-color 0.15s;
    cursor: default;
  }
  .bind-target.drag-over {
    border-color: var(--b3-theme-primary, #3b82f6);
    background: rgba(59, 130, 246, 0.08);
    color: var(--b3-theme-primary, #3b82f6);
  }
  .bind-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
    align-items: center;
  }
  .bind-input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 5px 8px;
    border: 1px solid var(--b3-border-color, #ddd);
    border-radius: 6px;
    font-size: 12.5px;
    background: var(--b3-theme-surface, #fff);
    color: var(--b3-theme-on-surface, #333);
  }
  .bind-btn {
    flex: 0 0 auto;
    padding: 5px 12px;
    border: 1px solid var(--b3-border-color, #d3d3d3);
    background: var(--b3-theme-surface, #f5f5f5);
    color: var(--b3-theme-on-surface, #333);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12.5px;
  }
  .bind-btn:hover {
    background: var(--b3-theme-surface-hover, #eaeaea);
  }
  .bind-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .bind-btn-clear {
    color: #d97706;
    border-color: rgba(217, 119, 6, 0.4);
  }
  .bind-err {
    margin-top: 6px;
    font-size: 12px;
    color: #dc2626;
  }
</style>
