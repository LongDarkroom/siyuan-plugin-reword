<script lang="ts">
  /**
   * 阅读器 - 书架面板
   * 封面（EPUB 真实封面 / 占位）、导入（多选 + 拖拽 + 批量进度 + 去重 + 失败汇总重试）、
   * 续读、删除、编辑信息（书名/作者）。
   */
  import { onMount } from "svelte";
  import type { BookshelfStore, BookMeta } from "../reader/bookshelf-store";
  import { isSupportedBookFile } from "../reader/book-adapters";

  export let store: BookshelfStore;
  export let onOpen: (bookId: string) => void;

  let books: BookMeta[] = [];
  let fileInput: HTMLInputElement;
  let importing = false;
  let importError = "";
  let coverUrls: Record<string, string> = {};

  // 批量导入状态
  let importDone = 0;
  let importTotal = 0;
  let currentName = "";
  let importSkipped = 0;
  let toast = "";

  // 拖拽状态
  let dragCounter = 0;
  let dragging = false;

  // 失败汇总（file 供重试）
  interface ImportFail {
    name: string;
    reason: string;
    file: File;
  }
  let fails: ImportFail[] = [];

  // 编辑信息弹窗
  let editTarget: BookMeta | null = null;
  let editTitle = "";
  let editAuthor = "";

  // 删除确认弹窗（默认保留源文件）
  let removeTarget: BookMeta | null = null;
  let removeWithFile = false;

  const ACCEPT = ".epub,.mobi,.azw3,.fb2,.cbz,.txt,.md,.markdown";
  const MB = 1024 * 1024;

  function fmtSize(n: number): string {
    return n >= MB ? `${(n / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  }

  async function refresh() {
    await store.load();
    books = store.list;
    // 加载真实封面（EPUB 提取；TXT/MD 无封面保持首字占位）
    for (const b of books) {
      if (!b.cover || coverUrls[b.id]) continue;
      store
        .getCoverBlob(b.id)
        .then((blob) => {
          if (blob) {
            coverUrls = { ...coverUrls, [b.id]: URL.createObjectURL(blob) };
          }
        })
        .catch(() => {});
    }
  }

  function fmtDate(t: number | undefined): string {
    if (!t) return "";
    const d = new Date(t);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function fmtPct(frac: number | undefined): string {
    if (typeof frac !== "number" || !isFinite(frac)) return "未读";
    return `${Math.min(100, Math.round(frac * 100))}%`;
  }

  function showToast(msg: string, ms = 3200) {
    toast = msg;
    setTimeout(() => {
      if (toast === msg) toast = "";
    }, ms);
  }

  /** 批量导入核心（文件列表 → 逐本导入，推进进度） */
  async function runImport(files: File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    importing = true;
    importError = "";
    importDone = 0;
    importTotal = list.length;
    importSkipped = 0;
    fails = [];
    for (const f of list) {
      currentName = f.name;
      if (!isSupportedBookFile(f.name)) {
        fails.push({ name: f.name, reason: "不支持的文件类型", file: f });
        importDone++;
        continue;
      }
      try {
        const meta = await store.importBook(f);
        if (!meta) {
          importSkipped++;
        }
      } catch (e: any) {
        fails.push({ name: f.name, reason: e?.message || String(e), file: f });
      }
      importDone++;
    }
    importing = false;
    currentName = "";
    fileInput.value = "";
    await refresh();
    const ok = importTotal - importSkipped - fails.length;
    const parts: string[] = [];
    if (ok > 0) parts.push(`导入 ${ok} 本`);
    if (importSkipped > 0) parts.push(`跳过重复 ${importSkipped} 本`);
    if (fails.length) {
      showToast(`${parts.join("，")}，失败 ${fails.length} 本`);
    } else if (parts.length) {
      showToast(parts.join("，"));
    }
  }

  function onFileChosen() {
    const files = fileInput?.files;
    if (!files || !files.length) return;
    void runImport(Array.from(files));
  }

  /** 失败项重试 */
  function retryFails() {
    const retryFiles = fails.map((f) => f.file);
    fails = [];
    void runImport(retryFiles);
  }

  /* ================= 拖拽导入 ================= */

  function onDragEnter(e: DragEvent) {
    if (e.dataTransfer?.types?.includes("Files")) {
      dragCounter++;
      dragging = true;
    }
  }

  function onDragOver(e: DragEvent) {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function onDragLeave(e: DragEvent) {
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) dragging = false;
    void e;
  }

  function onDrop(e: DragEvent) {
    dragCounter = 0;
    dragging = false;
    const files = e.dataTransfer?.files;
    if (files && files.length) {
      e.preventDefault();
      void runImport(Array.from(files));
    }
  }

  /* ================= 编辑信息 ================= */

  function openEdit(b: BookMeta) {
    editTarget = b;
    editTitle = b.title;
    editAuthor = b.author || "";
  }

  async function saveEdit() {
    if (!editTarget) return;
    const id = editTarget.id;
    const ok = await store.updateMeta(id, { title: editTitle, author: editAuthor });
    editTarget = null;
    if (ok) {
      showToast("已保存");
      await refresh();
    } else {
      showToast("保存失败");
    }
  }

  function openRemove(b: BookMeta) {
    removeTarget = b;
    removeWithFile = false;
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    const b = removeTarget;
    removeTarget = null;
    try {
      await store.removeBook(b.id, { deleteFile: removeWithFile });
      showToast(removeWithFile ? `已删除《${b.title}》及源文件` : `已从书架移除《${b.title}》（源文件保留）`);
      await refresh();
    } catch {
      showToast("删除失败");
    }
  }

  function fmtTime(ms: number | undefined): string {
    if (!ms || ms < 60000) return "";
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h${m}m` : `${h}h`;
  }

  onMount(() => {
    void refresh();
  });
</script>

<div
  class="bookshelf-view"
  class:dragging
  on:dragenter={onDragEnter}
  on:dragover={onDragOver}
  on:dragleave={onDragLeave}
  on:drop={onDrop}
>
  <div class="bookshelf-header">
    <span class="bookshelf-title">书架</span>
    <span class="bookshelf-count">{books.length} 本</span>
    <span class="bookshelf-spacer"></span>
    <button
      class="bookshelf-import-btn"
      disabled={importing}
      on:click={() => fileInput?.click()}
    >
      {importing ? "导入中…" : "+ 导入"}
    </button>
    <input
      bind:this={fileInput}
      type="file"
      accept={ACCEPT}
      multiple
      style="display:none"
      on:change={onFileChosen}
    />
  </div>

  {#if importError}
    <div class="bookshelf-error">{importError}</div>
  {/if}

  {#if dragging}
    <div class="bookshelf-dropzone">
      <div class="bookshelf-dropzone-inner">
        <div class="bookshelf-dropzone-icon">📥</div>
        <div>松开导入书籍</div>
        <div class="bookshelf-dropzone-hint">支持 EPUB / MOBI / AZW3 / FB2 / CBZ / TXT / Markdown</div>
      </div>
    </div>
  {/if}

  {#if importing}
    <div class="import-progress">
      <div class="import-progress-text">
        <span>导入中 {importDone}/{importTotal}</span>
        <span class="import-progress-name">{currentName}</span>
      </div>
      <div class="import-progress-track">
        <div
          class="import-progress-bar"
          style="width:{importTotal ? (importDone / importTotal) * 100 : 0}%"
        ></div>
      </div>
    </div>
  {/if}

  {#if toast}
    <div class="import-toast">{toast}</div>
  {/if}

  <div class="bookshelf-grid">
    {#each books as book (book.id)}
      <div class="book-card">
        <button class="book-cover" on:click={() => onOpen(book.id)}>
          {#if coverUrls[book.id]}
            <img class="book-cover-img" src={coverUrls[book.id]} alt={book.title} />
          {:else}
            <span class="book-cover-text">{book.title.slice(0, 2)}</span>
          {/if}
          <span class="book-format">{book.format.toUpperCase()}</span>
        </button>
        <div class="book-info">
          <div class="book-name" title={book.title}>{book.title}</div>
          <div class="book-author-row">
            <span class="book-author" title={book.author || ""}>
              {book.author ? book.author : "未知作者"}
            </span>
            {#if fmtTime(book.readingTimeMs)}
              <span class="book-readtime">{fmtTime(book.readingTimeMs)}</span>
            {/if}
          </div>
          <div class="book-meta">
            <span>{fmtPct(book.progress?.fraction)}</span>
            <span class="book-date">{fmtDate(book.lastReadAt ?? book.addedAt)}</span>
          </div>
        </div>
        <div class="book-actions">
          <button class="book-btn primary" on:click={() => onOpen(book.id)}>
            {book.progress?.fraction ? "续读" : "开始"}
          </button>
          <button class="book-btn" on:click={() => openEdit(book)}>编辑</button>
          <button class="book-btn danger" on:click={() => openRemove(book)}>删除</button>
        </div>
      </div>
    {:else}
      <div class="bookshelf-empty">
        <div class="bookshelf-empty-title">书架是空的</div>
        <div class="bookshelf-empty-hint">支持 EPUB / MOBI / AZW3 / FB2 / CBZ / TXT / Markdown</div>
        <div class="bookshelf-empty-hint">直接拖拽文件到这里，或点击下方按钮</div>
        <button class="bookshelf-import-btn" on:click={() => fileInput?.click()}>导入第一本书</button>
      </div>
    {/each}
  </div>

  {#if fails.length}
    <div class="import-fail-mask">
      <div class="import-fail-panel">
        <div class="import-fail-title">导入失败 {fails.length} 本</div>
        <div class="import-fail-list">
          {#each fails as f}
            <div class="import-fail-item">
              <span class="import-fail-name" title={f.name}>{f.name}</span>
              <span class="import-fail-reason">{f.reason}</span>
            </div>
          {/each}
        </div>
        <div class="import-fail-actions">
          <button class="bookshelf-import-btn" on:click={retryFails}>重试失败项</button>
          <button class="import-fail-close" on:click={() => (fails = [])}>关闭</button>
        </div>
      </div>
    </div>
  {/if}

  {#if removeTarget}
    <div class="edit-mask" on:click|self={() => (removeTarget = null)}>
      <div class="edit-panel">
        <div class="edit-title">从书架移除</div>
        <div class="remove-desc">确定将《{removeTarget.title}》从书架移除？</div>
        <label class="remove-check">
          <input type="checkbox" bind:checked={removeWithFile} />
          <span>同时删除插件目录中的源文件（不可恢复）</span>
        </label>
        <div class="edit-actions">
          <button class="bookshelf-import-btn remove-danger" on:click={confirmRemove}>移除</button>
          <button class="import-fail-close" on:click={() => (removeTarget = null)}>取消</button>
        </div>
      </div>
    </div>
  {/if}

  {#if editTarget}
    <div class="edit-mask" on:click|self={() => (editTarget = null)}>
      <div class="edit-panel">
        <div class="edit-title">编辑书籍信息</div>
        <label class="edit-field">
          <span>书名</span>
          <input bind:value={editTitle} placeholder="书名" />
        </label>
        <label class="edit-field">
          <span>作者</span>
          <input bind:value={editAuthor} placeholder="作者" />
        </label>
        <div class="edit-actions">
          <button class="bookshelf-import-btn" on:click={saveEdit}>保存</button>
          <button class="import-fail-close" on:click={() => (editTarget = null)}>取消</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .bookshelf-view {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .bookshelf-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.1));
    flex-shrink: 0;
  }
  .bookshelf-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--b3-theme-on-background, #333);
  }
  .bookshelf-count {
    font-size: 12px;
    color: var(--b3-theme-on-surface-light, #888);
  }
  .bookshelf-spacer {
    flex: 1;
  }
  .bookshelf-import-btn {
    background: var(--b3-theme-primary, #378add);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 13px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .bookshelf-import-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .bookshelf-error {
    padding: 6px 12px;
    font-size: 12px;
    color: var(--b3-theme-error, #e24b4a);
    white-space: pre-wrap;
    background: var(--b3-theme-error-light, rgba(226, 75, 74, 0.08));
    border-bottom: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.1));
  }
  /* 拖拽高亮遮罩 */
  .bookshelf-view.dragging .bookshelf-dropzone {
    position: absolute;
    inset: 6px;
    z-index: 30;
    border: 2px dashed var(--b3-theme-primary, #378add);
    border-radius: 12px;
    background: rgba(55, 138, 221, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .bookshelf-dropzone-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 500;
    color: var(--b3-theme-primary, #378add);
  }
  .bookshelf-dropzone-icon {
    font-size: 34px;
  }
  .bookshelf-dropzone-hint {
    font-size: 12px;
    font-weight: 400;
    color: var(--b3-theme-on-surface-light, #888);
  }
  /* 批量进度条 */
  .import-progress {
    padding: 8px 12px;
    border-bottom: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
    flex-shrink: 0;
  }
  .import-progress-text {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
    color: var(--b3-theme-on-background, #333);
    margin-bottom: 6px;
  }
  .import-progress-name {
    color: var(--b3-theme-on-surface-light, #888);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .import-progress-track {
    height: 5px;
    border-radius: 3px;
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.08));
    overflow: hidden;
  }
  .import-progress-bar {
    height: 100%;
    border-radius: 3px;
    background: var(--b3-theme-primary, #378add);
    transition: width 0.2s;
  }
  /* toast */
  .import-toast {
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    background: rgba(30, 30, 30, 0.92);
    color: #fff;
    font-size: 12px;
    padding: 6px 14px;
    border-radius: 8px;
    z-index: 40;
    white-space: nowrap;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
  }
  .bookshelf-grid {
    flex: 1;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
    gap: 12px;
    padding: 12px;
    align-content: start;
  }
  .book-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .book-cover {
    position: relative;
    aspect-ratio: 3 / 4;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    background: linear-gradient(160deg, #185fa5, #0c447c);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .book-cover-text {
    font-size: 22px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.92);
  }
  .book-cover-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .book-format {
    position: absolute;
    bottom: 5px;
    right: 6px;
    font-size: 9px;
    color: rgba(255, 255, 255, 0.75);
    background: rgba(0, 0, 0, 0.25);
    padding: 1px 5px;
    border-radius: 4px;
  }
  .book-info {
    min-width: 0;
  }
  .book-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--b3-theme-on-background, #333);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .book-author-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
  }
  .book-author {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .book-readtime {
    font-size: 10px;
    color: var(--b3-theme-primary, #378add);
    flex-shrink: 0;
  }
  .book-meta {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
  }
  .book-actions {
    display: flex;
    gap: 4px;
  }
  .book-btn {
    flex: 1;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    background: none;
    border-radius: 6px;
    padding: 4px 0;
    font-size: 12px;
    cursor: pointer;
    color: var(--b3-theme-on-background, #333);
  }
  .book-btn.primary {
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.12));
    border-color: transparent;
    color: var(--b3-theme-primary, #378add);
  }
  .book-btn.danger {
    color: var(--b3-theme-error, #e24b4a);
  }
  .book-btn:hover {
    filter: brightness(0.94);
  }
  .bookshelf-empty {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 48px 0;
  }
  .bookshelf-empty-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--b3-theme-on-background, #333);
  }
  .bookshelf-empty-hint {
    font-size: 12px;
    color: var(--b3-theme-on-surface-light, #888);
    text-align: center;
  }
  /* 失败汇总 */
  .import-fail-mask,
  .edit-mask {
    position: absolute;
    inset: 0;
    z-index: 50;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .import-fail-panel,
  .edit-panel {
    width: min(320px, 88%);
    max-height: 80%;
    background: var(--b3-theme-background, #fff);
    border-radius: 10px;
    padding: 14px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .import-fail-title,
  .edit-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--b3-theme-on-background, #333);
  }
  .import-fail-list {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 240px;
  }
  .import-fail-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.04));
    border-radius: 6px;
    padding: 6px 8px;
  }
  .import-fail-name {
    font-size: 12px;
    color: var(--b3-theme-on-background, #333);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .import-fail-reason {
    font-size: 11px;
    color: var(--b3-theme-error, #e24b4a);
  }
  .import-fail-actions,
  .edit-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .import-fail-close {
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    background: none;
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 13px;
    cursor: pointer;
    color: var(--b3-theme-on-background, #333);
  }
  .remove-desc {
    font-size: 13px;
    color: var(--b3-theme-on-background, #333);
  }
  .remove-check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--b3-theme-on-surface-light, #888);
    cursor: pointer;
    user-select: none;
  }
  .remove-check input {
    accent-color: var(--b3-theme-error, #e24b4a);
  }
  .remove-danger {
    background: var(--b3-theme-error, #e24b4a);
  }
  .edit-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--b3-theme-on-surface-light, #888);
  }
  .edit-field input {
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 13px;
    background: var(--b3-theme-background, #fff);
    color: var(--b3-theme-on-background, #333);
    outline: none;
  }
  .edit-field input:focus {
    border-color: var(--b3-theme-primary, #378add);
  }
</style>
