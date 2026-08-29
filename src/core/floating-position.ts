/**
 * 浮动工具栏 / 弹窗的位置计算（纯函数）
 * ------------------------------------------------------------------
 * 历史背景：
 *   2026-08-29 改造。AI 面板的选字工具栏（ai-panel.ts）和思源顶栏唤起的
 *   词典悬浮弹窗（index.ts:positionFloatingPopup）原来各自手写：
 *     - AI 选字工具栏：固定 `y - 40`（只显示在选区上方），右侧用 220px
 *       写死夹边，靠近滚动区顶部时工具栏被裁掉，靠近容器左壁时不居中，
 *       滚动时不跟随。
 *     - 词典弹窗：默认右对齐到按钮下方，距离底边 < 400 才翻到上方，
 *       横向用 10px 兜底，没有翻转/居中/视口安全区。
 *
 * 行业做法（readest / obsidian-weave-reader / Lexical / Floating UI）：
 *   1. measure —— `getBoundingClientRect()` 拿工具栏真实 w/h；
 *   2. flip —— 默认 preferred side（top/bottom），空间不够翻到对侧；
 *   3. offset —— 横向以 anchor 中心 + gap 起步；
 *   4. shift —— 用 edgeMargin 把工具栏夹在容器内。
 *   5. autoUpdate —— 滚动/resize 重跑。
 *
 * 本模块只负责 1-4：把 anchorRect / containerRect / 测量到的 floatingSize
 * 喂进来，返回 viewport 坐标系下的 (left, top) 和最终 placement。
 * 滚动监听由调用方自己挂。
 *
 * 设计要点：
 *   - 纯函数，无副作用，便于单测（test/floating-position.test.mjs）。
 *   - 返回 viewport 坐标（与 getBoundingClientRect 一致），调用方自己
 *     换算到 offsetParent / 容器坐标系。
 *   - edgeMargin / gap 走默认 + 允许 override。
 *   - 对 zero / negative 尺寸做容错（不会崩，只退到 anchor 位置）。
 */

export type FloatingPlacement = "top" | "bottom";
export type FloatingAlign = "start" | "center" | "end";

export interface FloatingPositionOptions {
  /** 工具栏与选区/按钮的最小间距（px），默认 8 */
  gap?: number;
  /** 工具栏距离容器内壁的最小留白（px），默认 6 */
  edgeMargin?: number;
  /** 优先方向：空间不够时翻到对侧，默认 'top'（与 readest/weave 一致） */
  preferredSide?: FloatingPlacement;
  /** 横向对齐策略，默认 'center' */
  align?: FloatingAlign;
}

export interface FloatingPositionResult {
  /** viewport 坐标系下的 left */
  left: number;
  /** viewport 坐标系下的 top */
  top: number;
  /** 实际选用的方向（可能因 flip 与 preferredSide 不同） */
  placement: FloatingPlacement;
  /** 实际选用的对齐 */
  align: FloatingAlign;
  /** 是否发生过 flip（true 表示翻到了 preferredSide 的对侧） */
  flipped: boolean;
}

/**
 * 计算浮动元素在视口中的位置。
 *
 * @param anchorRect  锚元素（选区矩形 / 触发按钮）的 viewport 坐标
 * @param containerRect  容器（消息区 / dock / 视口）的 viewport 坐标，工具栏不能超出此范围
 * @param floatingSize  工具栏的测量尺寸（width/height），调用方自己 measure
 * @param opts  gap / edgeMargin / preferredSide / align
 */
export function computeFloatingPosition(
  anchorRect: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  containerRect: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  floatingSize: { width: number; height: number },
  opts: FloatingPositionOptions = {},
): FloatingPositionResult {
  const gap = opts.gap ?? 8;
  const edgeMargin = opts.edgeMargin ?? 6;
  const preferredSide: FloatingPlacement = opts.preferredSide ?? "top";
  const align: FloatingAlign = opts.align ?? "center";

  // 容错：尺寸异常就退到 anchor 左上角，不崩。
  const fw = Math.max(0, floatingSize.width);
  const fh = Math.max(0, floatingSize.height);

  const containerLeft = containerRect.left + edgeMargin;
  const containerRight = containerRect.right - edgeMargin;
  const containerTop = containerRect.top + edgeMargin;
  const containerBottom = containerRect.bottom - edgeMargin;

  // 1. flip：根据 preferredSide 估算可用空间
  const spaceAbove = anchorRect.top - containerTop;
  const spaceBelow = containerBottom - anchorRect.bottom;
  const fitAbove = spaceAbove >= fh + gap;
  const fitBelow = spaceBelow >= fh + gap;

  let placement: FloatingPlacement = preferredSide;
  let flipped = false;
  if (preferredSide === "top" && !fitAbove && fitBelow) {
    placement = "bottom";
    flipped = true;
  } else if (preferredSide === "bottom" && !fitBelow && fitAbove) {
    placement = "top";
    flipped = true;
  } else if (!fitAbove && !fitBelow) {
    // 两侧都放不下：选剩余空间更大的那侧（不 flip 标记，按"被迫放置"处理）
    placement = spaceAbove >= spaceBelow ? "top" : "bottom";
    flipped = placement !== preferredSide;
  }

  // 2. 主轴（top/bottom）坐标
  let top: number;
  if (placement === "top") {
    top = anchorRect.top - fh - gap;
  } else {
    top = anchorRect.bottom + gap;
  }

  // 3. 横向对齐
  let left: number;
  const anchorCenter = anchorRect.left + anchorRect.width / 2;
  if (align === "center") {
    left = anchorCenter - fw / 2;
  } else if (align === "start") {
    left = anchorRect.left;
  } else {
    left = anchorRect.right - fw;
  }

  // 4. shift：夹到容器范围内
  if (left < containerLeft) left = containerLeft;
  if (left + fw > containerRight) left = containerRight - fw;

  // 主轴夹边（容器比工具栏还窄时允许负值，但确保 left >= 0）
  if (top < containerTop) top = containerTop;
  if (top + fh > containerBottom) top = containerBottom - fh;
  if (left < 0) left = 0;
  if (top < 0) top = 0;

  return { left, top, placement, align, flipped };
}

/**
 * 把 viewport 坐标换算到指定 offsetParent 的本地坐标。
 * 当 anchor / floating 的 offsetParent 都不是 viewport 时，调用方需要这个。
 * 简版：取 floatingEl.offsetParent 当前的 viewport 偏移，差值。
 */
export function viewportToOffsetParent(
  viewportX: number,
  viewportY: number,
  offsetParent: Element | null,
): { left: number; top: number } {
  if (!offsetParent) return { left: viewportX, top: viewportY };
  const parentRect = offsetParent.getBoundingClientRect();
  return {
    left: viewportX - parentRect.left,
    top: viewportY - parentRect.top,
  };
}
