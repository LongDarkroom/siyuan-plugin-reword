/**
 * 阅读器 - 文本编码探测与解码（共用模块）
 * ---------------------------------------------------------------
 * 供两处复用：
 * 1. book-adapters.ts —— TXT/MD 纯文本书籍解码
 * 2. foliate 的 view-light.js —— EPUB 的 nav.xhtml / toc.ncx / OPF 等 XML 文件解码
 *
 * 背景（问题 1 修复，2026-08-23）：
 * foliate 官方 makeZipLoader 的 loadText 用 zip.js 的 TextWriter()（固定 UTF-8）。
 * 国内出版物常用 GBK/GB2312 编码的 EPUB（nav/ncx 非 UTF-8），硬解 UTF-8 → 中文目录
 * 标题变 � 乱码。这里用「BOM + 严格 UTF-8 校验 + GBK 高字节启发式」自动探测，
 * 让 EPUB 目录和 TXT 书籍一样能正确解码。
 *
 * 安全性：纯解码逻辑，无 DOM/网络操作，可安全在 iframe 上下文调用。
 */

/**
 * 探测文本编码（前 4KB 采样）：
 * - UTF-8 BOM / 合法 UTF-8 → utf-8
 * - UTF-16 LE/BE BOM → utf-16le / utf-16be
 * - 高比例字节落在 GBK 双字节区 → gbk（兼容 GB2312）
 * - 否则 utf-8（现代默认）
 */
export function detectTextEncoding(buf: Uint8Array): string {
  const len = Math.min(buf.length, 4096);
  const sample = buf.subarray(0, len);
  // BOM
  if (len >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) return "utf-8";
  if (len >= 2 && sample[0] === 0xff && sample[1] === 0xfe) return "utf-16le";
  if (len >= 2 && sample[0] === 0xfe && sample[1] === 0xff) return "utf-16be";
  // 严格 UTF-8 校验；失败则尝试 GBK
  let invalidUtf8 = 0;
  let gbkHighBytes = 0;
  let i = 0;
  while (i < len) {
    const b = sample[i];
    if (b < 0x80) {
      i++;
      continue;
    }
    let need = 0;
    if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) need = 2;
    else if (b >= 0xf0 && b <= 0xf4) need = 3;
    else {
      invalidUtf8++;
      if ((b >= 0x81 && b <= 0xfe) || (b >= 0xa1 && b <= 0xf7)) gbkHighBytes++;
      i++;
      continue;
    }
    if (i + need >= len) break;
    let ok = true;
    for (let k = 1; k <= need; k++) {
      const c = sample[i + k];
      if (c < 0x80 || c > 0xbf) {
        ok = false;
        break;
      }
    }
    if (!ok) {
      invalidUtf8++;
      if (b >= 0x81 && b <= 0xfe) gbkHighBytes++;
      i++;
      continue;
    }
    i += need + 1;
  }
  // GBK 双字节通常占汉字文本大半；采样中非 ASCII 字节多数落在 GBK 区即判定
  // 2026-08-23 阈值下调：旧 max(2, len*0.02) 对「采样内汉字较少」的 GBK 文本不敏感。
  //   下调到 max(1, len*0.01) 提高召回；合法 UTF-8 不会在此分支累积计数，天然抗误判。
  if (gbkHighBytes > 0 && gbkHighBytes >= Math.max(1, len * 0.01)) {
    return "gbk";
  }
  void invalidUtf8;
  return "utf-8";
}

/** 按编码解码文本（GBK 用 TextDecoder('gbk')；utf-16 处理 BOM；失败兜底 UTF-8） */
export function decodeText(buf: Uint8Array): string {
  const enc = detectTextEncoding(buf);
  try {
    if (enc === "gbk") return new TextDecoder("gbk").decode(buf);
    if (enc === "utf-16le") return new TextDecoder("utf-16le").decode(buf.subarray(2));
    if (enc === "utf-16be") return new TextDecoder("utf-16be").decode(buf.subarray(2));
    const withBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    return new TextDecoder("utf-8").decode(withBom ? buf.subarray(3) : buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}