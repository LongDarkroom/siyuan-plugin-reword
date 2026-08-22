/**
 * 折叠 / 展开单个「词性区块」。
 *
 * 由侧边栏点击处理器 handleDockClick 的 `toggle-pos` 分支调用，
 * 同时被单元测试直接引用（本文件不依赖任何外部模块，便于在 Node 下独立测试）。
 *
 * 行为：
 *  - 在 `.hiword-vb-pos-block` 上切换 `hiword-vb-pos-collapsed` 类
 *    （CSS 据此把 `.hiword-vb-pos-body` 的 max-height 置 0 + opacity 0 实现收起）
 *  - 同步切换词性框 `.hiword-vb-pos-toggle` 的 `hiword-vb-pos-open` 类（控制高亮/箭头旋转）
 *
 * @returns 折叠后的状态：true = 已收起，false = 已展开
 */
export function togglePosCollapsed(block: HTMLElement): boolean {
  const collapsed = block.classList.toggle("hiword-vb-pos-collapsed");
  const chip = block.querySelector<HTMLElement>(".hiword-vb-pos-toggle");
  if (chip) chip.classList.toggle("hiword-vb-pos-open", !collapsed);
  return collapsed;
}
