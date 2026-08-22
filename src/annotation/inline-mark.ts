/**
 * 行内批注高亮纯函数（方案 C 改进：选区级精确标记）。
 * ------------------------------------------------------------------
 * 给定一个块元素与该块上的批注列表，在块的文本节点中找到
 * `selectedText`（或回退到 `sentence`）对应的文字，用
 * <span class="hiword-ann-inline"> 包裹，实现「只高亮选中文字」的视觉效果。
 *
 * 设计约束：
 *  - 只包裹 <span>，不改文本内容 → 删除插件后残留空 span（可清理）
 *  - 每次调用先清除旧标记再重新施加，避免重复包裹
 *  - 用 TextWalker 遍历文本节点，跨节点匹配支持
 *  - 纯函数，依赖 globalThis.document；Node 下可 mock 测试
 */

/** 清除某块内所有行内批注标记 */
export function clearInlineMarks(blockEl: HTMLElement): void {
  blockEl.querySelectorAll(".hiword-ann-inline").forEach((span) => {
    // 将 span 替换为其子文本节点（保留原文，去掉包裹）
    const parent = span.parentNode;
    if (parent) {
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
    }
  });
}

/**
 * 在一个块元素内施加所有行内批注高亮。
 *
 * @param blockEl 块元素（[data-node-id] 的容器）
 * @param annotations 该块上的批注列表（含 color / style / tags）
 * @param className 高亮 span 的 class（默认 hiword-ann-inline）
 */
export function applyInlineMarks(
  blockEl: HTMLElement,
  annotations: Array<{
    selectedText?: string;
    sentence: string;
    id: string;
    color?: string;
    style?: string; // "solid" | "wavy" | "dashed" | "double"
    scope?: string; // "word" | "sentence" | "both"
    lineColor?: string; // 下划线独立色（2026-08-15 新增）
    labels?: string[];
    tags?: string[];
    start?: number; // 选中文本在块 textContent 中的起始偏移（2026-08-17：稳定定位）
    end?: number;   // 选中文本在块 textContent 中的结束偏移
  }>,
  className = "hiword-ann-inline"
): number {
  // 收集现有 span（按 annId 索引）
  const existing = new Map<string, HTMLElement>();
  blockEl.querySelectorAll<HTMLElement>(`.${className}`).forEach((sp) => {
    const id = sp.dataset.annId;
    if (id) existing.set(id, sp);
  });
  const wanted = new Set(annotations.map((a) => a.id));

  // 1) 移除已不存在的批注 span（解包还原为纯文本）
  for (const [id, sp] of existing) {
    if (!wanted.has(id)) {
      unwrapSpan(sp);
      existing.delete(id);
    }
  }

  let markedCount = 0;
  const fullText = blockEl.textContent || "";
  let searchFrom = 0; // 已覆盖位置游标，避免同块内重复词都命中第一处
  // 2026-08-22 修复 3.1：维护本轮已包裹位置集合，防同一字符位置被两个 ann.id 重复包裹
  //   (offset self-consistent 但目标位置已被前面批注覆盖的场景)
  const wrappedPositions = new Set<number>();

  for (const ann of annotations) {
    const target = (ann.selectedText || ann.sentence).trim();
    if (!target) continue;

    const cur = existing.get(ann.id);
    const curText = cur?.textContent?.trim();
    // 已存在且 annId/style/color/scope/文本均匹配 → 直接保留，不重建（消除悬浮闪烁的关键）
    if (
      cur &&
      cur.dataset.annStyle === (ann.style || "") &&
      cur.dataset.annColor === (ann.color || "") &&
      cur.dataset.annScope === (ann.scope || "word") &&
      curText === target
    ) {
      markedCount++;
      continue;
    }

    // 2026-08-17：优先用存储的字符偏移定位（稳定，不随同词重复而漂移）；
    // 偏移无效（文本被编辑/不匹配）再回退 indexOf 文本匹配。
    //
    // 2026-08-22 修复 3.1：双重包裹防护
    // 场景：同块有 2 个批注都标 "world"
    //  - ann 1 的 offset=6 失效(文本被编辑成 "WORLD"),substring 不匹配 → 回退 indexOf
    //    找到 offset=18(第二个 world),包了它,searchFrom 推进到 23
    //  - ann 2 的 offset=18 仍自洽,substring 匹配 → 用 offset 18
    //    → 与 ann 1 包了同一处,产生嵌套 span / 双重 data-ann-id
    // 修复：用 wrappedPositions Set 拦截「目标位置已被前面批注覆盖」的重复包裹。
    //   偏移自洽时直接信任(不卡 searchFrom,以保留"乱序添加"的合法场景),命中已包裹位置则跳过
    const offsetSelfConsistent =
      ann.start != null && ann.end != null &&
      ann.start >= 0 && ann.end <= fullText.length &&
      fullText.substring(ann.start, ann.end) === target;
    let idx: number;
    if (offsetSelfConsistent) {
      // 偏移自洽 → 直接信任 ann.start(不卡 searchFrom,支持「后面添加的 ann 偏移在前面」的合法乱序)
      //   若该位置已被本轮其他 ann 包裹 → 跳过防双重包裹
      if (wrappedPositions.has(ann.start!)) continue;
      idx = ann.start!;
    } else {
      // 偏移失效 → 从 searchFrom 起 indexOf,再允许从头兜底(向后兼容旧行为)
      idx = fullText.indexOf(target, searchFrom);
      if (idx === -1) idx = fullText.indexOf(target);
      if (idx === -1) continue; // 文本已被编辑，找不到就跳过
      if (wrappedPositions.has(idx)) continue; // 也防 indexOf 命中已包裹位置
    }
    searchFrom = Math.max(searchFrom, idx + target.length);
    wrappedPositions.add(idx);

    // 样式变化：先解包旧 span 再重新包裹
    if (cur) unwrapSpan(cur);

    // 用 Range + TextWalker 精确定位并包裹
    const range = document.createRange();
    const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);

    let currentPos = 0;
    let startFound = false;
    const startNodes: { node: Text; offset: number }[] = [];
    const endNodes: { node: Text; offset: number }[] = [];

    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text;
      const len = textNode.length;

      if (!startFound && currentPos + len > idx) {
        startNodes.push({ node: textNode, offset: idx - currentPos });
        startFound = true;
      }
      if (startFound) {
        startNodes.push({ node: textNode, offset: 0 });
        if (currentPos + len >= idx + target.length) {
          endNodes.push({ node: textNode, offset: idx + target.length - currentPos });
          break;
        }
      }
      currentPos += len;
    }

    if (!startFound || endNodes.length === 0) continue;

    // 创建范围并包裹
    try {
      const start = startNodes[0];
      const end = endNodes[endNodes.length - 1];
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);

      const span = document.createElement("span");
      span.className = className;
      span.dataset.annId = ann.id; // 关联批注 ID，便于后续定位/删除

      // 携带样式与颜色信息：颜色仅写入 data-ann-color 属性，
      // 由 index.less 的属性选择器表（.hiword-ann-inline[data-ann-color="…"]）驱动着色。
      // 不再写内联样式（--ann-color / text-decoration-color）——防止 span 被 DOM 序列化
      // 进 .sy 块内容时携带内联样式，造成「删插件后文本残留有色样式」的污染（P0.5）。
      if (ann.color) {
        span.dataset.annColor = ann.color;
      }
      if (ann.style) span.dataset.annStyle = ann.style;
      // 下划线颜色独立于背景色（2026-08-15 新增）：缺省 = color
      span.dataset.annLineColor = ann.lineColor || ann.color || "";
      // 作用域：word=背景高亮 / sentence=线型 / both=叠加（缺省 word）
      span.dataset.annScope = ann.scope === "sentence" ? "sentence" : ann.scope === "both" ? "both" : "word";

      // Range.surroundContents 要求范围不跨越非文本节点边界；
      // 思源段落内的格式通常简单，若失败则用更宽松的方式
      try {
        range.surroundContents(span);
        markedCount++;
      } catch {
        // surroundContents 失败（跨元素边界），改用 extractContents + appendChild
        try {
          const contents = range.extractContents();
          span.appendChild(contents);
          range.insertNode(span);
          markedCount++;
        } catch {
          // 彻底失败则跳过这条
        }
      }
    } catch {
      // range 设置失败，跳过
    }
  }

  return markedCount;
}

/** 将 span 解包为纯文本（保留原文，去掉包裹） */
function unwrapSpan(span: HTMLElement): void {
  const parent = span.parentNode;
  if (!parent) return;
  while (span.firstChild) {
    parent.insertBefore(span.firstChild, span);
  }
  parent.removeChild(span);
}

/**
 * 批量对编辑区内所有已批注块施加行内标记。
 * （供 Plugin.applyAnnotationBlockMarks 调用的便捷入口）
 */
export function applyAllInlineMarks(
  getAnnotationsForBlock: (blockId: string) => Array<{ selectedText?: string; sentence: string; id: string }>
): number {
  let total = 0;
  const roots = document.querySelectorAll(".protyle-wysiwyg");
  roots.forEach((root) => {
    root.querySelectorAll<HTMLElement>("[data-node-id]").forEach((el) => {
      const nid = el.dataset.nodeId;
      if (!nid) return;
      const anns = getAnnotationsForBlock(nid);
      if (anns.length > 0) {
        total += applyInlineMarks(el, anns);
      }
    });
  });
  return total;
}
