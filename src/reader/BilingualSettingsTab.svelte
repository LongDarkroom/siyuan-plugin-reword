<script lang="ts">
  /**
   * 双语翻译设置 - Dialog 弹窗内容（2026-08-31 Phase 4 → 弹窗化）
   * 左侧类目导航 + 右侧参数面板；子页：预翻译全书 / 渐进式翻译 / 引擎设置 / 监督中心 / 缓存管理 / 术语表 / 翻译风格 / 显示与界面。
   * 数据源：settingsStore（阅读设置 bilingual* + 目标语言）+ AiSettings（引擎/配额）。
   * AI 设置落盘经 350ms 防抖，避免滑块拖动 / 逐字符输入时高频写盘卡死主线程。
   */
  import { onMount } from "svelte";
  import { DEFAULT_TRANSLATE_PROMPT, DEFAULT_TRANSLATE_PROMPT_NATURAL } from "../ai/ai-settings";

  export let settingsStore: any; // ReaderSettingsStore（含 get/update/subscribe）
  export let getAiSettings: () => any;
  export let onSaveAiSettings: (partial: any) => Promise<void> | void;
  export let listCachedBooks: () => Promise<Array<{ bookId: string; title: string; updated?: number }>>;
  export let getTranslationCacheStats: (bookId: string) => Promise<any>;
  export let clearTranslationCache: (bookId: string) => Promise<void>;
  export let cleanOrphanTranslationCaches: () => Promise<number>;
  export let testEngine: (id: string) => Promise<{ ok: boolean; provider?: string; error?: string }>;
  export let resetEngineUsage: (id: string) => Promise<void> | void;
  export let resetAiTokenUsage: () => Promise<void> | void;
  export let getGlossaryTerms: () => Array<{ src: string; dst: string; caseSensitive?: boolean; note?: string }>;
  export let setGlossaryTerms: (terms: Array<{ src: string; dst: string; caseSensitive?: boolean; note?: string }>) => Promise<void> | void;
  // 2026-08-31 Task A：双语「按书记忆」模式（列出全部已记忆书籍 / 清除某本记忆）
  export let listBilingualBookModes: () => Promise<Array<{ bookId: string; mode: "whole-book" | "progressive"; title: string }>>;
  export let clearBilingualBookMode: (bookId: string) => Promise<void> | void;

  // ----- 子页切换 -----
  const TABS = [
    { id: "whole-book", label: "预翻译全书" },
    { id: "progressive", label: "渐进式翻译" },
    { id: "engine", label: "引擎设置" },
    { id: "monitor", label: "监督中心" },
    { id: "cache", label: "缓存管理" },
    { id: "glossary", label: "术语表" },
    { id: "style", label: "翻译风格" },
    { id: "display", label: "显示与界面" },
  ];
  let activeTab = "whole-book";

  // ----- AI 设置本地副本 -----
  let ai: any = getAiSettings() || {};
  // 输入控件直接绑定的本地副本（避免受控 value + on:input 在某些浏览器里触发循环事件）。
  let localAi: any = { aiTokenAlertRatio: 0.8, trTemperature: 0.1, maxTokens: 2048, trBatchSize: 8, trConcurrency: 2, ...ai };
  function reloadAi() {
    // 必须展开成新对象。getAiSettings() 返回的是插件内部同一个可变对象引用，
    // Svelte 对「同一引用重新赋值」可能跳过刷新；展开后保证 ai/localAi 都是新引用，
    // 这样「重置用量」等外部mutation才能立即反映到UI。
    ai = { ...(getAiSettings() || {}) };
    localAi = { aiTokenAlertRatio: 0.8, trTemperature: 0.1, maxTokens: 2048, trBatchSize: 8, trConcurrency: 2, ...ai };
  }
  // 防抖持久化：文本/滑块在输入期间只更新 localAi，on:change 时批量落盘；
  // 避免拖动滑块或逐字符输入时高频写盘卡死主线程。
  let _aiSaveTimer: any = null;
  let _aiPending: any = {};
  async function saveAi(patch: any) {
    ai = { ...ai, ...patch };
    localAi = { ...localAi, ...patch };
    _aiPending = { ..._aiPending, ...patch };
    if (_aiSaveTimer) clearTimeout(_aiSaveTimer);
    _aiSaveTimer = setTimeout(async () => {
      _aiSaveTimer = null;
      const toSave = _aiPending;
      _aiPending = {};
      try {
        await onSaveAiSettings(toSave);
      } catch (e) {
        console.warn("[REword] 保存 AI 设置失败:", e);
      }
    }, 350);
  }
  async function resetEngineUsageAndReload(id: string) {
    try { await resetEngineUsage(id); } catch {}
    reloadAi();
  }
  async function resetAiTokenUsageAndReload() {
    try { await resetAiTokenUsage(); } catch {}
    reloadAi();
  }

  // ----- 阅读设置快捷更新 -----
  function patchSettings(patch: any) {
    settingsStore.update(patch);
  }

  // ----- 引擎测试 -----
  const ENGINES = [
    { id: "tencent", name: "腾讯云翻译", secret: "SecretKey", idLabel: "SecretId" },
    { id: "baidu", name: "百度翻译", secret: "密钥", idLabel: "AppId" },
    { id: "youdao", name: "有道智云", secret: "AppSecret", idLabel: "AppKey" },
    { id: "ai", name: "AI 翻译（兜底）", secret: "API Key", idLabel: "Base URL" },
  ];
  let testing: Record<string, boolean> = {};
  let testResult: Record<string, { ok: boolean; provider?: string; error?: string }> = {};
  async function runTest(id: string) {
    testing[id] = true;
    testResult[id] = undefined as any;
    try {
      testResult[id] = await testEngine(id);
    } catch (e: any) {
      testResult[id] = { ok: false, error: String(e?.message ?? e) };
    } finally {
      testing[id] = false;
    }
  }

  // ----- 监督中心 -----
  function usedOf(id: string): number {
    if (id === "tencent") return ai.tencentCharsUsed || 0;
    if (id === "baidu") return ai.baiduCharsUsed || 0;
    if (id === "youdao") return ai.youdaoCharsUsed || 0;
    return 0;
  }
  function lockOf(id: string): number {
    if (id === "tencent") return ai.tencentCharsLock || 0;
    if (id === "baidu") return ai.baiduCharsLock || 0;
    if (id === "youdao") return ai.youdaoCharsLock || 0;
    return 0;
  }
  function ratioColor(ratio: number): string {
    if (ratio >= 1) return "var(--b3-theme-error, #e5484d)";
    if (ratio >= (ai.aiTokenAlertRatio ?? 0.8)) return "var(--b3-theme-warning, #e8a33d)";
    return "var(--b3-theme-success, #4caf72)";
  }
  function pct(n: number, d: number): number {
    if (!d) return 0;
    return Math.min(100, Math.round((n / d) * 100));
  }
  function ratio(n: number, d: number): number {
    if (!d) return 0;
    return Math.min(1, n / d);
  }
  function idFieldFor(id: string): string {
    if (id === "tencent") return "tencentSecretId";
    if (id === "baidu") return "baiduAppId";
    if (id === "youdao") return "youdaoAppKey";
    return "";
  }
  function secretFieldFor(id: string): string {
    if (id === "tencent") return "tencentSecretKey";
    if (id === "baidu") return "baiduKey";
    if (id === "youdao") return "youdaoAppSecret";
    return "";
  }
  function lockFieldFor(id: string): string {
    if (id === "tencent") return "tencentCharsLock";
    if (id === "baidu") return "baiduCharsLock";
    if (id === "youdao") return "youdaoCharsLock";
    return "";
  }
  let cacheMsg = "";
  async function exportCsv() {
    const rows = [
      ["引擎", "已用字符/Token", "用量锁/上限", "状态"],
      ["腾讯云翻译", String(ai.tencentCharsUsed || 0), String(ai.tencentCharsLock || 0), lockOf("tencent") && (ai.tencentCharsUsed || 0) >= lockOf("tencent") ? "已锁定" : "正常"],
      ["百度翻译", String(ai.baiduCharsUsed || 0), String(ai.baiduCharsLock || 0), lockOf("baidu") && (ai.baiduCharsUsed || 0) >= lockOf("baidu") ? "已锁定" : "正常"],
      ["有道智云", String(ai.youdaoCharsUsed || 0), String(ai.youdaoCharsLock || 0), lockOf("youdao") && (ai.youdaoCharsUsed || 0) >= lockOf("youdao") ? "已锁定" : "正常"],
      ["AI 翻译(Token)", String(ai.aiTokenUsed || 0), String(ai.aiTokenLimit || 0), ai.aiTokenLimit && (ai.aiTokenUsed || 0) >= ai.aiTokenLimit ? "已超上限" : "正常"],
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reword-translation-usage.csv";
    a.click();
    URL.revokeObjectURL(url);
    cacheMsg = "已导出用量 CSV";
  }

  // ----- 缓存管理 -----
  let books: Array<{
    bookId: string;
    title: string;
    count: number;
    cachedPages: number;
    pageRangeText: string;
    updated?: number;
  }> = [];
  let loadingCache = false;
  let cacheLoaded = false;
  let cacheSearch = "";
  let cacheSort: "count" | "title" | "recent" = "count";
  // 段数总计（顶部摘要）
  $: totalSegments = books.reduce((n, b) => n + (b.count || 0), 0);
  // 搜索：书名 + bookId 均可命中
  $: filteredBooks = books.filter((b) => {
    const q = cacheSearch.trim().toLowerCase();
    if (!q) return true;
    return (b.title || "").toLowerCase().includes(q) || (b.bookId || "").toLowerCase().includes(q);
  });
  /** 相对时间：3 分钟内→刚刚 / 小时内→N 分钟前 / 天内→N 小时前 / 否则 N 天前 */
  function relTime(ts?: number): string {
    if (!ts) return "";
    const sec = Math.floor(Date.now() / 1000) - ts;
    if (sec < 0) return "";
    if (sec < 180) return "刚刚";
    if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
    const d = Math.floor(sec / 86400);
    if (d < 30) return `${d} 天前`;
    return `${Math.floor(d / 30)} 个月前`;
  }
  // 排序：段数 / 书名 / 最近缓存
  $: sortedBooks = [...filteredBooks].sort((a, b) => {
    if (cacheSort === "count") return (b.count || 0) - (a.count || 0);
    if (cacheSort === "title") {
      const ta = (a.title || "").toLowerCase();
      const tb = (b.title || "").toLowerCase();
      if (ta !== tb) return ta.localeCompare(tb, "zh");
      return a.bookId.localeCompare(b.bookId);
    }
    // recent：按缓存文件更新时间倒序；都没有 updated 时退化按页数
    const ua = a.updated || 0;
    const ub = b.updated || 0;
    if (ua !== ub) return ub - ua;
    return (b.cachedPages || 0) - (a.cachedPages || 0);
  });
  async function loadCache() {
    if (loadingCache) return;
    loadingCache = true;
    cacheLoaded = true;
    cacheMsg = "";
    try {
      const list = await listCachedBooks();
      const details = await Promise.all(
        list.map(async (b) => {
          try {
            const st = await getTranslationCacheStats(b.bookId);
            return { ...b, count: st?.count || 0, cachedPages: st?.cachedPages || 0, pageRangeText: st?.pageRangeText || "" };
          } catch {
            return { ...b, count: 0, cachedPages: 0, pageRangeText: "" };
          }
        })
      );
      books = details;
    } catch (e) {
      console.warn("[REword] 加载缓存列表失败:", e);
    } finally {
      loadingCache = false;
    }
  }
  async function delBook(bid: string) {
    const b = books.find((x) => x.bookId === bid);
    const label = b?.title || `ID ${bid}`;
    const n = b?.count || 0;
    if (!confirm(`确定删除「${label}」的翻译缓存？\n共 ${n} 段，删除后再次翻译会重新消耗额度。`)) return;
    await clearTranslationCache(bid);
    cacheMsg = `已删除「${label}」的缓存（${n} 段）`;
    await loadCache();
  }
  async function cleanOrphan() {
    const n = await cleanOrphanTranslationCaches();
    cacheMsg = n
      ? `已清理 ${n} 本无效缓存（书架已删除的书）`
      : "没有需要清理的缓存（书架为空时会自动跳过，避免误删）";
    await loadCache();
  }
  async function clearAllCache() {
    if (!confirm(`确定清空全部 ${books.length} 本书的翻译缓存（共 ${totalSegments} 段）？\n此操作不可撤销。`)) return;
    for (const b of books) {
      try {
        await clearTranslationCache(b.bookId);
      } catch {}
    }
    await loadCache();
  }

  // ----- 术语表（新增子页） -----
  let glossary: Array<{ src: string; dst: string; caseSensitive?: boolean }> = [];
  let glossaryLoaded = false;
  let glossMsg = "";
  let newGlossSrc = "";
  let newGlossDst = "";
  let newGlossCase = false;
  function loadGlossary() {
    try {
      glossary = (getGlossaryTerms?.() || []).map((t) => ({ src: t.src, dst: t.dst, caseSensitive: !!t.caseSensitive }));
    } catch {
      glossary = [];
    }
    glossaryLoaded = true;
  }
  async function persistGlossary() {
    const clean = glossary.filter((t) => t && t.src && t.src.trim());
    try {
      await setGlossaryTerms?.(clean);
      glossMsg = `术语表已保存（${clean.length} 条）`;
    } catch (e: any) {
      glossMsg = "保存失败：" + String(e?.message ?? e);
    }
  }
  function addGlossTerm() {
    if (!newGlossSrc.trim()) { glossMsg = "原文术语不能为空"; return; }
    glossary = [...glossary, { src: newGlossSrc.trim(), dst: newGlossDst.trim(), caseSensitive: newGlossCase }];
    newGlossSrc = ""; newGlossDst = ""; newGlossCase = false;
    persistGlossary();
  }
  function removeGlossTerm(i: number) {
    if (!confirm("删除该术语？")) return;
    glossary = glossary.filter((_, idx) => idx !== i);
    persistGlossary();
  }
  function clearGlossary() {
    if (!confirm("清空全部术语表？此操作不可撤销。")) return;
    glossary = [];
    persistGlossary();
  }

  // ----- 双语翻译「按书记忆」（Task A，2026-08-31） -----
  let bookModes: Array<{ bookId: string; mode: "whole-book" | "progressive"; title: string }> = [];
  let bookModesLoaded = false;
  async function loadBookModes() {
    try {
      bookModes = (await listBilingualBookModes?.()) ?? [];
    } catch {
      bookModes = [];
    }
    bookModesLoaded = true;
  }
  async function clearBookMode(bid: string) {
    await clearBilingualBookMode?.(bid);
    await loadBookModes();
  }
  const BOOK_MODE_LABEL: Record<string, string> = { "whole-book": "整书预翻译", progressive: "渐进式翻译" };

  // ----- 翻译风格（新增子页） -----
  function applyStyle(v: "literal" | "natural") {
    saveAi({
      bilingualStyle: v,
      translatePrompt: v === "natural" ? DEFAULT_TRANSLATE_PROMPT_NATURAL : DEFAULT_TRANSLATE_PROMPT,
    });
    glossMsg = "";
  }

  // ----- 显示与界面（新增子页） -----
  const ORDERABLE = ["tencent", "baidu", "youdao"];
  const ENGINE_LABELS: Record<string, string> = {
    tencent: "腾讯云翻译", baidu: "百度翻译", youdao: "有道智云",
  };
  const OTHER_ENGINES = ["microsoft", "libretranslate"];
  let engOrder: string[] = (ai.translatePriority || []).filter((id: string) => ORDERABLE.includes(id));
  ORDERABLE.forEach((id) => { if (!engOrder.includes(id)) engOrder.push(id); });
  function moveEng(i: number, dir: number) {
    const j = i + dir;
    if (j < 0 || j >= engOrder.length) return;
    const arr = [...engOrder];
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    engOrder = arr;
    saveAi({ translatePriority: [...arr, ...OTHER_ENGINES] });
  }

  // 进入缓存页时懒加载（用 cacheLoaded 做一次性守卫；空列表时若只用 !books.length 会无限循环）
  $: if (activeTab === "cache") {
    if (!cacheLoaded && !loadingCache) loadCache();
  } else {
    cacheLoaded = false;
  }
  // 进入术语表页时懒加载
  $: if (activeTab === "glossary" && !glossaryLoaded) loadGlossary();
  // 进入显示与界面页时同步已保存的引擎顺序
  $: if (activeTab === "display") {
    engOrder = (ai.translatePriority || []).filter((id: string) => ORDERABLE.includes(id));
    ORDERABLE.forEach((id) => { if (!engOrder.includes(id)) engOrder.push(id); });
    // 2026-08-31 Task A：同步加载「按书记忆」列表
    if (!bookModesLoaded) loadBookModes();
  }

  onMount(() => {
    reloadAi();
  });
</script>

<div class="bset-root">
  <header class="bset-head">
    <div class="bset-title">双语翻译设置</div>
    <div class="bset-default">
      <span class="bset-default-label">点击「双语」时默认</span>
      <div class="bset-seg">
        <button
          class="bset-seg-btn"
          class:active={$settingsStore.bilingualDefaultMode !== "whole-book" && $settingsStore.bilingualDefaultMode !== "progressive"}
          on:click={() => patchSettings({ bilingualDefaultMode: "ask" })}>询问我</button>
        <button
          class="bset-seg-btn"
          class:active={$settingsStore.bilingualDefaultMode === "whole-book"}
          on:click={() => patchSettings({ bilingualDefaultMode: "whole-book" })}>整书预翻译</button>
        <button
          class="bset-seg-btn"
          class:active={$settingsStore.bilingualDefaultMode === "progressive"}
          on:click={() => patchSettings({ bilingualDefaultMode: "progressive" })}>渐进式</button>
      </div>
    </div>
  </header>

  <div class="bset-body">
    <nav class="bset-rail">
      {#each TABS as t (t.id)}
        <button class="bset-rail-btn" class:active={activeTab === t.id} on:click={() => (activeTab = t.id)}>{t.label}</button>
      {/each}
    </nav>

    <section class="bset-content">
      <!-- ============ 预翻译全书 ============ -->
      {#if activeTab === "whole-book"}
        <div class="bset-card">
          <div class="bset-card-title">整书预翻译</div>
          <p class="bset-desc">
            打开一本英文书 → 点击「双语」→ 选「整书预翻译」：边读边显示译文，其余段落在后台翻译并写入缓存。
            完成后翻页 / 重开本书都命中缓存秒出，不再消耗 AI Token。
          </p>
          <div class="bset-row">
            <span class="bset-label">源语言</span>
            <select class="bset-select" value={$settingsStore.bilingualSourceLang || "en"} on:change={(e) => patchSettings({ bilingualSourceLang: e.target.value })}>
              <option value="en">英语（默认）</option>
              <option value="auto">自动检测</option>
              <option value="ja">日语</option>
              <option value="fr">法语</option>
              <option value="de">德语</option>
              <option value="ko">韩语</option>
              <option value="ru">俄语</option>
            </select>
          </div>
          <div class="bset-row">
            <span class="bset-label">目标语言</span>
            <select class="bset-select" value={$settingsStore.bilingualTarget || "zh"} on:change={(e) => patchSettings({ bilingualTarget: e.target.value })}>
              <option value="zh">中文（简体）</option>
              <option value="zh-Hant">中文（繁体）</option>
              <option value="en">英语</option>
              <option value="ja">日语</option>
              <option value="ko">韩语</option>
              <option value="fr">法语</option>
              <option value="de">德语</option>
              <option value="es">西班牙语</option>
              <option value="ru">俄语</option>
            </select>
          </div>
          <div class="bset-row">
            <span class="bset-label" title="翻译时跳过已缓存段落，避免重复消耗">跳过已缓存</span>
            <label class="bset-switch"><input type="checkbox" checked={$settingsStore.bilingualSkipCached !== false} on:change={(e) => patchSettings({ bilingualSkipCached: e.target.checked })} /><span class="bset-track"></span></label>
          </div>
          <div class="bset-row">
            <span class="bset-label" title="边译边显示译文；关闭则纯后台缓存">实时预览译文</span>
            <label class="bset-switch"><input type="checkbox" checked={$settingsStore.bilingualRealtimePreview !== false} on:change={(e) => patchSettings({ bilingualRealtimePreview: e.target.checked })} /><span class="bset-track"></span></label>
          </div>
          <div class="bset-grid2">
            <div class="bset-row">
              <span class="bset-label">每批段数</span>
              <input class="bset-input" type="number" min="1" max="30" step="1" bind:value={localAi.trBatchSize} on:change={() => saveAi({ trBatchSize: parseInt(localAi.trBatchSize) || 8 })} />
            </div>
            <div class="bset-row">
              <span class="bset-label">并发请求数</span>
              <input class="bset-input" type="number" min="1" max="8" step="1" bind:value={localAi.trConcurrency} on:change={() => saveAi({ trConcurrency: parseInt(localAi.trConcurrency) || 2 })} />
            </div>
          </div>
        </div>
      {/if}

      <!-- ============ 渐进式翻译 ============ -->
      {#if activeTab === "progressive"}
        <div class="bset-card">
          <div class="bset-card-title">渐进式翻译</div>
          <p class="bset-desc">
            只翻译「当前页 + 后续 N 页」窗口内的段落并缓存，随阅读进度自动向前补译。
            轻量、即时，适合只想边读边看译文、不想整本烧 Token 的场景。
          </p>
          <div class="bset-row">
            <span class="bset-label" title="当前页之后额外预译并缓存的「页」数（默认 2）">窗口页数</span>
            <div class="bset-stepper">
              <button class="bset-mini" on:click={() => patchSettings({ bilingualPrefetchPages: Math.max(0, ($settingsStore.bilingualPrefetchPages ?? 2) - 1) })}>-</button>
              <span class="bset-value">{$settingsStore.bilingualPrefetchPages ?? 2} 页</span>
              <button class="bset-mini" on:click={() => patchSettings({ bilingualPrefetchPages: ($settingsStore.bilingualPrefetchPages ?? 2) + 1 })}>+</button>
            </div>
          </div>
          <div class="bset-row">
            <span class="bset-label" title="翻页时自动补译当前窗口">翻页自动补译</span>
            <label class="bset-switch"><input type="checkbox" checked={$settingsStore.bilingualProgressiveAuto !== false} on:change={(e) => patchSettings({ bilingualProgressiveAuto: e.target.checked })} /><span class="bset-track"></span></label>
          </div>
          <div class="bset-row">
            <span class="bset-label">跳过已缓存</span>
            <label class="bset-switch"><input type="checkbox" checked={$settingsStore.bilingualSkipCached !== false} on:change={(e) => patchSettings({ bilingualSkipCached: e.target.checked })} /><span class="bset-track"></span></label>
          </div>
          <div class="bset-row">
            <span class="bset-label" title="达到用量上限即停止预取，避免超额">用量告警阈值</span>
            <input class="bset-range" type="range" min="0.5" max="1" step="0.05" value={$settingsStore.bilingualAlertRatio ?? 0.8} on:change={(e) => patchSettings({ bilingualAlertRatio: parseFloat(e.target.value) })} />
            <span class="bset-value">{Math.round(($settingsStore.bilingualAlertRatio ?? 0.8) * 100)}%</span>
          </div>
        </div>
      {/if}

      <!-- ============ 引擎设置 ============ -->
      {#if activeTab === "engine"}
        <div class="bset-card">
          <div class="bset-card-title">翻译引擎</div>
          <p class="bset-desc">免费引擎（腾讯 / 百度 / 有道）按优先级在前，AI 永远兜底。免费额度内的段落不消耗任何 AI Token。</p>

          {#each ENGINES as eng (eng.id)}
            <div class="bset-engine">
              <div class="bset-engine-head">
                <span class="bset-engine-name">{eng.name}</span>
                {#if eng.id !== "ai"}
                  <label class="bset-check"><input type="checkbox" checked={!!ai[eng.id + "Enabled"]} on:change={(e) => saveAi({ [eng.id + "Enabled"]: e.target.checked })} /><span>启用</span></label>
                {:else}
                  <label class="bset-check"><input type="checkbox" checked={!!ai.enabled} on:change={(e) => saveAi({ enabled: e.target.checked })} /><span>启用</span></label>
                {/if}
                <button class="bset-test" on:click={() => runTest(eng.id)} disabled={testing[eng.id]}>
                  {testing[eng.id] ? "测试中…" : "测试连接"}
                </button>
                {#if testResult[eng.id]}
                  <span class="bset-test-result" class:ok={testResult[eng.id].ok} class:fail={!testResult[eng.id].ok}>
                    {testResult[eng.id].ok ? "✓ " + (testResult[eng.id].provider || "成功") : "✗ " + (testResult[eng.id].error || "失败")}
                  </span>
                {/if}
              </div>

              {#if eng.id === "ai"}
                <div class="bset-engine-fields">
                  <input class="bset-input" type="text" placeholder="https://api.openai.com/v1" bind:value={localAi.baseUrl} on:change={() => saveAi({ baseUrl: localAi.baseUrl })} />
                  <input class="bset-input" type="password" placeholder="API Key" bind:value={localAi.apiKey} on:change={() => saveAi({ apiKey: localAi.apiKey })} />
                  <input class="bset-input" type="text" placeholder="模型（如 gpt-4o-mini）" bind:value={localAi.model} on:change={() => saveAi({ model: localAi.model })} />
                </div>
                <div class="bset-grid2">
                  <div class="bset-row">
                    <span class="bset-label">翻译温度</span>
                    <input class="bset-range" type="range" min="0" max="1" step="0.05" bind:value={localAi.trTemperature} on:change={() => saveAi({ trTemperature: parseFloat(localAi.trTemperature) })} />
                    <span class="bset-value">{(localAi.trTemperature ?? 0.1).toFixed(2)}</span>
                  </div>
                  <div class="bset-row">
                    <span class="bset-label">最大 Token</span>
                    <input class="bset-input" type="number" min="16" max="32768" step="16" bind:value={localAi.maxTokens} on:change={() => saveAi({ maxTokens: parseInt(localAi.maxTokens) || 2048 })} />
                  </div>
                </div>
                <div class="bset-row bset-row-col">
                  <span class="bset-label">翻译提示词（{((localAi.translatePrompt || "").length)} 字符，上限 2000）</span>
                  <textarea class="bset-textarea" rows="4" maxlength="2000" bind:value={localAi.translatePrompt} on:change={() => saveAi({ translatePrompt: localAi.translatePrompt })}></textarea>
                </div>
              {:else}
                <div class="bset-engine-fields">
                  <input class="bset-input" type="text" placeholder={eng.idLabel} bind:value={localAi[idFieldFor(eng.id)]} on:change={() => saveAi({ [idFieldFor(eng.id)]: localAi[idFieldFor(eng.id)] })} />
                  <input class="bset-input" type="password" placeholder={eng.secret} bind:value={localAi[secretFieldFor(eng.id)]} on:change={() => saveAi({ [secretFieldFor(eng.id)]: localAi[secretFieldFor(eng.id)] })} />
                </div>
                <div class="bset-row">
                  <span class="bset-label">用量锁（0=不限）</span>
                  <input class="bset-input" type="number" min="0" step="10000" bind:value={localAi[lockFieldFor(eng.id)]} on:change={() => saveAi({ [lockFieldFor(eng.id)]: parseInt(localAi[lockFieldFor(eng.id)]) || 0 })} />
                  <span class="bset-used">已用 {((usedOf(eng.id) || 0) / 10000).toFixed(1)} 万</span>
                  <button class="bset-mini" on:click={() => resetEngineUsageAndReload(eng.id)}>重置用量</button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <!-- ============ 监督中心 ============ -->
      {#if activeTab === "monitor"}
        <div class="bset-card">
          <div class="bset-card-title">用量监督中心</div>
          <p class="bset-desc">实时查看各引擎免费额度消耗与 AI Token 占用，避免超出免费额度。达到告警阈值（黄）即提示，达 100%（红）将触发停止/提示。</p>

          {#each ENGINES as eng (eng.id)}
            {#if eng.id !== "ai"}
              <div class="bset-mon">
                <div class="bset-mon-head">
                  <span class="bset-mon-name">{eng.name}</span>
                  <span class="bset-mon-num">{usedOf(eng.id)} / {lockOf(eng.id) || "不限"} 字符</span>
                </div>
                <div class="bset-bar"><div class="bset-bar-fill" style="width:{pct(usedOf(eng.id), lockOf(eng.id))}%;background:{ratioColor(ratio(usedOf(eng.id), lockOf(eng.id)))}"></div></div>
              </div>
            {/if}
          {/each}

          <div class="bset-mon">
            <div class="bset-mon-head">
              <span class="bset-mon-name">AI 翻译（Token）</span>
              <span class="bset-mon-num">{(ai.aiTokenUsed || 0)} / {(ai.aiTokenLimit || 0) || "不限"}</span>
            </div>
            <div class="bset-bar"><div class="bset-bar-fill" style="width:{pct(ai.aiTokenUsed || 0, ai.aiTokenLimit || 0)}%;background:{ratioColor(ratio(ai.aiTokenUsed || 0, ai.aiTokenLimit || 0))}"></div></div>
            <div class="bset-row" style="margin-top:10px">
              <span class="bset-label">Token 告警阈值</span>
              <input class="bset-range" type="range" min="0.5" max="1" step="0.05" bind:value={localAi.aiTokenAlertRatio} on:change={() => saveAi({ aiTokenAlertRatio: parseFloat(localAi.aiTokenAlertRatio) })} />
              <span class="bset-value">{Math.round((localAi.aiTokenAlertRatio ?? 0.8) * 100)}%</span>
              <button class="bset-mini" on:click={() => resetAiTokenUsageAndReload()}>重置 Token</button>
            </div>
          </div>

          <div class="bset-actions">
            <button class="bset-btn" on:click={exportCsv}>导出用量 CSV</button>
          </div>
          {#if cacheMsg}<div class="bset-msg">{cacheMsg}</div>{/if}
        </div>
      {/if}

      <!-- ============ 缓存管理 ============ -->
      {#if activeTab === "cache"}
        <div class="bset-card">
          <div class="bset-card-title">翻译缓存管理</div>
          <p class="bset-desc">译文按书缓存于本地（JSON + 可选思源 SQLite）。删除缓存后再次翻译会重新消耗额度。</p>
          <div class="bset-cache-summary">
            <span><b>{books.length}</b> 本</span>
            <span><b>{totalSegments}</b> 段</span>
            <span><b>{books.filter((b) => !b.title).length}</b> 本待识别</span>
            <button class="bset-mini" on:click={loadCache}>刷新</button>
          </div>
          <div class="bset-cache-tools">
            <input class="bset-input" type="text" placeholder="🔍 搜索书名 / bookId" bind:value={cacheSearch} />
            <select class="bset-input bset-select" bind:value={cacheSort}>
              <option value="count">按段数（多→少）</option>
              <option value="title">按书名</option>
              <option value="recent">按最近缓存</option>
            </select>
            <button class="bset-btn" on:click={cleanOrphan}>清理无效缓存</button>
            <button class="bset-btn bset-btn-danger" on:click={clearAllCache}>清空全部</button>
          </div>
          {#if loadingCache}
            <div class="bset-loading">加载缓存列表…</div>
          {:else if sortedBooks.length === 0}
            <div class="bset-empty">{books.length ? "没有匹配的缓存" : "暂无翻译缓存"}</div>
          {:else}
            <div class="bset-book-list">
              {#each sortedBooks as b (b.bookId)}
                <div class="bset-book">
                  <div class="bset-book-info">
                    <div class="bset-book-title">
                      {b.title || "(未命名)"}
                      {#if !b.title}<span class="bset-badge">无书名</span>{/if}
                    </div>
                    <div class="bset-book-meta">
                      {b.count} 段 · {b.cachedPages} 页{b.pageRangeText ? " · " + b.pageRangeText : ""}{b.updated ? " · " + relTime(b.updated) : ""}
                    </div>
                    <div class="bset-book-id" title={b.bookId}>ID {b.bookId}</div>
                  </div>
                  <button
                    class="bset-mini bset-del"
                    on:click={() => delBook(b.bookId)}
                    title="删除该书的全部译文缓存"
                  >删除</button>
                </div>
              {/each}
            </div>
          {/if}
          {#if cacheMsg}<div class="bset-msg">{cacheMsg}</div>{/if}
        </div>
      {/if}

      <!-- ============ 术语表 ============ -->
      {#if activeTab === "glossary"}
        <div class="bset-card">
          <div class="bset-card-title">术语表</div>
          <p class="bset-desc">
            为专有名词（人名、地名、术语）指定固定译法，保证全书前后一致。支持译前约束 + 译后兜底替换两种方式。
            任一改动都会使相关译文缓存失效并自动重译。
          </p>
          <div class="bset-gloss-add">
            <input class="bset-input" type="text" placeholder="原文术语（如 Tolkien）" bind:value={newGlossSrc} />
            <input class="bset-input" type="text" placeholder="指定译法（如 托尔金；留空=保留原文）" bind:value={newGlossDst} />
            <label class="bset-check"><input type="checkbox" bind:checked={newGlossCase} /><span>区分大小写</span></label>
            <button class="bset-btn" on:click={addGlossTerm}>添加</button>
          </div>
          {#if glossary.length === 0}
            <div class="bset-empty">暂无术语</div>
          {:else}
            <div class="bset-gloss-list">
              {#each glossary as t, i (i)}
                <div class="bset-gloss-row">
                  <input class="bset-input bset-gloss-src" type="text" bind:value={t.src} on:blur={persistGlossary} />
                  <span class="bset-gloss-arrow">→</span>
                  <input class="bset-input bset-gloss-dst" type="text" bind:value={t.dst} on:blur={persistGlossary} />
                  <label class="bset-check"><input type="checkbox" bind:checked={t.caseSensitive} on:change={persistGlossary} /><span>大小写</span></label>
                  <button class="bset-mini bset-del" on:click={() => removeGlossTerm(i)}>删除</button>
                </div>
              {/each}
            </div>
          {/if}
          <div class="bset-actions">
            <button class="bset-btn bset-btn-danger" on:click={clearGlossary}>清空全部</button>
          </div>
          {#if glossMsg}<div class="bset-msg">{glossMsg}</div>{/if}
        </div>
      {/if}

      <!-- ============ 翻译风格 ============ -->
      {#if activeTab === "style"}
        <div class="bset-card">
          <div class="bset-card-title">AI 翻译风格</div>
          <p class="bset-desc">
            选择 AI 兜底翻译的语气预设。切换会应用对应的「翻译提示词」；如需完全自定义，请到「引擎设置」页手动编辑提示词。
          </p>
          <div class="bset-row">
            <span class="bset-label">翻译风格</span>
            <div class="bset-seg">
              <button class="bset-seg-btn" class:active={ai.bilingualStyle !== "natural"} on:click={() => applyStyle("literal")}>硬直译</button>
              <button class="bset-seg-btn" class:active={ai.bilingualStyle === "natural"} on:click={() => applyStyle("natural")}>自然通顺</button>
            </div>
          </div>
          <div class="bset-row bset-row-col">
            <span class="bset-label">当前提示词（{((ai.translatePrompt || "").length)} 字符）</span>
            <div class="bset-prompt-preview">{ai.translatePrompt || ""}</div>
          </div>
          <p class="bset-desc">
            硬直译：逐词直译、禁止发挥，省 token 且风格稳定。自然通顺：在不改意前提下做极轻微润色，长译文可携带轻量 Markdown 排版。
          </p>
        </div>

        <!-- 2026-08-31 重新启用简洁版：译文版本（直译 / 简洁版） -->
        <div class="bset-card">
          <div class="bset-card-title">译文版本</div>
          <p class="bset-desc">
            选择译文的长短风格。简洁版译文更短、更像学习者笔记（走独立的简洁版提示词，与直译缓存互不污染）。
          </p>
          <div class="bset-row">
            <span class="bset-label">译文版本</span>
            <div class="bset-seg">
              <button class="bset-seg-btn" class:active={$settingsStore.bilingualStyle !== "concise"} on:click={() => patchSettings({ bilingualStyle: "default" })}>直译</button>
              <button class="bset-seg-btn" class:active={$settingsStore.bilingualStyle === "concise"} on:click={() => patchSettings({ bilingualStyle: "concise" })}>简洁版</button>
            </div>
          </div>
          <p class="bset-desc">切换后：下一轮翻页注入、或重新整书预翻译即生效；已注入的译文需刷新双语（关闭再开启）才会更新。</p>
        </div>
      {/if}

      <!-- ============ 显示与界面 ============ -->
      {#if activeTab === "display"}
        <div class="bset-card">
          <div class="bset-card-title">显示与界面</div>
          <p class="bset-desc">译文在正文中的呈现方式与阅读器行为偏好。</p>

          <div class="bset-row">
            <span class="bset-label">译文字号</span>
            <input class="bset-range" type="range" min="0.4" max="1.2" step="0.02" value={$settingsStore.translationFontSize ?? 0.62} on:change={(e) => patchSettings({ translationFontSize: parseFloat(e.target.value) })} />
            <span class="bset-value">{Math.round(($settingsStore.translationFontSize ?? 0.62) * 100)}%</span>
          </div>
          <div class="bset-row">
            <span class="bset-label" title="段落级悬停时显示译文词">悬停显示译文词</span>
            <label class="bset-switch"><input type="checkbox" checked={$settingsStore.paragraphHover !== false} on:change={(e) => patchSettings({ paragraphHover: e.target.checked })} /><span class="bset-track"></span></label>
          </div>
          <div class="bset-row">
            <span class="bset-label" title="译文块显示引擎与送译原文/前文参考">双语调试信息</span>
            <label class="bset-switch"><input type="checkbox" checked={$settingsStore.bilingualDebug === true} on:change={(e) => patchSettings({ bilingualDebug: e.target.checked })} /><span class="bset-track"></span></label>
          </div>

          <div class="bset-sub">免费引擎优先级</div>
          <p class="bset-desc">排在前的引擎优先尝试；全部失败才用 AI 兜底。微软 / LibreTranslate 始终排在末尾。</p>
          <div class="bset-eng-order">
            {#each engOrder as id, i (id)}
              <div class="bset-eng-order-item">
                <span class="bset-eng-name">{ENGINE_LABELS[id] || id}</span>
                <div class="bset-stepper">
                  <button class="bset-mini" on:click={() => moveEng(i, -1)} disabled={i === 0}>↑</button>
                  <button class="bset-mini" on:click={() => moveEng(i, 1)} disabled={i === engOrder.length - 1}>↓</button>
                </div>
              </div>
            {/each}
          </div>

          <div class="bset-sub">双语翻译模式记忆（按书）</div>
          <p class="bset-desc">为每本书记住你选过的翻译方式（整书预翻译 / 渐进式）。记住后再次打开同书直接套用、不再弹窗询问。清除后下次打开该书重新选择。</p>
          {#if !bookModesLoaded}
            <div class="bset-loading">加载记忆列表…</div>
          {:else if bookModes.length === 0}
            <div class="bset-empty">暂无按书记忆（点「双语」选过方式后会自动记录）</div>
          {:else}
            <div class="bset-book-list">
              {#each bookModes as m (m.bookId)}
                <div class="bset-book">
                  <div class="bset-book-info">
                    <div class="bset-book-title">{m.title || m.bookId}</div>
                    <div class="bset-book-meta">已记忆：{BOOK_MODE_LABEL[m.mode] || m.mode}</div>
                  </div>
                  <button class="bset-mini bset-del" on:click={() => clearBookMode(m.bookId)}>清除记忆</button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  /* 弹窗挂载容器：撑满 Dialog body（与 JS 内联样式互为兜底） */
  :global(.reword-bset-dialog-body) {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .bset-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--b3-theme-background, #f5f5f5);
    color: var(--b3-theme-on-background, #333);
    font-size: 13px;
  }
  .bset-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
    flex-wrap: wrap;
  }
  .bset-title { font-size: 15px; font-weight: 600; }
  .bset-default { display: flex; align-items: center; gap: 8px; }
  .bset-default-label { color: var(--b3-theme-on-surface, #666); font-size: 12px; }
  .bset-seg { display: inline-flex; border: 1px solid var(--b3-border-color, rgba(0,0,0,0.12)); border-radius: 8px; overflow: hidden; }
  .bset-seg-btn {
    border: none; background: transparent; padding: 5px 12px; cursor: pointer;
    color: var(--b3-theme-on-surface, #555); font-size: 12px;
  }
  .bset-seg-btn.active { background: var(--b3-theme-primary, #4c8bf5); color: var(--b3-theme-on-primary, #fff); }
  .bset-body { display: flex; flex: 1; min-height: 0; }
  .bset-rail {
    width: 132px; flex-shrink: 0; padding: 12px 8px; display: flex; flex-direction: column; gap: 4px;
    border-right: 1px solid var(--b3-border-color, rgba(0,0,0,0.08));
    overflow-y: auto;
  }
  .bset-rail-btn {
    text-align: left; border: none; background: transparent; padding: 8px 12px; border-radius: 8px;
    cursor: pointer; color: var(--b3-theme-on-surface, #555); font-size: 13px;
  }
  .bset-rail-btn.active { background: var(--b3-theme-primary-light, rgba(79, 124, 255, 0.12)); color: var(--b3-theme-primary, #4c8bf5); font-weight: 600; }
  .bset-content { flex: 1; min-width: 0; overflow-y: auto; padding: 16px; }
  .bset-card {
    background: var(--b3-theme-surface, #fff);
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
    border-radius: 12px;
    padding: 16px 18px;
    max-width: 720px;
    color: var(--b3-theme-on-background, #333);
  }
  .bset-card-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; color: var(--b3-theme-primary, #4c8bf5); }
  .bset-desc { color: var(--b3-theme-on-surface, #777); font-size: 12px; line-height: 1.6; margin: 0 0 14px; }
  .bset-row { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
  .bset-row-col { flex-direction: column; align-items: stretch; }
  .bset-label { min-width: 96px; color: var(--b3-theme-on-surface, #666); font-size: 12px; }
  .bset-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
  .bset-input, .bset-select, .bset-textarea {
    background: var(--b3-theme-surface, #fff); color: var(--b3-theme-on-background, #333);
    border: 1px solid var(--b3-border-color, rgba(0,0,0,0.15)); border-radius: 6px; padding: 6px 8px; font-size: 12px;
    flex: 1; min-width: 0;
  }
  .bset-textarea { resize: vertical; font-family: inherit; }
  .bset-range { flex: 1; }
  .bset-value { min-width: 44px; text-align: right; font-variant-numeric: tabular-nums; color: var(--b3-theme-on-surface, #555); }
  .bset-switch { position: relative; display: inline-block; width: 38px; height: 22px; }
  .bset-switch input { opacity: 0; width: 0; height: 0; }
  .bset-track { position: absolute; inset: 0; background: var(--b3-border-color, #ccc); border-radius: 999px; transition: 0.2s; }
  .bset-switch input:checked + .bset-track { background: var(--b3-theme-primary, #4c8bf5); }
  .bset-track::before { content: ""; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: 0.2s; }
  .bset-switch input:checked + .bset-track::before { transform: translateX(16px); }
  .bset-stepper { display: inline-flex; align-items: center; gap: 6px; }
  .bset-mini { border: 1px solid var(--b3-border-color, rgba(0,0,0,0.15)); background: var(--b3-theme-surface, #fff); border-radius: 6px; padding: 3px 9px; cursor: pointer; color: var(--b3-theme-on-surface, #444); font-size: 12px; }
  .bset-mini:hover { border-color: var(--b3-theme-primary, #4c8bf5); }
  .bset-engine { border-top: 1px solid var(--b3-border-color, rgba(0,0,0,0.08)); padding: 12px 0; }
  .bset-engine:first-of-type { border-top: none; }
  .bset-engine-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .bset-engine-name { font-weight: 600; font-size: 13px; }
  .bset-check { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--b3-theme-on-surface, #666); cursor: pointer; }
  .bset-test { margin-left: auto; border: 1px solid var(--b3-border-color, rgba(0,0,0,0.15)); background: var(--b3-theme-surface, #fff); border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
  .bset-test:disabled { opacity: 0.6; cursor: default; }
  .bset-test-result { font-size: 12px; }
  .bset-test-result.ok { color: var(--b3-theme-success, #4caf72); }
  .bset-test-result.fail { color: var(--b3-theme-error, #e5484d); }
  .bset-engine-fields { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .bset-engine-fields .bset-input { flex: 1; min-width: 160px; }
  .bset-used { font-size: 12px; color: var(--b3-theme-on-surface, #888); }
  .bset-mon { margin: 14px 0; }
  .bset-mon-head { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px; }
  .bset-mon-name { font-weight: 600; }
  .bset-mon-num { color: var(--b3-theme-on-surface, #777); font-variant-numeric: tabular-nums; }
  .bset-bar { height: 8px; background: var(--b3-border-color, rgba(0,0,0,0.1)); border-radius: 999px; overflow: hidden; }
  .bset-bar-fill { height: 100%; border-radius: 999px; transition: width 0.3s ease; }
  .bset-actions { margin-top: 16px; }
  .bset-btn { border: 1px solid var(--b3-theme-primary, #4c8bf5); background: var(--b3-theme-primary, #4c8bf5); color: var(--b3-theme-on-primary, #fff); border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 12px; }
  .bset-btn-danger { border-color: var(--b3-theme-error, #e5484d); background: var(--b3-theme-error, #e5484d); }
  .bset-cache-summary { display: flex; align-items: center; gap: 14px; margin-bottom: 10px; font-size: 12px; color: var(--b3-theme-on-surface, #777); }
  .bset-cache-summary b { color: var(--b3-theme-on-background, #222); font-variant-numeric: tabular-nums; }
  .bset-cache-summary .bset-mini { margin-left: auto; }
  .bset-select { flex: 0 0 auto; min-width: 140px; }
  .bset-cache-tools { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .bset-cache-tools .bset-input { flex: 1; min-width: 160px; }
  .bset-loading, .bset-empty { color: var(--b3-theme-on-surface, #999); font-size: 12px; padding: 16px 0; }
  .bset-book-list { display: flex; flex-direction: column; gap: 6px; }
  .bset-book { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border: 1px solid var(--b3-border-color, rgba(0,0,0,0.08)); border-radius: 8px; }
  .bset-book:hover { border-color: var(--b3-theme-primary, #4c8bf5); }
  .bset-book-info { min-width: 0; flex: 1; }
  .bset-book-title { font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
  .bset-badge { font-size: 10px; padding: 1px 5px; border-radius: 4px; background: var(--b3-border-color, rgba(0,0,0,0.08)); color: var(--b3-theme-on-surface, #888); }
  .bset-book-meta { font-size: 11px; color: var(--b3-theme-on-surface, #999); margin-top: 2px; }
  .bset-book-id { font-size: 10px; color: var(--b3-theme-on-surface, #aaa); margin-top: 2px; font-family: var(--b3-font-family-code, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bset-del { border-color: var(--b3-theme-error, #e5484d); color: var(--b3-theme-error, #e5484d); }
  .bset-msg { margin-top: 12px; font-size: 12px; color: var(--b3-theme-success, #4caf72); }
  .bset-gloss-add { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 10px 0; }
  .bset-gloss-add .bset-input { flex: 1; min-width: 160px; }
  .bset-gloss-list { display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
  .bset-gloss-row { display: flex; align-items: center; gap: 8px; }
  .bset-gloss-row .bset-input { flex: 1; min-width: 120px; }
  .bset-gloss-arrow { color: var(--b3-theme-on-surface, #999); }
  .bset-sub { font-weight: 600; font-size: 13px; margin: 18px 0 4px; }
  .bset-eng-order { display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
  .bset-eng-order-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border: 1px solid var(--b3-border-color, rgba(0,0,0,0.08)); border-radius: 8px; }
  .bset-eng-name { font-size: 13px; font-weight: 500; }
  .bset-prompt-preview {
    background: var(--b3-theme-surface, #fff); color: var(--b3-theme-on-surface, #333);
    border: 1px solid var(--b3-border-color, rgba(0,0,0,0.15)); border-radius: 6px; padding: 8px;
    font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
    max-height: 200px; overflow-y: auto; width: 100%;
  }
</style>
