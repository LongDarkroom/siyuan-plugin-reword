<script lang="ts">
  /**
   * 阅读知识图谱面板（C · 图谱 / 画布联动）
   * 使用 portal 挂载到 body，获得完整视口以展示力导向图。
   */
  import { onMount, createEventDispatcher } from "svelte";
  import { portal } from "../utils/portal";
  import type { BookshelfStore } from "./bookshelf-store";
  import type { GraphNode, LibraryGraph } from "./graph";
  import { buildLibraryGraph, exportBookCanvasDoc, GRAPH_W, GRAPH_H } from "./graph";
  import { getAnnotationStore } from "../annotation/store-singleton";

  export let store: BookshelfStore;
  export let onOpen: (bookId: string) => void;

  const dispatch = createEventDispatcher();

  let graph: LibraryGraph | null = null;
  let selected: GraphNode | null = null;
  let sending = false;
  let toast = "";
  let hasEdges = false;

  const STATUS_FILL: Record<string, string> = {
    unread: "#9aa0a6",
    reading: "#378add",
    finished: "#3aa675",
  };
  const STATUS_LABEL: Record<string, string> = {
    unread: "想读",
    reading: "在读",
    finished: "读完",
  };

  onMount(() => {
    try {
      const allAnns = getAnnotationStore().getAll();
      const annCount: Record<string, number> = {};
      for (const a of allAnns) {
        if (!a.bookId) continue;
        annCount[a.bookId] = (annCount[a.bookId] || 0) + 1;
      }
      graph = buildLibraryGraph(store.list, annCount);
      hasEdges = graph.edges.length > 0;
    } catch (e: any) {
      graph = buildLibraryGraph(store.list, {});
      hasEdges = graph.edges.length > 0;
      void e;
    }
  });

  function close() {
    dispatch("close");
  }

  function truncate(s: string, n = 14): string {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function selectNode(node: GraphNode) {
    selected = node;
  }

  function openSelected() {
    if (selected) onOpen(selected.id);
  }

  async function sendToCanvas() {
    if (!selected) return;
    const book = store.get(selected.id);
    if (!book) {
      showToast("找不到这本书，可能已被移除");
      return;
    }
    sending = true;
    try {
      const anns = getAnnotationStore().getByBook(book.id);
      await exportBookCanvasDoc(book, anns);
      showToast(`已生成画布文档：《${book.title}》（${anns.length} 条标注）`);
    } catch (e: any) {
      showToast("生成失败：" + (e?.message || String(e)));
    } finally {
      sending = false;
    }
  }

  function showToast(msg: string, ms = 3600) {
    toast = msg;
    setTimeout(() => {
      if (toast === msg) toast = "";
    }, ms);
  }
</script>

<div class="edit-mask" use:portal on:click|self={close}>
  <div class="edit-panel graph-panel">
    <header class="panel-header">
      <h2 class="panel-title">阅读知识图谱</h2>
      <button class="panel-close" on:click={close} aria-label="关闭">×</button>
    </header>

    {#if !graph || graph.nodes.length === 0}
      <div class="graph-empty">
        <div class="graph-empty-icon">🕸️</div>
        <div class="graph-empty-title">书架里还没有书</div>
        <div class="graph-empty-hint">导入几本书并添加相同标签 / 丛书后，这里会自动连成关系图</div>
      </div>
    {:else}
      <div class="graph-legend">
        <span class="legend-item"><span class="dot unread"></span>想读</span>
        <span class="legend-item"><span class="dot reading"></span>在读</span>
        <span class="legend-item"><span class="dot finished"></span>读完</span>
        <span class="legend-hint">节点大小 = 标注数 · 连线 = 共享标签 / 丛书</span>
      </div>

      <div class="graph-stage">
        <svg
          viewBox="0 0 {GRAPH_W} {GRAPH_H}"
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="阅读知识图谱"
        >
          <defs>
            <filter id="node-shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.18)" />
            </filter>
          </defs>

          <g class="graph-edges">
            {#each graph.edges as e}
              {@const a = graph.nodes.find((n) => n.id === e.source)}
              {@const b = graph.nodes.find((n) => n.id === e.target)}
              {#if a && b}
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="var(--b3-border-color, rgba(0,0,0,0.15))"
                  stroke-width={Math.min(3, 0.7 + e.weight * 0.7)}
                  opacity={selected && selected.id !== a.id && selected.id !== b.id ? 0.25 : 0.95}
                />
              {/if}
            {/each}
          </g>

          <g class="graph-nodes">
            {#each graph.nodes as node}
              <g
                class="graph-node"
                class:selected={selected?.id === node.id}
                role="button"
                tabindex="0"
                aria-label={node.title}
                on:click={() => selectNode(node)}
                on:keydown={(ev) => (ev.key === "Enter" || ev.key === " ") && selectNode(node)}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r}
                  fill={STATUS_FILL[node.status] || "#9aa0a6"}
                  fill-opacity={selected && selected.id !== node.id ? 0.45 : 0.95}
                  stroke={selected?.id === node.id ? "var(--b3-theme-primary, #378add)" : "#fff"}
                  stroke-width={selected?.id === node.id ? 3.5 : 2}
                  filter="url(#node-shadow)"
                />
                <text
                  x={node.x}
                  y={node.y + node.r + 12}
                  text-anchor="middle"
                  class="graph-label"
                >{truncate(node.title)}</text>
              </g>
            {/each}
          </g>
        </svg>
      </div>

      {#if !hasEdges}
        <div class="graph-note">
          当前书籍没有共享标签或丛书；给两本以上的书加上相同标签 / 丛书即可连线。
        </div>
      {/if}

      {#if selected}
        <div class="graph-detail">
          <div class="graph-detail-main">
            <div class="graph-detail-title" title={selected.title}>{selected.title}</div>
            <div class="graph-detail-meta">
              <span class="graph-chip" style="background:{STATUS_FILL[selected.status] || '#9aa0a6'}">
                {STATUS_LABEL[selected.status] || "想读"}
              </span>
              <span class="graph-detail-count">{selected.annCount} 条标注</span>
            </div>
          </div>
          <div class="graph-detail-actions">
            <button class="graph-btn primary" on:click={openSelected}>打开本书</button>
            <button class="graph-btn" class:busy={sending} disabled={sending} on:click={sendToCanvas}>
              {sending ? "生成中…" : "发送到画布"}
            </button>
          </div>
        </div>
      {:else}
        <div class="graph-hint">点击节点查看详情，并把它导出为思源画布文档</div>
      {/if}
    {/if}

    {#if toast}
      <div class="graph-toast">{toast}</div>
    {/if}
  </div>
</div>

<style>
  .graph-panel {
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
  .graph-legend {
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
    flex-wrap: wrap;
  }
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .dot.unread {
    background: #9aa0a6;
  }
  .dot.reading {
    background: #378add;
  }
  .dot.finished {
    background: #3aa675;
  }
  .legend-hint {
    margin-left: auto;
    color: var(--b3-theme-on-surface-light, #aaa);
  }
  .graph-stage {
    flex: 1;
    min-height: 360px;
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.025));
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
    border-radius: 14px;
    overflow: hidden;
  }
  .graph-node {
    cursor: pointer;
  }
  .graph-node:focus {
    outline: none;
  }
  .graph-label {
    font-size: 10px;
    fill: var(--b3-theme-on-background, #333);
    pointer-events: none;
    font-family: var(--b3-font-family, sans-serif);
    font-weight: 500;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.9);
  }
  .graph-note,
  .graph-hint {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #999);
    line-height: 1.5;
  }
  .graph-hint {
    text-align: center;
    padding: 4px 0;
  }
  .graph-detail {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px;
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.04));
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
    border-radius: 12px;
  }
  .graph-detail-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--b3-theme-on-background, #333);
    margin-bottom: 5px;
    word-break: break-all;
    line-height: 1.3;
  }
  .graph-detail-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
  }
  .graph-chip {
    color: #fff;
    border-radius: 5px;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 500;
  }
  .graph-detail-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .graph-btn {
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    background: var(--b3-theme-background, #fff);
    border-radius: 8px;
    padding: 7px 14px;
    font-size: 12px;
    cursor: pointer;
    color: var(--b3-theme-on-background, #333);
    transition: background 0.15s;
  }
  .graph-btn:hover {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.05));
  }
  .graph-btn.primary {
    background: var(--b3-theme-primary, #534ab7);
    border-color: transparent;
    color: #fff;
  }
  .graph-btn.primary:hover {
    filter: brightness(1.05);
  }
  .graph-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .graph-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 60px 0;
    text-align: center;
  }
  .graph-empty-icon {
    font-size: 40px;
    opacity: 0.35;
  }
  .graph-empty-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--b3-theme-on-background, #333);
  }
  .graph-empty-hint {
    font-size: 12px;
    color: var(--b3-theme-on-surface-light, #888);
    max-width: 320px;
    line-height: 1.5;
  }
  .graph-toast {
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
