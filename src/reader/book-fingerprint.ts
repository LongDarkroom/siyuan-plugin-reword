/**
 * 内容指纹 → 稳定 bookId
 * ------------------------------------------------------------------
 * 同一实体书（无论导入几次、删除后重导、换文件名）永远得到相同 id，
 * 从而复用同一份 `translations/<id>.json` 缓存，杜绝历史上「随机 id
 * 导致同一本书产生多份缓存文件」的问题。
 *
 * 指纹来源（按稳定性排序）：
 *  1. EPUB/PDF 的 content identifier（最稳，与文件名/标题无关）
 *  2. 书名 + 作者（content 缺失时回退）
 *  3. 文件大小 + 格式（兜底去歧义，避免不同书撞同名）
 * 用 FNV-1a（短、无依赖、跨平台一致）。
 *
 * 独立成模块：本函数被书架导入逻辑与单元测试共用；不依赖任何类/
 * 参数属性，便于 Node `--experimental-strip-types` 直接导入测试。
 */
export function bookFingerprint(input: {
  identifier?: string;
  title: string;
  author?: string;
  size: number;
  format: string;
}): string {
  const idPart =
    input.identifier ||
    [input.title, input.author].filter(Boolean).join("|") ||
    "unknown";
  const raw = `${idPart}|${input.size}|${input.format}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "b" + (h >>> 0).toString(36);
}
