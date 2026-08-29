/**
 * Svelte action：把元素传送到指定容器（默认 document.body）。
 * 用于让 REword dock 内的模态面板逃离 dock 的 transform 裁剪上下文，
 * 从而使用全屏遮罩、更宽的内容区。
 */
export function portal(node: HTMLElement, target: HTMLElement | string = "body") {
  let targetEl: HTMLElement;
  if (typeof target === "string") {
    targetEl = (document.querySelector(target) as HTMLElement) || document.body;
  } else {
    targetEl = target;
  }
  // 先隐藏，防止在原始位置闪现一帧
  node.style.visibility = "hidden";
  targetEl.appendChild(node);
  requestAnimationFrame(() => {
    node.style.visibility = "";
  });
  return {
    destroy() {
      if (node.parentNode) node.parentNode.removeChild(node);
    },
  };
}
