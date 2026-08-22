/**
 * 块级视觉标记纯函数（方案 C #23）。
 * ------------------------------------------------------------------
 * 给定「已批注的块 ID 集合」，在编辑区 DOM 上为对应块元素加 `.hiword-ann-block`
 * 类，并清除「数据已删除、但 DOM 上仍残留」的标记。
 *
 * 关键约束（方案 C 的核心承诺）：
 *  - 只动 class，绝不修改正文文本节点 → 删除插件后零正文污染。
 *  - 限定在编辑区 `.protyle-wysiwyg` 内扫描，避免误标大纲 / 文档树。
 *
 * 依赖浏览器的 `document` / DOM API；在 Node 单测中通过 mock `globalThis.document` 验证。
 */

/**
 * 在编辑区 DOM 施加 / 清除块标记。
 * @param ids 已批注的块 ID 集合（来自 AnnotationStore.annotatedBlockIds）
 */
export function markAnnotatedBlocks(ids: Set<string>): void {
  // 性能：仅遍历「已批注的块」，复杂度从 O(全文档块数) 降到 O(批注块数)；
  // 文档越大、批注越少收益越明显。
  ids.forEach((nid) => {
    const el = document.querySelector<HTMLElement>(`[data-node-id="${nid}"]`);
    if (el) el.classList.add("hiword-ann-block");
  });

  // 清除数据已删除、但 DOM 上仍残留的标记，保持标记与数据一致
  document.querySelectorAll<HTMLElement>(".hiword-ann-block").forEach((el) => {
    const nid = el.dataset.nodeId;
    if (!nid || !ids.has(nid)) {
      el.classList.remove("hiword-ann-block");
    }
  });
}

/** 清除编辑区内全部块标记（无批注时调用，避免残留） */
export function clearBlockMarks(): void {
  document
    .querySelectorAll(".hiword-ann-block")
    .forEach((el) => el.classList.remove("hiword-ann-block"));
}
