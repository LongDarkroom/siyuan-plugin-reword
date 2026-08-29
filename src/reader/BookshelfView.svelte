<script lang="ts">
  /**
   * 阅读器 - 书架面板
   * 封面（EPUB 真实封面 / 占位）、导入（多选 + 拖拽 + 批量进度 + 去重 + 失败汇总重试）、
   * 续读、删除、编辑信息（书名/作者）。
   */
  import { onMount, onDestroy } from "svelte";
  import type {
    BookshelfStore,
    BookMeta,
    BookGroup,
    BookStatus,
    BookSortKey,
    SortDir,
  } from "../reader/bookshelf-store";
  import { isSupportedBookFile } from "../reader/book-adapters";
  import ReadingStatsPanel from "./ReadingStatsPanel.svelte";
  import OpdsSearchPanel from "./OpdsSearchPanel.svelte";
  import GraphPanel from "./GraphPanel.svelte";

  export let store: BookshelfStore;
  export let onOpen: (bookId: string) => void;

  let books: BookMeta[] = [];
  let fileInput: HTMLInputElement;
  let importing = false;
  let importError = "";
  let coverUrls: Record<string, string> = {};

  /* ================================================================
   * 2026-08-29 书架 P0/P1：搜索 / 排序 / 视图 / 分组 / 标签 / 批量
   * ================================================================ */

  /** UI 偏好持久化（localStorage，与书架数据解耦，坏数据不影响书架） */
  const UI_KEY = "reword-bookshelf-ui";

  let viewMode: "grid" | "list" = "grid";
  let sortKey: BookSortKey = "lastRead";
  let sortDir: SortDir = "desc";
  let sidebarOpen = true;

  let keyword = "";
  let filterStatus: BookStatus | "all" = "all";
  let filterFormat = "all";
  let filterTag = "";
  /** "all" | "ungrouped" | 具体 groupId */
  let filterGroup = "all";
  let favoriteOnly = false;

  /** 侧栏分组折叠状态（仅视觉收起，不影响筛选逻辑） */
  let collapsed: Record<string, boolean> = {};
  function toggleBlock(key: string) {
    collapsed[key] = !collapsed[key];
    collapsed = collapsed;
  }

  /** 阅读统计面板开关（A · 阅读统计可视化） */
  let showStats = false;
  /** OPDS 在线书源面板开关（B · 在线书源 / OPDS 搜书） */
  let showOpds = false;
  /** 阅读知识图谱面板开关（C · 图谱 / 画布联动） */
  let showGraph = false;

  // 批量选择模式
  let selectMode = false;
  let selectedIds: string[] = [];

  // 拖书入组的高亮目标
  let dropGroupId = "";

  const STATUS_LABEL: Record<BookStatus, string> = {
    unread: "想读",
    reading: "在读",
    finished: "读完",
  };

  /** 状态文本，坏数据兜底防止标签空白 */
  function statusLabel(s: BookStatus | undefined): string {
    return STATUS_LABEL[s ?? "unread"] ?? "想读";
  }

  /** 状态循环顺序（卡片角标点击 + 侧栏智能分组共用） */
  const STATUS_ORDER: BookStatus[] = ["unread", "reading", "finished"];

  const SORT_OPTIONS: { key: BookSortKey; label: string }[] = [
    { key: "lastRead", label: "最近阅读" },
    { key: "addedAt", label: "添加时间" },
    { key: "title", label: "书名" },
    { key: "author", label: "作者" },
    { key: "progress", label: "阅读进度" },
    { key: "readingTime", label: "阅读时长" },
    { key: "rating", label: "评分" },
    { key: "size", label: "文件大小" },
  ];

  /** 侧栏分面数据：依赖 books 变化重算（单一 helper，避免多个 $: 各自失效） */
  function computeFacets(_b: BookMeta[]) {
    void _b;
    return {
      // 分组计数在此一次算好：模板里直接调 store.groupCount 不会被 Svelte 追踪，会显示过期数字
      groups: store.groups.map((g) => ({ ...g, count: store.groupCount(g.id) })),
      tags: store.tagCounts(),
      formats: store.formatCounts(),
      status: store.statusCounts(),
      favorites: store.favoriteCount(),
      ungrouped: store.ungroupedCount(),
    };
  }
  $: facets = computeFacets(books);

  /**
   * 可见书籍：搜索 + 筛选 + 排序
   * 依赖全部以形参显式传入，确保 Svelte 静态分析能追踪到每个依赖
   */
  function computeVisible(
    _b: BookMeta[],
    kw: string,
    st: BookStatus | "all",
    fmt: string,
    tag: string,
    grp: string,
    fav: boolean,
    sk: BookSortKey,
    sd: SortDir
  ): BookMeta[] {
    void _b;
    return store.query(
      {
        keyword: kw,
        status: st,
        format: fmt,
        tag: tag || undefined,
        groupId: grp,
        favoriteOnly: fav,
      },
      sk,
      sd
    );
  }
  $: visible = computeVisible(
    books,
    keyword,
    filterStatus,
    filterFormat,
    filterTag,
    filterGroup,
    favoriteOnly,
    sortKey,
    sortDir
  );

  /** 是否存在任何生效的筛选（用于显示「清除筛选」） */
  $: hasFilter =
    !!keyword.trim() ||
    filterStatus !== "all" ||
    filterFormat !== "all" ||
    !!filterTag ||
    filterGroup !== "all" ||
    favoriteOnly;

  function loadUiPrefs() {
    try {
      const raw = localStorage.getItem(UI_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p.viewMode === "grid" || p.viewMode === "list") viewMode = p.viewMode;
      if (typeof p.sortKey === "string" && SORT_OPTIONS.some((o) => o.key === p.sortKey)) sortKey = p.sortKey;
      if (p.sortDir === "asc" || p.sortDir === "desc") sortDir = p.sortDir;
      if (typeof p.sidebarOpen === "boolean") sidebarOpen = p.sidebarOpen;
    } catch {
      // 坏数据忽略，用默认值
    }
  }

  function saveUiPrefs() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ viewMode, sortKey, sortDir, sidebarOpen }));
    } catch {
      // 存储不可用（隐私模式等）不影响功能
    }
  }

  function setViewMode(m: "grid" | "list") {
    viewMode = m;
    saveUiPrefs();
  }

  function toggleSortDir() {
    sortDir = sortDir === "desc" ? "asc" : "desc";
    saveUiPrefs();
  }

  function onSortKeyChange(e: Event) {
    sortKey = (e.target as HTMLSelectElement).value as BookSortKey;
    saveUiPrefs();
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    saveUiPrefs();
  }

  function clearFilters() {
    keyword = "";
    filterStatus = "all";
    filterFormat = "all";
    filterTag = "";
    filterGroup = "all";
    favoriteOnly = false;
  }

  /** 侧栏：选中某个「视图」（互斥切换，避免多条件叠加后一本书都不剩） */
  function pickScope(scope: "all" | "favorite" | "ungrouped") {
    filterGroup = scope === "ungrouped" ? "ungrouped" : "all";
    favoriteOnly = scope === "favorite";
    filterStatus = "all";
    filterTag = "";
  }

  function pickStatus(s: BookStatus) {
    filterStatus = filterStatus === s ? "all" : s;
  }

  function pickGroup(id: string) {
    filterGroup = filterGroup === id ? "all" : id;
    favoriteOnly = false;
  }

  function pickTag(t: string) {
    filterTag = filterTag === t ? "" : t;
  }

  function pickFormat(f: string) {
    filterFormat = filterFormat === f ? "all" : f;
  }

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
  // [2026-08-29] 扩展字段
  let editSeries = "";
  let editStatus: BookStatus = "unread";
  let editRating = 0;
  let editFavorite = false;
  let editTags: string[] = [];
  let editTagInput = "";
  let editGroupId = "";
  let coverInput: HTMLInputElement;
  let coverBusy = false;

  // 删除确认弹窗（默认保留源文件）
  let removeTarget: BookMeta | null = null;
  let removeWithFile = false;
  /** 批量删除确认（与单本共用样式，target 为 null 时看这个） */
  let batchRemoveOpen = false;

  // 分组管理弹窗
  let groupDialogOpen = false;
  let newGroupName = "";
  let renamingGroupId = "";
  let renamingGroupName = "";

  // 批量加标签弹窗
  let batchTagOpen = false;
  let batchTagName = "";

  const ACCEPT = ".epub,.mobi,.azw3,.fb2,.cbz,.pdf,.txt,.md,.markdown";
  const MB = 1024 * 1024;

  function fmtSize(n: number): string {
    return n >= MB ? `${(n / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  }

  /**
   * 已加载封面对应的 cover 路径快照
   * 用途：替换封面后路径变化（带时间戳）→ 自动重取，避免显示旧图
   */
  let coverPaths: Record<string, string> = {};

  function loadCovers(list: BookMeta[]) {
    for (const b of list) {
      if (!b.cover) continue;
      if (coverPaths[b.id] === b.cover) continue;
      // 路径变了：先回收旧 URL 防泄漏
      const old = coverUrls[b.id];
      if (old) {
        try {
          URL.revokeObjectURL(old);
        } catch {
          // ignore
        }
      }
      coverPaths = { ...coverPaths, [b.id]: b.cover };
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

  async function refresh() {
    await store.load();
    books = store.list;
    // 加载真实封面（EPUB/PDF 提取或用户替换；TXT/MD 无封面保持首字占位）
    loadCovers(books);
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
    editSeries = b.series || "";
    editStatus = b.status ?? "unread";
    editRating = b.rating ?? 0;
    editFavorite = !!b.favorite;
    editTags = [...(b.tags ?? [])];
    editTagInput = "";
    editGroupId = b.groupId || "";
    coverBusy = false;
  }

  async function saveEdit() {
    if (!editTarget) return;
    const id = editTarget.id;
    const ok = await store.updateMeta(id, {
      title: editTitle,
      author: editAuthor,
      series: editSeries,
      status: editStatus,
      rating: editRating,
      favorite: editFavorite,
      tags: editTags,
      groupId: editGroupId,
    });
    editTarget = null;
    if (ok) {
      showToast("已保存");
      await refresh();
    } else {
      showToast("保存失败");
    }
  }

  /* ---- 编辑弹窗：标签 chip ---- */

  function addEditTag() {
    const t = editTagInput.trim();
    if (!t) return;
    if (!editTags.includes(t)) editTags = [...editTags, t];
    editTagInput = "";
  }

  function onEditTagKey(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addEditTag();
    } else if (e.key === "Backspace" && !editTagInput && editTags.length) {
      editTags = editTags.slice(0, -1);
    }
  }

  function dropEditTag(t: string) {
    editTags = editTags.filter((x) => x !== t);
  }

  /* ---- 编辑弹窗：封面替换 ---- */

  async function onCoverChosen() {
    const f = coverInput?.files?.[0];
    if (!f || !editTarget) return;
    if (!/^image\//.test(f.type)) {
      showToast("请选择图片文件");
      coverInput.value = "";
      return;
    }
    coverBusy = true;
    const ext = (f.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "jpg").toLowerCase();
    try {
      const path = await store.replaceCover(editTarget.id, f, ext);
      if (path) {
        showToast("封面已替换");
        await refresh();
        // 弹窗内立即看到新封面
        const fresh = store.get(editTarget.id);
        if (fresh) editTarget = fresh;
      } else {
        showToast("封面替换失败");
      }
    } catch {
      showToast("封面替换失败");
    }
    coverBusy = false;
    coverInput.value = "";
  }

  /* ---- 单本快捷操作 ---- */

  async function toggleFav(b: BookMeta) {
    await store.toggleFavorite(b.id);
    await refresh();
  }

  async function cycleStatus(b: BookMeta) {
    const cur = b.status ?? "unread";
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(cur) + 1) % STATUS_ORDER.length];
    await store.setStatus(b.id, next);
    await refresh();
    showToast(`已标记为「${STATUS_LABEL[next]}」`);
  }

  /* ---- 分组管理 ---- */

  async function createGroup() {
    const n = newGroupName.trim();
    if (!n) return;
    const g = await store.createGroup(n);
    newGroupName = "";
    await refresh();
    if (g) showToast(`已创建分组「${g.name}」`);
  }

  function startRenameGroup(g: BookGroup) {
    renamingGroupId = g.id;
    renamingGroupName = g.name;
  }

  async function commitRenameGroup() {
    if (!renamingGroupId) return;
    await store.renameGroup(renamingGroupId, renamingGroupName);
    renamingGroupId = "";
    renamingGroupName = "";
    await refresh();
  }

  async function deleteGroup(g: BookGroup) {
    await store.deleteGroup(g.id);
    if (filterGroup === g.id) filterGroup = "all";
    await refresh();
    showToast(`已删除分组「${g.name}」（书籍保留）`);
  }

  /* ---- 批量选择 ---- */

  function toggleSelectMode() {
    selectMode = !selectMode;
    if (!selectMode) selectedIds = [];
  }

  function toggleSelect(id: string) {
    selectedIds = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
  }

  function selectAllVisible() {
    selectedIds = visible.map((b) => b.id);
  }

  function clearSelection() {
    selectedIds = [];
  }

  async function batchStatus(e: Event) {
    const v = (e.target as HTMLSelectElement).value as BookStatus | "";
    if (!v || !selectedIds.length) return;
    const n = await store.batchSetStatus(selectedIds, v);
    (e.target as HTMLSelectElement).value = "";
    await refresh();
    showToast(`已将 ${n} 本标记为「${STATUS_LABEL[v]}」`);
  }

  async function batchGroup(e: Event) {
    const v = (e.target as HTMLSelectElement).value;
    if (!v || !selectedIds.length) return;
    const n = await store.batchSetGroup(selectedIds, v === "__none__" ? undefined : v);
    (e.target as HTMLSelectElement).value = "";
    await refresh();
    showToast(v === "__none__" ? `已将 ${n} 本移出分组` : `已将 ${n} 本移入分组`);
  }

  async function commitBatchTag() {
    const t = batchTagName.trim();
    if (!t || !selectedIds.length) return;
    const n = await store.batchAddTag(selectedIds, t);
    batchTagOpen = false;
    batchTagName = "";
    await refresh();
    showToast(`已为 ${n} 本添加标签「${t}」`);
  }

  async function confirmBatchRemove() {
    const ids = [...selectedIds];
    batchRemoveOpen = false;
    try {
      const n = await store.batchRemove(ids, { deleteFile: removeWithFile });
      selectedIds = [];
      selectMode = false;
      await refresh();
      showToast(removeWithFile ? `已删除 ${n} 本及源文件` : `已移除 ${n} 本（源文件保留）`);
    } catch {
      showToast("批量删除失败");
    }
    removeWithFile = false;
  }

  /* ---- 拖书入组（内部拖拽，与文件拖拽导入用不同 dataTransfer 类型区分） ---- */

  const DRAG_TYPE = "application/x-reword-book";

  function onBookDragStart(e: DragEvent, id: string) {
    if (!e.dataTransfer) return;
    // 选中多本时拖任意一本 = 拖整批
    const ids = selectMode && selectedIds.includes(id) ? selectedIds : [id];
    e.dataTransfer.setData(DRAG_TYPE, ids.join(","));
    e.dataTransfer.effectAllowed = "move";
  }

  function onGroupDragOver(e: DragEvent, gid: string) {
    if (!e.dataTransfer?.types?.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    dropGroupId = gid;
  }

  function onGroupDragLeave(gid: string) {
    if (dropGroupId === gid) dropGroupId = "";
  }

  async function onGroupDrop(e: DragEvent, gid: string) {
    dropGroupId = "";
    const raw = e.dataTransfer?.getData(DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    const ids = raw.split(",").filter(Boolean);
    if (!ids.length) return;
    const n = await store.batchSetGroup(ids, gid === "__none__" ? undefined : gid);
    await refresh();
    showToast(gid === "__none__" ? `已移出分组 ${n} 本` : `已移入分组 ${n} 本`);
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

  /** 书架 store 订阅句柄（阅读器保存进度/时长后书架自动同步） */
  let unsubStore: (() => void) | null = null;

  onMount(() => {
    loadUiPrefs();
    void refresh();
    unsubStore = store.subscribe((list) => {
      if (!Array.isArray(list)) return;
      books = [...list];
      loadCovers(books);
    });
  });

  onDestroy(() => {
    try {
      unsubStore?.();
    } catch {
      // ignore
    }
    unsubStore = null;
    // 回收封面 objectURL，防内存泄漏
    for (const url of Object.values(coverUrls)) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    coverUrls = {};
    coverPaths = {};
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
    <button
      class="shelf-icon-btn"
      class:active={sidebarOpen}
      title={sidebarOpen ? "收起分组栏" : "展开分组栏"}
      on:click={toggleSidebar}
    >☰</button>
    <span class="bookshelf-title">书架</span>
    <span class="bookshelf-count">
      {#if hasFilter}{visible.length} / {books.length} 本{:else}{books.length} 本{/if}
    </span>
    <span class="bookshelf-spacer"></span>
    <button
      class="shelf-icon-btn"
      class:active={selectMode}
      title={selectMode ? "退出多选" : "多选"}
      on:click={toggleSelectMode}
    >☑</button>
    <button
      class="shelf-icon-btn"
      title="阅读统计"
      on:click={() => (showStats = true)}
    >📊</button>
    <button
      class="shelf-icon-btn"
      title="在线书源（OPDS）"
      on:click={() => (showOpds = true)}
    >🌐</button>
    <button
      class="shelf-icon-btn"
      title="阅读知识图谱"
      on:click={() => (showGraph = true)}
    >🕸️</button>
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

  <!-- [2026-08-29] P0 工具栏：搜索 + 排序 + 视图切换 -->
  <div class="shelf-toolbar">
    <div class="shelf-search">
      <span class="shelf-search-icon">🔍</span>
      <input
        class="shelf-search-input"
        type="text"
        placeholder="搜索书名 / 作者 / 标签 / 丛书"
        bind:value={keyword}
      />
      {#if keyword}
        <button class="shelf-search-clear" title="清空" on:click={() => (keyword = "")}>✕</button>
      {/if}
    </div>
    <select class="shelf-select" title="排序方式" value={sortKey} on:change={onSortKeyChange}>
      {#each SORT_OPTIONS as o}
        <option value={o.key}>{o.label}</option>
      {/each}
    </select>
    <button
      class="shelf-icon-btn"
      title={sortDir === "desc" ? "当前：降序（点击切升序）" : "当前：升序（点击切降序）"}
      on:click={toggleSortDir}
    >{sortDir === "desc" ? "↓" : "↑"}</button>
    <div class="shelf-view-toggle">
      <button
        class="shelf-icon-btn"
        class:active={viewMode === "grid"}
        title="封面网格"
        on:click={() => setViewMode("grid")}
      >▦</button>
      <button
        class="shelf-icon-btn"
        class:active={viewMode === "list"}
        title="列表"
        on:click={() => setViewMode("list")}
      >☰</button>
    </div>
    {#if hasFilter}
      <button class="shelf-clear-filter" title="清除全部筛选" on:click={clearFilters}>清除筛选</button>
    {/if}
  </div>

  {#if selectMode}
    <div class="shelf-batch-bar">
      <span class="shelf-batch-count">已选 {selectedIds.length} 本</span>
      <button class="shelf-batch-btn" on:click={selectAllVisible}>全选当前</button>
      <button class="shelf-batch-btn" on:click={clearSelection}>清空</button>
      <span class="bookshelf-spacer"></span>
      <select class="shelf-select" disabled={!selectedIds.length} on:change={batchStatus}>
        <option value="">设为状态…</option>
        <option value="unread">想读</option>
        <option value="reading">在读</option>
        <option value="finished">读完</option>
      </select>
      <select class="shelf-select" disabled={!selectedIds.length} on:change={batchGroup}>
        <option value="">移入分组…</option>
        {#each facets.groups as g}
          <option value={g.id}>{g.name}</option>
        {/each}
        <option value="__none__">（移出分组）</option>
      </select>
      <button
        class="shelf-batch-btn"
        disabled={!selectedIds.length}
        on:click={() => {
          batchTagName = "";
          batchTagOpen = true;
        }}>加标签</button
      >
      <button
        class="shelf-batch-btn danger"
        disabled={!selectedIds.length}
        on:click={() => {
          removeWithFile = false;
          batchRemoveOpen = true;
        }}>删除</button
      >
    </div>
  {/if}

  {#if importError}
    <div class="bookshelf-error">{importError}</div>
  {/if}

  {#if dragging}
    <div class="bookshelf-dropzone">
      <div class="bookshelf-dropzone-inner">
        <div class="bookshelf-dropzone-icon">📥</div>
        <div>松开导入书籍</div>
        <div class="bookshelf-dropzone-hint">支持 EPUB / MOBI / AZW3 / FB2 / CBZ / PDF / TXT / Markdown</div>
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

  <div class="bookshelf-body">
    {#if sidebarOpen}
      <!-- [2026-08-29] P1 分组侧栏：用户分组 + 智能分组（状态/标签/格式） -->
      <aside class="shelf-sidebar">
        <div class="shelf-sb-block">
          <button
            class="shelf-sb-item"
            class:active={filterGroup === "all" && !favoriteOnly && filterStatus === "all" && !filterTag}
            on:click={() => pickScope("all")}
          >
            <span class="shelf-sb-label">📚 全部</span>
            <span class="shelf-sb-num">{books.length}</span>
          </button>
          <button class="shelf-sb-item" class:active={favoriteOnly} on:click={() => pickScope("favorite")}>
            <span class="shelf-sb-label">★ 收藏</span>
            <span class="shelf-sb-num">{facets.favorites}</span>
          </button>
          <button
            class="shelf-sb-item"
            class:active={filterGroup === "ungrouped"}
            class:dropping={dropGroupId === "__none__"}
            on:click={() => pickScope("ungrouped")}
            on:dragover={(e) => onGroupDragOver(e, "__none__")}
            on:dragleave={() => onGroupDragLeave("__none__")}
            on:drop={(e) => onGroupDrop(e, "__none__")}
          >
            <span class="shelf-sb-label">📂 未分组</span>
            <span class="shelf-sb-num">{facets.ungrouped}</span>
          </button>
        </div>

        <div class="shelf-sb-block">
          <button class="shelf-sb-title toggle" on:click={() => toggleBlock("status")}>
            <span class="shelf-sb-caret" class:closed={collapsed.status}>▾</span>
            <span class="shelf-sb-title-text">阅读状态</span>
          </button>
          {#if !collapsed.status}
            {#each STATUS_ORDER as s}
              <button
                class="shelf-sb-item"
                class:active={filterStatus === s}
                on:click={() => pickStatus(s)}
              >
                <span class="shelf-sb-label">{STATUS_LABEL[s]}</span>
                <span class="shelf-sb-num">{facets.status[s]}</span>
              </button>
            {/each}
          {/if}
        </div>

        <div class="shelf-sb-block">
          <div class="shelf-sb-title">
            <button class="shelf-sb-toggle" on:click={() => toggleBlock("groups")} title="折叠/展开">
              <span class="shelf-sb-caret" class:closed={collapsed.groups}>▾</span>
            </button>
            <span class="shelf-sb-title-text" on:click={() => toggleBlock("groups")}>我的分组</span>
            <button class="shelf-sb-add" title="管理分组" on:click|stopPropagation={() => (groupDialogOpen = true)}>＋</button>
          </div>
          {#if !collapsed.groups}
            {#each facets.groups as g (g.id)}
              <button
                class="shelf-sb-item"
                class:active={filterGroup === g.id}
                class:dropping={dropGroupId === g.id}
                title="点击筛选，可把书拖到这里归组"
                on:click={() => pickGroup(g.id)}
                on:dragover={(e) => onGroupDragOver(e, g.id)}
                on:dragleave={() => onGroupDragLeave(g.id)}
                on:drop={(e) => onGroupDrop(e, g.id)}
              >
                <span class="shelf-sb-label">📁 {g.name}</span>
                <span class="shelf-sb-num">{g.count}</span>
              </button>
            {:else}
              <div class="shelf-sb-hint">还没有分组，点 ＋ 新建</div>
            {/each}
          {/if}
        </div>

        {#if facets.tags.length}
          <div class="shelf-sb-block">
            <button class="shelf-sb-title toggle" on:click={() => toggleBlock("tags")}>
              <span class="shelf-sb-caret" class:closed={collapsed.tags}>▾</span>
              <span class="shelf-sb-title-text">标签</span>
            </button>
            {#if !collapsed.tags}
              <div class="shelf-sb-tags">
                {#each facets.tags as t (t.tag)}
                  <button class="shelf-tag-chip" class:active={filterTag === t.tag} on:click={() => pickTag(t.tag)}>
                    {t.tag}<span class="shelf-tag-num">{t.count}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        {#if facets.formats.length > 1}
          <div class="shelf-sb-block">
            <button class="shelf-sb-title toggle" on:click={() => toggleBlock("formats")}>
              <span class="shelf-sb-caret" class:closed={collapsed.formats}>▾</span>
              <span class="shelf-sb-title-text">格式</span>
            </button>
            {#if !collapsed.formats}
              <div class="shelf-sb-tags">
                {#each facets.formats as f (f.format)}
                  <button
                    class="shelf-tag-chip"
                    class:active={filterFormat === f.format}
                    on:click={() => pickFormat(f.format)}
                  >
                    {f.format.toUpperCase()}<span class="shelf-tag-num">{f.count}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </aside>
    {/if}

    <div class="shelf-main">
      {#if books.length === 0}
        <div class="bookshelf-empty">
          <div class="bookshelf-empty-title">书架是空的</div>
          <div class="bookshelf-empty-hint">支持 EPUB / MOBI / AZW3 / FB2 / CBZ / PDF / TXT / Markdown</div>
          <div class="bookshelf-empty-hint">直接拖拽文件到这里，或点击下方按钮</div>
          <button class="bookshelf-import-btn" on:click={() => fileInput?.click()}>导入第一本书</button>
        </div>
      {:else if visible.length === 0}
        <div class="bookshelf-empty">
          <div class="bookshelf-empty-title">没有匹配的书籍</div>
          <div class="bookshelf-empty-hint">试着换个关键词，或清除筛选条件</div>
          <button class="bookshelf-import-btn" on:click={clearFilters}>清除筛选</button>
        </div>
      {:else if viewMode === "grid"}
        <div class="bookshelf-grid">
          {#each visible as book (book.id)}
            <div
              class="book-card"
              class:selected={selectedIds.includes(book.id)}
              draggable={true}
              on:dragstart={(e) => onBookDragStart(e, book.id)}
            >
              <div class="book-cover-wrap">
                <button
                  class="book-cover"
                  on:click={() => (selectMode ? toggleSelect(book.id) : onOpen(book.id))}
                >
                  {#if coverUrls[book.id]}
                    <img class="book-cover-img" src={coverUrls[book.id]} alt={book.title} />
                  {:else}
                    <span class="book-cover-text">{book.title.slice(0, 2)}</span>
                  {/if}
                  <span class="book-format">{book.format.toUpperCase()}</span>
                </button>
                {#if selectMode}
                  <button
                    class="book-sel"
                    class:on={selectedIds.includes(book.id)}
                    title="选择"
                    on:click|stopPropagation={() => toggleSelect(book.id)}
                  >{selectedIds.includes(book.id) ? "✓" : ""}</button>
                {/if}
                <button
                  class="book-fav"
                  class:on={book.favorite}
                  title={book.favorite ? "取消收藏" : "收藏"}
                  on:click|stopPropagation={() => toggleFav(book)}
                >{book.favorite ? "★" : "☆"}</button>
                <button
                  class="book-status"
                  class:reading={(book.status ?? "unread") === "reading"}
                  class:done={book.status === "finished"}
                  title="点击切换阅读状态"
                  on:click|stopPropagation={() => cycleStatus(book)}
                >{statusLabel(book.status)}</button>
                <!-- 2026-08-29 优化：操作按钮收纳到封面悬停层，卡片信息更简洁 -->
                <div
                  class="book-cover-overlay"
                  aria-hidden="true"
                  on:click={() => onOpen(book.id)}
                >
                  <button
                    class="book-overlay-primary"
                    title={book.progress?.fraction ? "继续阅读" : "开始阅读"}
                    on:click|stopPropagation={() => onOpen(book.id)}
                  >
                    {book.progress?.fraction ? "续读" : "开始"}
                  </button>
                  <div class="book-overlay-tools">
                    <button
                      class="book-icon-btn"
                      title="编辑书籍信息"
                      on:click|stopPropagation={() => openEdit(book)}
                    >✎</button>
                    <button
                      class="book-icon-btn danger"
                      title="从书架删除"
                      on:click|stopPropagation={() => openRemove(book)}
                    >🗑</button>
                  </div>
                </div>
              </div>
              <div class="book-info">
                <div class="book-name" title={book.title}>{book.title}</div>
                <div class="book-author-row">
                  <span class="book-author" title={book.author || ""}>
                    {book.author ? book.author : "未知作者"}
                  </span>
                  <span class="book-progress">{fmtPct(book.progress?.fraction)}</span>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <!-- [2026-08-29] P0 列表视图：一行看全信息 -->
        <div class="shelf-list">
          {#each visible as book (book.id)}
            <div
              class="shelf-row"
              class:selected={selectedIds.includes(book.id)}
              draggable={true}
              on:dragstart={(e) => onBookDragStart(e, book.id)}
            >
              {#if selectMode}
                <button
                  class="row-sel"
                  class:on={selectedIds.includes(book.id)}
                  title="选择"
                  on:click={() => toggleSelect(book.id)}
                >{selectedIds.includes(book.id) ? "✓" : ""}</button>
              {/if}
              <button class="row-cover" title={book.title} on:click={() => onOpen(book.id)}>
                {#if coverUrls[book.id]}
                  <img class="book-cover-img" src={coverUrls[book.id]} alt={book.title} />
                {:else}
                  <span class="row-cover-text">{book.title.slice(0, 1)}</span>
                {/if}
              </button>
              <div class="row-main">
                <div class="row-title-line">
                  <span class="row-title" title={book.title}>{book.title}</span>
                  <button
                    class="row-status-chip"
                    class:reading={(book.status ?? "unread") === "reading"}
                    class:done={book.status === "finished"}
                    title="点击切换阅读状态"
                    on:click={() => cycleStatus(book)}
                  >{statusLabel(book.status)}</button>
                  {#if book.favorite}<span class="row-fav" title="收藏">★</span>{/if}
                </div>
                <div class="row-sub">
                  <span class="row-author" title={book.author || ""}>{book.author || "未知作者"}</span>
                  <span class="row-dot">·</span>
                  <span>{book.format.toUpperCase()}</span>
                  <span class="row-dot">·</span>
                  <span>{fmtSize(book.size)}</span>
                  <span class="row-dot">·</span>
                  <span class="row-progress">{fmtPct(book.progress?.fraction)}</span>
                  <span class="row-dot">·</span>
                  <span>{fmtTime(book.readingTimeMs) || "—"}</span>
                  <span class="row-dot">·</span>
                  <span>{fmtDate(book.lastReadAt ?? book.addedAt)}</span>
                  {#if book.tags?.length}
                    <span class="row-tag-chips">
                      {#each book.tags.slice(0, 2) as t}
                        <span class="row-tag">{t}</span>
                      {/each}
                      {#if book.tags.length > 2}
                        <span class="row-tag more">+{book.tags.length - 2}</span>
                      {/if}
                    </span>
                  {/if}
                </div>
              </div>
              <div class="row-actions">
                <button class="row-btn primary" on:click={() => onOpen(book.id)}>
                  {book.progress?.fraction ? "续读" : "开始"}
                </button>
                <div class="row-actions-extra" aria-hidden="true">
                  <button class="row-icon-btn" title="编辑" on:click={() => openEdit(book)}>✎</button>
                  <button class="row-icon-btn danger" title="删除" on:click={() => openRemove(book)}>🗑</button>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
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

  {#if batchRemoveOpen}
    <div class="edit-mask" on:click|self={() => (batchRemoveOpen = false)}>
      <div class="edit-panel">
        <div class="edit-title">批量移除</div>
        <div class="remove-desc">确定将选中的 {selectedIds.length} 本从书架移除？</div>
        <label class="remove-check">
          <input type="checkbox" bind:checked={removeWithFile} />
          <span>同时删除插件目录中的源文件（不可恢复）</span>
        </label>
        <div class="edit-actions">
          <button class="bookshelf-import-btn remove-danger" on:click={confirmBatchRemove}>移除</button>
          <button class="import-fail-close" on:click={() => (batchRemoveOpen = false)}>取消</button>
        </div>
      </div>
    </div>
  {/if}

  {#if batchTagOpen}
    <div class="edit-mask" on:click|self={() => (batchTagOpen = false)}>
      <div class="edit-panel">
        <div class="edit-title">为 {selectedIds.length} 本添加标签</div>
        <label class="edit-field">
          <span>标签名</span>
          <input bind:value={batchTagName} placeholder="如：精读 / 待复习" />
        </label>
        {#if facets.tags.length}
          <div class="edit-field">
            <span>已有标签（点击填入）</span>
            <div class="shelf-sb-tags">
              {#each facets.tags as t (t.tag)}
                <button class="shelf-tag-chip" on:click={() => (batchTagName = t.tag)}>{t.tag}</button>
              {/each}
            </div>
          </div>
        {/if}
        <div class="edit-actions">
          <button class="bookshelf-import-btn" on:click={commitBatchTag}>添加</button>
          <button class="import-fail-close" on:click={() => (batchTagOpen = false)}>取消</button>
        </div>
      </div>
    </div>
  {/if}

  {#if groupDialogOpen}
    <div class="edit-mask" on:click|self={() => (groupDialogOpen = false)}>
      <div class="edit-panel">
        <div class="edit-title">管理分组</div>
        <div class="group-new">
          <input bind:value={newGroupName} placeholder="新分组名称" on:keydown={(e) => e.key === "Enter" && createGroup()} />
          <button class="bookshelf-import-btn" on:click={createGroup}>新建</button>
        </div>
        <div class="group-list">
          {#each facets.groups as g (g.id)}
            <div class="group-item">
              {#if renamingGroupId === g.id}
                <input
                  class="group-rename"
                  bind:value={renamingGroupName}
                  on:keydown={(e) => e.key === "Enter" && commitRenameGroup()}
                />
                <button class="group-op" on:click={commitRenameGroup}>确定</button>
                <button class="group-op" on:click={() => (renamingGroupId = "")}>取消</button>
              {:else}
                <span class="group-name">📁 {g.name}</span>
                <span class="group-count">{g.count} 本</span>
                <button class="group-op" on:click={() => startRenameGroup(g)}>重命名</button>
                <button class="group-op danger" on:click={() => deleteGroup(g)}>删除</button>
              {/if}
            </div>
          {:else}
            <div class="shelf-sb-hint">还没有分组</div>
          {/each}
        </div>
        <div class="edit-actions">
          <button class="import-fail-close" on:click={() => (groupDialogOpen = false)}>关闭</button>
        </div>
      </div>
    </div>
  {/if}

  {#if editTarget}
    <div class="edit-mask" on:click|self={() => (editTarget = null)}>
      <div class="edit-panel wide">
        <div class="edit-title">编辑书籍信息</div>
        <div class="edit-scroll">
          <div class="edit-cover-row">
            <div class="edit-cover-preview">
              {#if coverUrls[editTarget.id]}
                <img class="book-cover-img" src={coverUrls[editTarget.id]} alt={editTarget.title} />
              {:else}
                <span class="book-cover-text">{editTitle.slice(0, 2)}</span>
              {/if}
            </div>
            <div class="edit-cover-ops">
              <button class="book-btn" disabled={coverBusy} on:click={() => coverInput?.click()}>
                {coverBusy ? "上传中…" : "替换封面"}
              </button>
              <div class="edit-hint">支持 JPG / PNG / WebP，建议 3:4 竖版</div>
              <label class="edit-inline-check">
                <input type="checkbox" bind:checked={editFavorite} />
                <span>★ 收藏</span>
              </label>
            </div>
          </div>

          <label class="edit-field">
            <span>书名</span>
            <input bind:value={editTitle} placeholder="书名" />
          </label>
          <label class="edit-field">
            <span>作者</span>
            <input bind:value={editAuthor} placeholder="作者" />
          </label>
          <label class="edit-field">
            <span>丛书 / 系列</span>
            <input bind:value={editSeries} placeholder="如：哈利·波特" />
          </label>

          <div class="edit-field">
            <span>阅读状态</span>
            <div class="edit-seg">
              {#each STATUS_ORDER as s}
                <button class="edit-seg-btn" class:on={editStatus === s} on:click={() => (editStatus = s)}>
                  {STATUS_LABEL[s]}
                </button>
              {/each}
            </div>
          </div>

          <div class="edit-field">
            <span>评分</span>
            <div class="edit-stars">
              {#each [1, 2, 3, 4, 5] as n}
                <button
                  class="edit-star"
                  class:on={editRating >= n}
                  title="{n} 星"
                  on:click={() => (editRating = editRating === n ? 0 : n)}
                >★</button>
              {/each}
              {#if editRating}
                <button class="edit-star-clear" on:click={() => (editRating = 0)}>清除</button>
              {/if}
            </div>
          </div>

          <div class="edit-field">
            <span>分组</span>
            <select class="shelf-select" bind:value={editGroupId}>
              <option value="">（未分组）</option>
              {#each facets.groups as g (g.id)}
                <option value={g.id}>{g.name}</option>
              {/each}
            </select>
          </div>

          <div class="edit-field">
            <span>标签（回车或逗号添加）</span>
            <div class="edit-tag-box">
              {#each editTags as t}
                <span class="edit-tag-chip">
                  {t}
                  <button class="edit-tag-del" title="移除" on:click={() => dropEditTag(t)}>✕</button>
                </span>
              {/each}
              <input
                class="edit-tag-input"
                bind:value={editTagInput}
                placeholder={editTags.length ? "" : "输入标签…"}
                on:keydown={onEditTagKey}
                on:blur={addEditTag}
              />
            </div>
            {#if facets.tags.length}
              <div class="shelf-sb-tags">
                {#each facets.tags as t (t.tag)}
                  <button
                    class="shelf-tag-chip"
                    on:click={() => {
                      if (!editTags.includes(t.tag)) editTags = [...editTags, t.tag];
                    }}>{t.tag}</button
                  >
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <div class="edit-actions">
          <button class="bookshelf-import-btn" on:click={saveEdit}>保存</button>
          <button class="import-fail-close" on:click={() => (editTarget = null)}>取消</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- A · 阅读统计可视化：模态面板（自身已含 edit-mask 遮罩） -->
  {#if showStats}
    <ReadingStatsPanel {store} on:close={() => (showStats = false)} />
  {/if}

  <!-- B · 在线书源（OPDS）：模态面板（自身已含 edit-mask 遮罩） -->
  {#if showOpds}
    <OpdsSearchPanel {store} on:close={() => (showOpds = false)} />
  {/if}

  <!-- C · 阅读知识图谱 / 画布联动：模态面板（自身已含 edit-mask 遮罩） -->
  {#if showGraph}
    <GraphPanel {store} {onOpen} on:close={() => (showGraph = false)} />
  {/if}

  <!-- 封面替换用的隐藏 input：必须位于主导入 input 之后（源码顺序） -->
  <input
    bind:this={coverInput}
    type="file"
    accept="image/*"
    style="display:none"
    on:change={onCoverChosen}
  />
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
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
    gap: 20px;
    padding: 16px;
    align-content: start;
  }
  /* 容器查询：右侧主区域变窄时自动缩小封面，避免 1–2 列被拉得很大 */
  @container shelf-main (max-width: 360px) {
    .bookshelf-grid {
      grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
      gap: 12px;
      padding: 12px;
    }
    .book-cover {
      border-radius: 8px;
    }
  }
  @container shelf-main (min-width: 361px) and (max-width: 520px) {
    .bookshelf-grid {
      grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
      gap: 14px;
      padding: 14px;
    }
  }
  .book-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    transition: transform 0.15s ease;
  }
  .book-card:hover {
    transform: translateY(-2px);
  }
  .book-cover {
    position: relative;
    aspect-ratio: 3 / 4;
    border-radius: 10px;
    border: none;
    cursor: pointer;
    background: linear-gradient(160deg, #185fa5, #0c447c);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    transition: box-shadow 0.2s ease;
  }
  .book-card:hover .book-cover {
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18);
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
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
    color: var(--b3-theme-on-background, #333);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 2.7em;
  }
  .book-author-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 3px;
  }
  .book-author {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .book-progress {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 500;
    color: var(--b3-theme-primary, #378add);
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
  /* 2026-08-29 网格视图：操作按钮收纳到封面悬停层 */
  .book-cover-overlay {
    position: absolute;
    inset: 0;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.55) 0%, rgba(0, 0, 0, 0.22) 45%, transparent 80%);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s ease;
  }
  .book-card:hover .book-cover-overlay,
  .book-cover-overlay:focus-within {
    opacity: 1;
    pointer-events: auto;
  }
  .book-overlay-primary {
    width: 100%;
    border: none;
    border-radius: 8px;
    padding: 7px 0;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    background: #fff;
    color: var(--b3-theme-on-background, #222);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
    transition: transform 0.1s ease, background 0.15s ease;
  }
  .book-overlay-primary:hover {
    background: var(--b3-theme-primary, #378add);
    color: #fff;
  }
  .book-overlay-primary:active {
    transform: scale(0.98);
  }
  .book-overlay-tools {
    display: flex;
    gap: 8px;
    justify-content: center;
  }
  .book-icon-btn {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    background: rgba(255, 255, 255, 0.92);
    color: var(--b3-theme-on-background, #333);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
    transition: background 0.15s ease, transform 0.1s ease;
  }
  .book-icon-btn:hover {
    background: #fff;
    transform: translateY(-1px);
  }
  .book-icon-btn.danger:hover {
    background: var(--b3-theme-error, #e24b4a);
    color: #fff;
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
  :global(.edit-mask) {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .import-fail-panel,
  :global(.edit-panel) {
    width: min(320px, 88%);
    max-height: 80%;
    background: var(--b3-theme-background, #fff);
    border-radius: 12px;
    padding: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.22);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .import-fail-title,
  :global(.edit-title) {
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

  /* ================================================================
   * 2026-08-29 书架 P0/P1：工具栏 / 侧栏 / 列表视图 / 批量 / 编辑扩展
   * 全部走 --b3-* 变量，自动跟随思源浅色/深色主题
   * ================================================================ */

  /* ---- 通用小按钮 ---- */
  .shelf-icon-btn {
    border: 1px solid transparent;
    background: none;
    border-radius: 6px;
    width: 26px;
    height: 26px;
    line-height: 1;
    font-size: 13px;
    cursor: pointer;
    color: var(--b3-theme-on-surface-light, #888);
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .shelf-icon-btn:hover {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.05));
    color: var(--b3-theme-on-background, #333);
  }
  .shelf-icon-btn.active {
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.14));
    color: var(--b3-theme-primary, #378add);
  }

  /* ---- 工具栏 ---- */
  .shelf-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .shelf-search {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 120px;
  }
  .shelf-search-icon {
    position: absolute;
    left: 7px;
    font-size: 11px;
    opacity: 0.55;
    pointer-events: none;
  }
  .shelf-search-input {
    width: 100%;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 6px;
    padding: 5px 24px 5px 24px;
    font-size: 12px;
    background: var(--b3-theme-background, #fff);
    color: var(--b3-theme-on-background, #333);
    outline: none;
  }
  .shelf-search-input:focus {
    border-color: var(--b3-theme-primary, #378add);
  }
  .shelf-search-clear {
    position: absolute;
    right: 4px;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
    padding: 2px 4px;
  }
  .shelf-select {
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 6px;
    padding: 4px 6px;
    font-size: 12px;
    background: var(--b3-theme-background, #fff);
    color: var(--b3-theme-on-background, #333);
    cursor: pointer;
    max-width: 110px;
  }
  .shelf-select:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .shelf-view-toggle {
    display: flex;
    gap: 2px;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.12));
    border-radius: 7px;
    padding: 1px;
  }
  .shelf-clear-filter {
    border: 1px solid var(--b3-theme-primary, #378add);
    background: none;
    color: var(--b3-theme-primary, #378add);
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
    flex-shrink: 0;
  }

  /* ---- 批量操作条 ---- */
  .shelf-batch-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.1));
    border-bottom: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .shelf-batch-count {
    font-size: 12px;
    font-weight: 500;
    color: var(--b3-theme-primary, #378add);
  }
  .shelf-batch-btn {
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    background: var(--b3-theme-background, #fff);
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
    color: var(--b3-theme-on-background, #333);
  }
  .shelf-batch-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .shelf-batch-btn.danger {
    color: var(--b3-theme-error, #e24b4a);
    border-color: var(--b3-theme-error, #e24b4a);
  }

  /* ---- 主体：侧栏 + 内容 ---- */
  .bookshelf-body {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }
  .shelf-sidebar {
    width: 200px;
    flex-shrink: 0;
    overflow-y: auto;
    padding: 12px 10px;
    border-right: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .shelf-main {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    container-type: inline-size;
    container-name: shelf-main;
  }
  .shelf-sb-block {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .shelf-sb-title {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--b3-theme-on-surface-light, #999);
    padding: 7px 4px 4px;
    margin-top: 2px;
  }
  .shelf-sb-title.toggle {
    border: none;
    background: none;
    width: 100%;
    text-align: left;
    cursor: pointer;
    color: inherit;
  }
  .shelf-sb-title.toggle:hover {
    color: var(--b3-theme-on-background, #333);
  }
  .shelf-sb-toggle {
    border: none;
    background: none;
    cursor: pointer;
    padding: 0;
    width: 14px;
    height: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--b3-theme-on-surface-light, #999);
    flex-shrink: 0;
  }
  .shelf-sb-caret {
    font-size: 9px;
    line-height: 1;
    transition: transform 0.15s ease;
    display: inline-block;
  }
  .shelf-sb-caret.closed {
    transform: rotate(-90deg);
  }
  .shelf-sb-title-text {
    cursor: pointer;
    user-select: none;
    flex: 1;
  }
  .shelf-sb-add {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    color: var(--b3-theme-primary, #378add);
    padding: 0 2px;
  }
  .shelf-sb-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    border: 1px solid transparent;
    background: none;
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 12px;
    cursor: pointer;
    color: var(--b3-theme-on-background, #333);
    text-align: left;
  }
  .shelf-sb-item:hover {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.05));
  }
  .shelf-sb-item.active {
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.14));
    color: var(--b3-theme-primary, #378add);
    font-weight: 500;
  }
  .shelf-sb-item.dropping {
    border-color: var(--b3-theme-primary, #378add);
    border-style: dashed;
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.18));
  }
  .shelf-sb-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .shelf-sb-num {
    min-width: 22px;
    padding: 1px 6px;
    border-radius: 10px;
    text-align: center;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: var(--b3-theme-on-surface-light, #888);
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.05));
    flex-shrink: 0;
  }
  .shelf-sb-item.active .shelf-sb-num {
    background: rgba(255, 255, 255, 0.28);
    color: inherit;
  }
  .shelf-sb-hint {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #999);
    padding: 3px 6px;
  }
  .shelf-sb-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 2px 4px;
  }
  .shelf-tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.14));
    background: none;
    border-radius: 10px;
    padding: 2px 7px;
    font-size: 11px;
    cursor: pointer;
    color: var(--b3-theme-on-background, #333);
  }
  .shelf-tag-chip:hover {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.05));
  }
  .shelf-tag-chip.active {
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.16));
    border-color: var(--b3-theme-primary, #378add);
    color: var(--b3-theme-primary, #378add);
  }
  .shelf-tag-num {
    font-size: 9px;
    opacity: 0.65;
  }

  /* ---- 卡片增强 ---- */
  .book-card.selected {
    outline: 2px solid var(--b3-theme-primary, #378add);
    outline-offset: 2px;
    border-radius: 10px;
  }
  .book-cover-wrap {
    position: relative;
    display: flex;
  }
  .book-cover-wrap .book-cover {
    width: 100%;
  }
  .book-sel,
  .book-fav {
    position: absolute;
    top: 4px;
    border: none;
    border-radius: 50%;
    width: 19px;
    height: 19px;
    line-height: 1;
    font-size: 11px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .book-sel {
    left: 4px;
    background: rgba(255, 255, 255, 0.9);
    color: var(--b3-theme-primary, #378add);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15);
  }
  .book-sel.on {
    background: var(--b3-theme-primary, #378add);
    color: #fff;
  }
  .book-fav {
    right: 4px;
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.85);
  }
  .book-fav.on {
    color: #ffc94d;
  }
  .book-status {
    position: absolute;
    bottom: 5px;
    left: 6px;
    border: none;
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 9px;
    cursor: pointer;
    background: rgba(0, 0, 0, 0.3);
    color: rgba(255, 255, 255, 0.8);
  }
  .book-status.reading {
    background: var(--b3-theme-primary, #378add);
    color: #fff;
  }
  .book-status.done {
    background: #3aa675;
    color: #fff;
  }
  .book-stars {
    font-size: 10px;
    color: #f0a93a;
    line-height: 1.2;
  }
  .book-stars-off {
    color: var(--b3-border-color, rgba(0, 0, 0, 0.18));
  }
  .book-tags {
    display: flex;
    gap: 3px;
    overflow: hidden;
  }
  .book-tag {
    font-size: 9px;
    padding: 0 4px;
    border-radius: 3px;
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.06));
    color: var(--b3-theme-on-surface-light, #888);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 46px;
  }
  .book-tag.more {
    flex-shrink: 0;
  }

  /* ---- 列表视图 ---- */
  .shelf-list {
    display: flex;
    flex-direction: column;
    padding: 6px 12px;
  }
  .shelf-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 6px;
    border-bottom: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.06));
    border-radius: 8px;
    min-width: 0;
    transition: background 0.15s ease;
  }
  .shelf-row:hover {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.04));
  }
  .shelf-row.selected {
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.1));
  }
  .row-sel {
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.2));
    background: var(--b3-theme-background, #fff);
    border-radius: 4px;
    width: 17px;
    height: 17px;
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
    color: var(--b3-theme-primary, #378add);
    padding: 0;
  }
  .row-sel.on {
    background: var(--b3-theme-primary, #378add);
    border-color: var(--b3-theme-primary, #378add);
    color: #fff;
  }
  .row-cover {
    position: relative;
    width: 40px;
    height: 56px;
    flex-shrink: 0;
    border: none;
    border-radius: 5px;
    overflow: hidden;
    cursor: pointer;
    background: linear-gradient(160deg, #185fa5, #0c447c);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  }
  .row-cover-text {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.92);
  }
  .row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .row-title-line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .row-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--b3-theme-on-background, #333);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-status-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.14));
    background: none;
    border-radius: 10px;
    padding: 1px 7px 1px 5px;
    font-size: 10px;
    cursor: pointer;
    flex-shrink: 0;
    color: var(--b3-theme-on-surface-light, #888);
    line-height: 1.4;
  }
  .row-status-chip::before {
    content: "";
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--b3-theme-primary, #378add);
    flex-shrink: 0;
  }
  .row-status-chip.reading {
    border-color: var(--b3-theme-primary, #378add);
    color: var(--b3-theme-primary, #378add);
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.1));
  }
  .row-status-chip.done {
    border-color: #3aa675;
    color: #3aa675;
    background: rgba(58, 166, 117, 0.1);
  }
  .row-status-chip.done::before {
    background: #3aa675;
  }
  .row-fav {
    color: #ffc94d;
    font-size: 11px;
    flex-shrink: 0;
  }
  .row-sub {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
  }
  .row-sub > * {
    flex-shrink: 0;
  }
  .row-author {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-progress {
    color: var(--b3-theme-primary, #378add);
    font-weight: 500;
  }
  .row-dot {
    opacity: 0.45;
  }
  .row-tag-chips {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 6px;
  }
  .row-tag {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.06));
    color: var(--b3-theme-on-surface-light, #888);
    white-space: nowrap;
  }
  .row-tag.more {
    background: transparent;
    padding-left: 0;
  }
  .row-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .row-btn {
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    background: var(--b3-theme-background, #fff);
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 12px;
    cursor: pointer;
    color: var(--b3-theme-on-background, #333);
    transition: background 0.15s;
  }
  .row-btn.primary {
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.12));
    border-color: transparent;
    color: var(--b3-theme-primary, #378add);
  }
  .row-btn:hover {
    filter: brightness(0.94);
  }
  .row-actions-extra {
    display: flex;
    align-items: center;
    gap: 4px;
    opacity: 0;
    transform: translateX(6px);
    transition: opacity 0.2s ease, transform 0.2s ease;
    pointer-events: none;
  }
  .shelf-row:hover .row-actions-extra {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
  }
  .row-icon-btn {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    background: var(--b3-theme-background, #fff);
    border-radius: 50%;
    font-size: 12px;
    cursor: pointer;
    color: var(--b3-theme-on-surface-light, #666);
    padding: 0;
    transition: background 0.15s, color 0.15s;
  }
  .row-icon-btn:hover {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.06));
    color: var(--b3-theme-on-background, #333);
  }
  .row-icon-btn.danger {
    color: var(--b3-theme-error, #e24b4a);
  }
  .row-icon-btn.danger:hover {
    background: rgba(226, 75, 74, 0.08);
  }
  /* 窄面板（dock 侧栏）下隐藏标签与次要操作，避免挤压 */
  @media (max-width: 620px) {
    .row-tag-chips,
    .row-actions-extra {
      display: none;
    }
    .row-author {
      max-width: 90px;
    }
  }
  @media (max-width: 480px) {
    .row-cover {
      width: 34px;
      height: 48px;
    }
    .row-sub > :nth-child(n+8) {
      display: none;
    }
  }

  /* ---- 分组管理弹窗 ---- */
  .group-new {
    display: flex;
    gap: 6px;
  }
  .group-new input,
  .group-rename {
    flex: 1;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 12px;
    background: var(--b3-theme-background, #fff);
    color: var(--b3-theme-on-background, #333);
    outline: none;
  }
  .group-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 200px;
    overflow-y: auto;
  }
  .group-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 6px;
    border-radius: 6px;
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.04));
  }
  .group-name {
    flex: 1;
    font-size: 12px;
    color: var(--b3-theme-on-background, #333);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .group-count {
    font-size: 10px;
    color: var(--b3-theme-on-surface-light, #999);
    flex-shrink: 0;
  }
  .group-op {
    border: none;
    background: none;
    font-size: 11px;
    cursor: pointer;
    color: var(--b3-theme-primary, #378add);
    padding: 2px 4px;
    flex-shrink: 0;
  }
  .group-op.danger {
    color: var(--b3-theme-error, #e24b4a);
  }

  /* ---- 编辑弹窗扩展 ---- */
  .edit-panel.wide {
    width: min(360px, 92%);
  }
  .edit-scroll {
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
    max-height: 62vh;
    padding-right: 2px;
  }
  .edit-cover-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .edit-cover-preview {
    position: relative;
    width: 62px;
    aspect-ratio: 3 / 4;
    border-radius: 6px;
    overflow: hidden;
    flex-shrink: 0;
    background: linear-gradient(160deg, #185fa5, #0c447c);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .edit-cover-ops {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
  }
  .edit-cover-ops .book-btn {
    flex: initial;
    padding: 4px 10px;
  }
  .edit-hint {
    font-size: 10.5px;
    color: var(--b3-theme-on-surface-light, #999);
  }
  .edit-inline-check {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--b3-theme-on-background, #333);
    cursor: pointer;
    user-select: none;
  }
  .edit-seg {
    display: flex;
    gap: 3px;
  }
  .edit-seg-btn {
    flex: 1;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    background: none;
    border-radius: 6px;
    padding: 4px 0;
    font-size: 12px;
    cursor: pointer;
    color: var(--b3-theme-on-background, #333);
  }
  .edit-seg-btn.on {
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.16));
    border-color: var(--b3-theme-primary, #378add);
    color: var(--b3-theme-primary, #378add);
    font-weight: 500;
  }
  .edit-stars {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .edit-star {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 17px;
    line-height: 1;
    padding: 0 1px;
    color: var(--b3-border-color, rgba(0, 0, 0, 0.2));
  }
  .edit-star.on {
    color: #f0a93a;
  }
  .edit-star-clear {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #999);
    margin-left: 4px;
  }
  .edit-tag-box {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 6px;
    padding: 4px 6px;
    background: var(--b3-theme-background, #fff);
  }
  .edit-tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    padding: 2px 4px 2px 7px;
    border-radius: 10px;
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.14));
    color: var(--b3-theme-primary, #378add);
  }
  .edit-tag-del {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 9px;
    color: inherit;
    padding: 0 2px;
    line-height: 1;
  }
  .edit-tag-input {
    flex: 1;
    min-width: 60px;
    border: none !important;
    outline: none;
    font-size: 12px;
    background: transparent;
    color: var(--b3-theme-on-background, #333);
    padding: 2px 0 !important;
  }
</style>
