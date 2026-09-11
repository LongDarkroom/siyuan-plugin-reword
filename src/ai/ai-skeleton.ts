/**
 * 骨架模式开关（2026-09-10 建立，2026-09-10 当天关闭）。
 *
 * 背景：AI 精读面板长期功能堆叠，用户「摸不着头脑」。本开关把面板收敛为
 * 「对话骨架」——只保留：打开 → 选角色 → 输入 → 发送 → 流式展示 这条主链，
 * 其余功能暂时屏蔽（**断线保留，不删代码**）。
 *
 * ## 当前状态：已全面恢复
 * `SKELETON_ONLY = false` —— 面板功能按钮与右键菜单入口全部恢复可见可用。
 * 机制三层（开关 / shieldAttr / index.less 规则）**原样保留**，随时可再翻回
 * `true` 重新收敛，不需要重建。
 *
 * ## 找回方式（任选其一，都只改一处）
 * 1. 把 `SKELETON_ONLY` 改回 `true` —— 全部重新收敛；
 * 2. 给某个元素加回 `data-shield="xxx"` —— 单项重新收敛；
 * 3. 在 `index.ts` 右键菜单项前加 `if (SKELETON_ONLY) return;` —— 收敛入口。
 *
 * ## 屏蔽清单（骨架模式下会隐藏的项，由 index.less 的 `[data-shield]` 规则执行）
 * | 标记          | 对应功能                                              |
 * |---------------|-------------------------------------------------------|
 * | `read-import` | 顶栏「导入选区」按钮                                   |
 * | `query`       | 顶栏「查询批注」按钮 + 批注查询侧滑面板                 |
 * | `copyall`     | 顶栏「复制全部对话」按钮                               |
 * | `fullscreen`  | 顶栏「全屏」按钮                                       |
 * | `upload`      | 输入区「上传文件」按钮                                 |
 * | `templates`   | 输入区「快捷指令」按钮                                 |
 * | `tokenring`   | 输入区右侧「上下文用量环」                             |
 * | `ctx-menu`    | 文档树 / 页签右键「AI 精读此文档」（index.ts 守卫）     |
 *
 * 注：被屏蔽元素的事件绑定仍照常注册（元素只是 `display:none`），
 * 因此不会有「查不到节点」的运行时报错——这是刻意为之的低风险做法。
 */
export const SKELETON_ONLY = false;

/**
 * 生成 `data-shield` 属性串。
 * 骨架模式返回 ` data-shield="名字"`；关闭后返回空串，元素即恢复显示。
 *
 * 用法（模板字符串内）：`<button id="x"${shieldAttr("x")}>…</button>`
 */
export function shieldAttr(name: string): string {
  return SKELETON_ONLY ? ` data-shield="${name}"` : "";
}
