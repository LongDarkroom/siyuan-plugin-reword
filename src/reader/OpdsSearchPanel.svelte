<script lang="ts">
  /**
   * OPDS 在线书源面板（B · 在线书源 / OPDS 搜书）
   * 使用 portal 挂载到 body，逃离 dock 裁剪，获得更宽的书目展示空间。
   */
  import { onMount, createEventDispatcher } from "svelte";
  import { portal } from "../utils/portal";
  import type { BookshelfStore } from "./bookshelf-store";
  import {
    BUILTIN_CATALOGS,
    fetchOpdsFeed,
    searchOpds,
    fetchImageDataUrl,
    downloadAsFile,
    type OpdsCatalog,
    type OpdsEntry,
    type OpdsFeed,
  } from "./opds-client";

  export let store: BookshelfStore;
  const dispatch = createEventDispatcher();

  const CAT_KEY = "reword-opds-catalogs";

  let catalogs: OpdsCatalog[] = [];
  let activeId = "";
  let activeCatalog: OpdsCatalog | null = null;

  let stack: { url: string; title: string }[] = [];
  let feed: OpdsFeed | null = null;
  let loading = false;
  let error = "";

  let query = "";
  let coverMap: Record<string, string> = {};
  let importingId = "";
  let toast = "";

  let showManage = false;
  let fName = "";
  let fUrl = "";
  let fAuth = "";
  let fSearch = "";

  onMount(() => {
    loadCatalogs();
  });

  function loadCatalogs() {
    let custom: OpdsCatalog[] = [];
    try {
      const raw = localStorage.getItem(CAT_KEY);
      if (raw) custom = JSON.parse(raw);
    } catch {
      // ignore
    }
    catalogs = [...BUILTIN_CATALOGS, ...custom];
    if (!activeId && catalogs.length) {
      activeId = catalogs[0].id;
      activeCatalog = catalogs[0];
    }
  }

  function saveCustom() {
    const custom = catalogs.filter((c) => !BUILTIN_CATALOGS.some((b) => b.id === c.id));
    try {
      localStorage.setItem(CAT_KEY, JSON.stringify(custom));
    } catch {
      // ignore
    }
  }

  function close() {
    dispatch("close");
  }

  function showToast(msg: string, ms = 3200) {
    toast = msg;
    setTimeout(() => {
      if (toast === msg) toast = "";
    }, ms);
  }

  async function openCatalog(c: OpdsCatalog) {
    activeCatalog = c;
    activeId = c.id;
    stack = [{ url: c.url, title: c.name }];
    await loadFeed(c.url, c.name);
  }

  async function loadFeed(url: string, title: string) {
    loading = true;
    error = "";
    try {
      const f = await fetchOpdsFeed(url, activeCatalog?.auth);
      feed = f;
      loadCovers(f);
    } catch (e: any) {
      error = e?.message || String(e);
      feed = null;
    } finally {
      loading = false;
    }
  }

  async function drillNav(e: OpdsEntry) {
    if (!e.href) return;
    stack = [...stack, { url: e.href, title: e.title || "目录" }];
    await loadFeed(e.href, e.title || "目录");
  }

  function goBack(idx: number) {
    stack = stack.slice(0, idx + 1);
    const top = stack[stack.length - 1];
    void loadFeed(top.url, top.title);
  }

  async function doSearch() {
    if (!activeCatalog) return;
    const q = query.trim();
    if (!q) return;
    loading = true;
    error = "";
    try {
      const f = await searchOpds(activeCatalog, q, feed?.links);
      feed = f;
      stack = [{ url: activeCatalog.url, title: activeCatalog.name }, { url: "", title: `搜索：${q}` }];
      loadCovers(f);
    } catch (e: any) {
      error = e?.message || String(e);
    } finally {
      loading = false;
    }
  }

  async function loadCovers(f: OpdsFeed) {
    for (const e of f.entries) {
      if (e.kind === "publication" && e.cover && !coverMap[e.cover]) {
        const url = e.cover;
        const auth = activeCatalog?.auth;
        fetchImageDataUrl(url, auth).then((d) => {
          if (d) coverMap = { ...coverMap, [url]: d };
        });
      }
    }
  }

  async function importEntry(e: OpdsEntry) {
    if (!e.download || !activeCatalog) return;
    importingId = e.id || e.title || "book";
    try {
      const file = await downloadAsFile(e.download.href, activeCatalog.auth, e.title);
      const meta = await store.importBook(file);
      if (meta) showToast(`已导入《${e.title}》`);
      else showToast(`《${e.title}》已存在，跳过`);
    } catch (err: any) {
      showToast(`导入失败：${err?.message || err}`);
    } finally {
      importingId = "";
    }
  }

  function addCatalog() {
    const name = fName.trim();
    const url = fUrl.trim();
    if (!name || !url) {
      showToast("请填写书源名称与地址");
      return;
    }
    const id = "u_" + Date.now().toString(36);
    catalogs = [
      ...catalogs,
      { id, name, url, auth: fAuth.trim() || undefined, searchTemplate: fSearch.trim() || undefined },
    ];
    saveCustom();
    fName = fUrl = fAuth = fSearch = "";
    showManage = false;
    showToast(`已添加书源「${name}」`);
  }

  function removeCatalog(c: OpdsCatalog) {
    if (BUILTIN_CATALOGS.some((b) => b.id === c.id)) {
      showToast("内置书源不可删除");
      return;
    }
    catalogs = catalogs.filter((x) => x.id !== c.id);
    saveCustom();
  }

  function onCatalogChange(e: Event) {
    const c = catalogs.find((x) => x.id === (e.target as HTMLSelectElement).value);
    if (c) void openCatalog(c);
  }

  function truncate(s: string, n = 80): string {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
</script>

<div class="edit-mask" use:portal on:click|self={close}>
  <div class="edit-panel opds-panel">
    <header class="panel-header">
      <h2 class="panel-title">在线书源</h2>
      <button class="panel-close" on:click={close} aria-label="关闭">×</button>
    </header>

    <!-- 工具栏 -->
    <div class="opds-toolbar">
      <select class="opds-select" bind:value={activeId} on:change={onCatalogChange}>
        {#each catalogs as c (c.id)}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
      <input
        class="opds-search"
        placeholder="搜索书名 / 作者…"
        bind:value={query}
        on:keydown={(e) => e.key === "Enter" && doSearch()}
      />
      <button class="opds-btn primary" on:click={doSearch}>搜索</button>
      <button class="opds-btn" on:click={() => (showManage = !showManage)}>管理</button>
    </div>

    {#if showManage}
      <div class="opds-manage">
        <div class="opds-cat-list">
          {#each catalogs as c (c.id)}
            <div class="opds-cat-row">
              <span class="opds-cat-name" title={c.url}>{c.name}</span>
              {#if !BUILTIN_CATALOGS.some((b) => b.id === c.id)}
                <button class="opds-cat-del" title="删除" on:click={() => removeCatalog(c)}>删除</button>
              {:else}
                <span class="opds-cat-badge">内置</span>
              {/if}
            </div>
          {/each}
        </div>
        <div class="opds-add">
          <input class="opds-in" placeholder="书源名称" bind:value={fName} />
          <input class="opds-in" placeholder="OPDS 地址（含 http）" bind:value={fUrl} />
          <input class="opds-in" placeholder="Basic Auth（可选）user:pass" bind:value={fAuth} />
          <input class="opds-in" placeholder="搜索模板（可选，&#123;q&#125; 占位）" bind:value={fSearch} />
          <button class="opds-btn primary" on:click={addCatalog}>添加书源</button>
        </div>
      </div>
    {/if}

    {#if stack.length > 1}
      <nav class="opds-crumbs">
        {#each stack as crumb, i (i)}
          <button class="opds-crumb" class:active={i === stack.length - 1} on:click={() => goBack(i)}>
            {crumb.title || "目录"}
          </button>
          {#if i < stack.length - 1}<span class="opds-crumb-sep">›</span>{/if}
        {/each}
      </nav>
    {/if}

    <!-- 内容 -->
    <div class="opds-body">
      {#if loading}
        <div class="opds-state">
          <div class="opds-spinner"></div>
          <div>正在加载书源…</div>
        </div>
      {:else if error}
        <div class="opds-state error">
          <div>{error}</div>
          <button class="opds-btn" on:click={() => (error = "")}>知道了</button>
        </div>
      {:else if feed}
        {#if !feed.entries.length}
          <div class="opds-state">这个目录没有条目，返回上一级或换本书源</div>
        {:else}
          <div class="opds-grid">
            {#each feed.entries as e, i (e.kind + (e.href || e.id || e.title || i))}
              {#if e.kind === "navigation"}
                <button class="opds-card folder" on:click={() => drillNav(e)}>
                  <span class="opds-folder-icon">📁</span>
                  <span class="opds-card-title">{e.title || "（无标题）"}</span>
                  <span class="opds-card-arrow">›</span>
                </button>
              {:else}
                <div class="opds-card book">
                  <div class="opds-cover">
                    {#if e.cover && coverMap[e.cover]}
                      <img src={coverMap[e.cover]} alt={e.title} />
                    {:else}
                      <span class="opds-cover-text">{e.title?.slice(0, 2) || "📖"}</span>
                    {/if}
                  </div>
                  <div class="opds-card-body">
                    <div class="opds-card-title" title={e.title}>{e.title || "（无标题）"}</div>
                    {#if e.author}<div class="opds-card-author">{e.author}</div>{/if}
                    {#if e.summary}<div class="opds-card-sum">{truncate(e.summary, 120)}</div>{/if}
                    <div class="opds-card-actions">
                      {#if e.download}
                        <button
                          class="opds-btn primary"
                          disabled={!!importingId}
                          on:click={() => importEntry(e)}
                        >
                          {importingId === (e.id || e.title || "book") ? "导入中…" : "导入书架"}
                        </button>
                      {:else}
                        <span class="opds-no-dl">不可下载</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      {:else}
        <div class="opds-state">选择上方书源开始浏览；或输入关键词搜索</div>
      {/if}
    </div>

    {#if toast}
      <div class="opds-toast">{toast}</div>
    {/if}
  </div>
</div>

<style>
  .opds-panel {
    width: min(720px, 92vw);
    max-height: 88vh;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.1));
  }
  .panel-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--b3-theme-on-background, #333);
    margin: 0;
  }
  .panel-close {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.04));
    border-radius: 50%;
    font-size: 18px;
    line-height: 1;
    color: var(--b3-theme-on-surface-light, #666);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .panel-close:hover {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.08));
    color: var(--b3-theme-on-background, #333);
  }
  .opds-toolbar {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .opds-select {
    max-width: 170px;
    flex-shrink: 0;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 12px;
    background: var(--b3-theme-background, #fff);
    color: var(--b3-theme-on-background, #333);
    outline: none;
  }
  .opds-select:focus {
    border-color: var(--b3-theme-primary, #534ab7);
  }
  .opds-search {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 13px;
    background: var(--b3-theme-background, #fff);
    color: var(--b3-theme-on-background, #333);
    outline: none;
  }
  .opds-search:focus {
    border-color: var(--b3-theme-primary, #534ab7);
  }
  .opds-btn {
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    background: var(--b3-theme-background, #fff);
    border-radius: 8px;
    padding: 7px 14px;
    font-size: 12px;
    cursor: pointer;
    color: var(--b3-theme-on-background, #333);
    transition: background 0.15s, border-color 0.15s;
    flex-shrink: 0;
  }
  .opds-btn:hover {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.04));
  }
  .opds-btn.primary {
    background: var(--b3-theme-primary, #534ab7);
    border-color: transparent;
    color: #fff;
  }
  .opds-btn.primary:hover {
    filter: brightness(1.05);
  }
  .opds-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .opds-manage {
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.03));
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
    border-radius: 12px;
    padding: 12px;
  }
  .opds-cat-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 140px;
    overflow-y: auto;
  }
  .opds-cat-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 12px;
  }
  .opds-cat-row:hover {
    background: var(--b3-theme-background, rgba(255, 255, 255, 0.6));
  }
  .opds-cat-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--b3-theme-on-background, #333);
  }
  .opds-cat-del {
    border: none;
    background: none;
    color: var(--b3-theme-error, #e24b4a);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 6px;
  }
  .opds-cat-badge {
    font-size: 10px;
    color: var(--b3-theme-on-surface-light, #999);
    background: var(--b3-theme-background, rgba(255, 255, 255, 0.7));
    padding: 1px 6px;
    border-radius: 4px;
  }
  .opds-add {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .opds-add .opds-btn {
    grid-column: 1 / -1;
    justify-self: start;
  }
  .opds-in {
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 12px;
    background: var(--b3-theme-background, #fff);
    color: var(--b3-theme-on-background, #333);
    outline: none;
  }
  .opds-in:focus {
    border-color: var(--b3-theme-primary, #534ab7);
  }
  .opds-crumbs {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    font-size: 12px;
  }
  .opds-crumb {
    border: none;
    background: none;
    cursor: pointer;
    color: var(--b3-theme-primary, #534ab7);
    padding: 3px 6px;
    border-radius: 5px;
    font-size: 12px;
  }
  .opds-crumb:hover {
    background: var(--b3-theme-primary-light, rgba(83, 74, 183, 0.08));
  }
  .opds-crumb.active {
    color: var(--b3-theme-on-background, #333);
    font-weight: 500;
    cursor: default;
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.05));
  }
  .opds-crumb-sep {
    color: var(--b3-theme-on-surface-light, #bbb);
  }
  .opds-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-right: 2px;
  }
  .opds-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 48px 0;
    text-align: center;
    font-size: 13px;
    color: var(--b3-theme-on-surface-light, #888);
  }
  .opds-state.error {
    color: var(--b3-theme-error, #e24b4a);
  }
  .opds-spinner {
    width: 22px;
    height: 22px;
    border: 2px solid var(--b3-border-color, rgba(0, 0, 0, 0.1));
    border-top-color: var(--b3-theme-primary, #534ab7);
    border-radius: 50%;
    animation: opds-spin 0.8s linear infinite;
  }
  @keyframes opds-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .opds-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }
  .opds-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.03));
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.06));
    border-radius: 12px;
    padding: 12px;
    text-align: left;
    transition: transform 0.1s, box-shadow 0.15s;
  }
  .opds-card:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
  }
  .opds-card.folder {
    cursor: pointer;
    align-items: center;
  }
  .opds-folder-icon {
    font-size: 22px;
  }
  .opds-card-arrow {
    margin-left: auto;
    font-size: 16px;
    color: var(--b3-theme-on-surface-light, #bbb);
  }
  .opds-cover {
    width: 52px;
    height: 74px;
    flex-shrink: 0;
    border-radius: 6px;
    overflow: hidden;
    background: linear-gradient(160deg, #3d6ea8, #1a3c66);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  }
  .opds-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .opds-cover-text {
    font-size: 12px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.95);
    text-align: center;
    padding: 0 4px;
    line-height: 1.2;
  }
  .opds-card-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .opds-card-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--b3-theme-on-background, #333);
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .opds-card-author {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
  }
  .opds-card-sum {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #999);
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .opds-card-actions {
    margin-top: 4px;
  }
  .opds-no-dl {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #999);
  }
  .opds-toast {
    position: absolute;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    background: rgba(30, 30, 30, 0.92);
    color: #fff;
    font-size: 12px;
    padding: 8px 16px;
    border-radius: 10px;
    z-index: 40;
    white-space: nowrap;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  }
</style>
