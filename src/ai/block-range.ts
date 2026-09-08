// 2026-09-08 标题块范围收集：文档树序重建 + 标题范围收集（纯函数，可单测）
//
// 关键陷阱：思源 `blocks.sort` 字段**仅表示同父级兄弟之间的顺序**，
// 不是整篇文档的全局视觉顺序。若对整篇文档 `ORDER BY sort ASC`，
// 会把不同父级下 `sort=0` 的块先全部排一起、再 `sort=1`……顺序完全打乱。
// 这会让"被选中标题"在结果集里落到错误位置，导致向后收集时把上方内容也扫进来。
//
// 正确做法：用 `parent_id` 重建树，每组内部按 `sort` 排序，深度优先遍历得到真实视觉顺序。

/** 文档块行的最小结构（来自 `blocks` 表）。markdown/content 为可选，便于测试构造。 */
export interface RangeBlock {
  id: string;
  parent_id?: string | null;
  type: string;
  subtype?: string | null;
  sort?: number | null;
  markdown?: string | null;
  content?: string | null;
}

/**
 * 把同一文档的块行按父子关系重建为「视觉顺序」数组。
 *
 * @param rows  同文档全部块（含 parent_id / sort）
 * @param rootId 文档根块 id（顶层块的 parent_id === rootId）
 * @returns 深度优先遍历后的真实文档顺序；空输入返回空数组
 */
export function orderBlocksByTree(rows: RangeBlock[], rootId: string): RangeBlock[] {
  if (!rows?.length) return [];
  const childrenMap = new Map<string, RangeBlock[]>();
  for (const r of rows) {
    if (r.id === rootId) continue; // 文档根块不作为任何块的子节点，避免自环
    const pid = r.parent_id ?? rootId;
    let list = childrenMap.get(pid);
    if (!list) {
      list = [];
      childrenMap.set(pid, list);
    }
    list.push(r);
  }
  // 同父级内部按 sort 升序；sort 缺失/相等时用 id 字典序兜底，保证稳定
  for (const list of childrenMap.values()) {
    list.sort((a, b) => {
      const sa = a.sort ?? 0;
      const sb = b.sort ?? 0;
      if (sa !== sb) return sa - sb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }
  const ordered: RangeBlock[] = [];
  // 从文档根往下 DFS；文档根块本身不进结果（type='d' 无正文）
  const visit = (parentId: string): void => {
    const kids = childrenMap.get(parentId);
    if (!kids) return;
    for (const k of kids) {
      ordered.push(k);
      visit(k.id);
    }
  };
  visit(rootId);
  return ordered;
}

/**
 * 在已排序的文档顺序中，从指定标题块向后收集其下属内容。
 *
 * - 含标题自身；
 * - 更低级子标题（如 H3 下的 H4）继续收集，遇**同级或更高级**标题停止；
 * - 总量超过 maxTotal 时退化为仅标题自身（避免截断到一半的正文误导 AI）；
 * - 空结果返回 null（调用方据此退化为单块 fetchBlockText）。
 */
export function collectHeadingRange(
  ordered: RangeBlock[],
  blockId: string,
  level: number,
  maxTotal: number
): string | null {
  const idx = ordered.findIndex((r) => r.id === blockId);
  if (idx < 0) return null;

  const collected: string[] = [];
  let total = 0;
  for (let i = idx; i < ordered.length; i++) {
    const r = ordered[i];
    if (i > idx && r.type === "h") {
      const lvl = parseInt((r.subtype || "h1").replace(/[^0-9]/g, ""), 10) || 1;
      // 同级或更高级标题 → 停止收集
      if (lvl <= level) break;
    }
    const body = (r.markdown || r.content || "").trim();
    if (!body) continue;
    if (total + body.length > maxTotal) break;
    collected.push(body);
    total += body.length;
  }

  if (!collected.length) return null;

  // 超总量预算：退化为仅标题块自身
  if (total >= maxTotal) {
    const head = (ordered[idx].markdown || ordered[idx].content || "").trim();
    return head || collected.join("\n\n");
  }
  return collected.join("\n\n");
}

/** 解析标题 subtype（h1~h6）→ 数字级别，缺省 1。 */
export function headingLevelOf(subtype?: string | null): number {
  return parseInt((subtype || "h1").replace(/[^0-9]/g, ""), 10) || 1;
}
