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

  // —— 动画派生数据（路线 A：纯 CSS/SVG 动画，不改物理布局）——
  interface RenderEdge {
    a: GraphNode;
    b: GraphNode;
    len: number;   // 边长，用于 stroke-dash 绘制动画
    idx: number;   // 原 edges 下标，用于选中高亮匹配
    weight: number;
  }
  let renderEdges: RenderEdge[] = [];
  let connectedNodes: Set<string> | null = null;
  let connectedEdges: Set<number> | null = null;

  // 预计算每条边的几何长度（供「从无到有」绘制动画使用）
  $: if (graph) {
    renderEdges = graph.edges
      .map((e, idx) => {
        const a = graph!.nodes.find((n) => n.id === e.source);
        const b = graph!.nodes.find((n) => n.id === e.target);
        if (!a || !b) return null;
        return { a, b, len: Math.hypot(a.x - b.x, a.y - b.y), idx, weight: e.weight };
      })
      .filter((r): r is RenderEdge => !!r);
  } else {
    renderEdges = [];
  }

  // 选中节点时，计算其邻居节点与边（用于高亮 + 非关联淡出）
  $: if (selected && graph) {
    const nb = new Set<string>();
    const ed = new Set<number>();
    graph.edges.forEach((e, i) => {
      if (e.source === selected!.id || e.target === selected!.id) {
        nb.add(e.source);
        nb.add(e.target);
        ed.add(i);
      }
    });
    connectedNodes = nb;
    connectedEdges = ed;
  } else {
    connectedNodes = null;
    connectedEdges = null;
  }

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
            {#each renderEdges as e (e.idx)}
              <line
                class="graph-edge"
                class:edge-highlight={connectedEdges?.has(e.idx)}
                class:edge-dim={connectedEdges && !connectedEdges.has(e.idx)}
                x1={e.a.x}
                y1={e.a.y}
                x2={e.b.x}
                y2={e.b.y}
                stroke={connectedEdges?.has(e.idx) ? "var(--b3-theme-primary, #378add)" : "var(--b3-border-color, rgba(0,0,0,0.15))"}
                stroke-width={(Math.min(3, 0.7 + e.weight * 0.7)) * (connectedEdges?.has(e.idx) ? 1.6 : 1)}
                opacity={connectedEdges ? (connectedEdges.has(e.idx) ? 0.95 : 0.12) : (selected ? 0.25 : 0.95)}
                style="--len:{e.len}px; --ei:{e.idx}"
              />
            {/each}
          </g>

          <g class="graph-nodes">
            {#each graph.nodes as node, i (node.id)}
              <g
                class="graph-node"
                class:selected={selected?.id === node.id}
                class:dim={connectedNodes != null && !connectedNodes.has(node.id) && selected?.id !== node.id}
                role="button"
                tabindex="0"
                aria-label={node.title}
                style="--cx:{node.x}px; --cy:{node.y}px; --i:{i}"
                on:click={() => selectNode(node)}
                on:keydown={(ev) => (ev.key === "Enter" || ev.key === " ") && selectNode(node)}
              >
                {#if selected?.id === node.id}
                  <circle class="pulse-ring" cx={node.x} cy={node.y} r={node.r} />
                {/if}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r}
                  fill={STATUS_FILL[node.status] || "#9aa0a6"}
                  fill-opacity={selected && selected.id !== node.id ? (connectedNodes ? (connectedNodes.has(node.id) ? 0.95 : 0.3) : 0.45) : 0.95}
                  stroke={selected?.id === node.id ? "var(--b3-theme-primary, #378add)" : "#fff"}
                  stroke-width={selected?.id === node.id ? 3.5 : 2}
                  filter="url(#node-shadow)"
                />
                <text
                  x={node.x}
                  y={node.y + node.r + 10}
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
    /* 入场弹入：绕节点中心缩放，按 --i 错峰；transform-box:view-box 使 --cx/--cy 落在 viewBox 坐标系 */
    transform-box: view-box;
    transform-origin: var(--cx) var(--cy);
    animation: node-pop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both;
    animation-delay: calc(var(--i) * 55ms);
    transition: opacity 0.25s ease;
  }
  .graph-node:focus {
    outline: none;
  }
  /* 圆点本体：hover 放大 + 发光，与入场动画（作用在 g 上）互不冲突 */
  .graph-node circle:not(.pulse-ring) {
    transform-box: fill-box;
    transform-origin: center;
    transition: transform 0.2s ease, filter 0.2s ease;
  }
  .graph-node:hover circle:not(.pulse-ring) {
    transform: scale(1.28);
    filter: drop-shadow(0 0 6px var(--b3-theme-primary, #378add));
  }
  /* 悬停某节点时，其余节点淡出 */
  .graph-nodes:hover .graph-node:not(:hover) {
    opacity: 0.38;
  }
  /* 选中态：非邻居节点淡出（class:dim 由脚本控制，优先级高于纯 hover） */
  .graph-node.dim {
    opacity: 0.3;
  }

  /* 边：从无到有绘制 + 错峰；选中时高亮/淡出 */
  .graph-edge {
    stroke-dasharray: var(--len, 0);
    stroke-dashoffset: var(--len, 0);
    animation: edge-draw 0.7s ease forwards;
    animation-delay: calc(220ms + var(--ei) * 28ms);
    transition: opacity 0.25s ease, stroke 0.25s ease, stroke-width 0.25s ease;
  }
  .graph-edge.edge-dim {
    opacity: 0.12 !important;
  }
  .graph-edge.edge-highlight {
    filter: drop-shadow(0 0 3px var(--b3-theme-primary, #378add));
  }

  /* 选中节点呼吸扩散光环 */
  .pulse-ring {
    fill: none;
    stroke: var(--b3-theme-primary, #378add);
    stroke-width: 2;
    transform-box: fill-box;
    transform-origin: center;
    animation: pulse-ring 1.8s ease-out infinite;
    pointer-events: none;
  }

  @keyframes node-pop {
    0% { transform: scale(0); }
    60% { transform: scale(1.12); }
    100% { transform: scale(1); }
  }
  @keyframes edge-draw {
    from { stroke-dashoffset: var(--len, 0); }
    to { stroke-dashoffset: 0; }
  }
  @keyframes pulse-ring {
    0% { transform: scale(1); opacity: 0.7; }
    70% { transform: scale(2.2); opacity: 0; }
    100% { transform: scale(2.2); opacity: 0; }
  }
  /* 尊重用户的「减少动态效果」偏好 */
  @media (prefers-reduced-motion: reduce) {
    .graph-node,
    .graph-edge,
    .pulse-ring {
      animation: none !important;
      transition: none !important;
    }
    .graph-edge {
      stroke-dashoffset: 0 !important;
    }
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
