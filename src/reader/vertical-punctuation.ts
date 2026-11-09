/**
 * 竖排标点替换（vertical punctuation）
 *
 * 2026-10-06。中文竖排（`writing-mode: vertical-rl`）时，横排形态的引号
 * 位于字框的左上/右上，旋转 90° 后既不像引号、也偏离字面中心；
 * 传统排版会换成专用的**竖排字形**（旋转后的引号），字面居中、位置正确。
 *
 * 简繁两套映射（对齐 Readest `services/transformers/punctuation.ts`）：
 *   简体（Hans）：横排双引号 “” → 竖排 ﹃﹄；横排单引号 ‘’ / 「」『』 → 竖排 ﹁﹂
 *   繁体（Hant）：横排双引号 “” → 竖排 ﹁﹂；横排单引号 ‘’ / 「」『』 → 竖排 ﹃﹄
 *   （繁体的「」『』本身就是竖排形态，映射方向与简体相反）
 *
 * ── 为什么可以安全地「改文本内容」而不破坏标注/CFI（实测 2026-10-06）──
 * 竖排字形 ﹃(U+FE43) ﹄(U+FE44) ﹁(U+FE41) ﹂(U+FE42) 都是 **BMP 内单码位**，
 * 替换前后文本节点长度**完全不变**（实测 12 → 12）⇒
 *   - EPUB CFI 的字符偏移量不受影响 ⇒ 进度/位置恢复、已有标注锚点全部保持有效；
 *   - 划词、批注、TTS 跟读读到的文本内容一致（只是字形变了，语义不变）。
 * ⚠️ 反例：若改成**代理对**字符（如 U+1Fxxx 竖排系列），长度会变 ⇒ 会破坏 CFI。
 * 因此**只允许映射到 BMP 单码位字符**，新增映射时必须保持此约束。
 *
 * ── 字形可用性实测 ──
 * canvas `measureText` 量不出字形有无（缺字形与全角字都返回 40px）；
 * 判定必须**看渲染截图**：PingFang SC / Songti SC / LXGW WenKai / SimSun
 * 四种中文字体对这 4 个码位**均正常显示**（旋转引号形状），而私用区码位显示为方框。
 * ⇒ 主流中文字体都覆盖，无需额外 @font-face 兜底。
 */

/** 竖排双引号 ﹃ U+FE43 / ﹄ U+FE44；竖排单引号 ﹁ U+FE41 / ﹂ U+FE42 */
const V_DBL_OPEN = "﹃";
const V_DBL_CLOSE = "﹄";
const V_SGL_OPEN = "﹁";
const V_SGL_CLOSE = "﹂";

/** 简体映射：横排双引号 → 竖排双引号；单引号/直角引号 → 竖排单引号 */
const MAP_HANS: ReadonlyArray<readonly [string, string]> = [
  ["“", V_DBL_OPEN],
  ["”", V_DBL_CLOSE],
  ["‘", V_SGL_OPEN],
  ["’", V_SGL_CLOSE],
  ["「", V_SGL_OPEN],
  ["」", V_SGL_CLOSE],
  ["『", V_DBL_OPEN],
  ["』", V_DBL_CLOSE],
];

/** 繁体映射：双引号与单引号的竖排字形归属与简体相反 */
const MAP_HANT: ReadonlyArray<readonly [string, string]> = [
  ["“", V_SGL_OPEN],
  ["”", V_SGL_CLOSE],
  ["‘", V_DBL_OPEN],
  ["’", V_DBL_CLOSE],
  ["「", V_SGL_OPEN],
  ["」", V_SGL_CLOSE],
  ["『", V_DBL_OPEN],
  ["』", V_DBL_CLOSE],
];

/** 繁体地区判定（与 Readest 的 traditionalChineseLocales 一致） */
const HANT_LOCALES = new Set(["zh-hant", "zh-tw", "zh_hant", "zh_hk", "zh-hk"]);

/** 判定一本书是否该用繁体映射：优先看书籍语言，其次看界面语言 */
export function shouldUseHant(bookLanguage: string | undefined, uiLanguage: string | undefined): boolean {
  const bl = (bookLanguage || "").toLowerCase();
  const ul = (uiLanguage || "").toLowerCase();
  return HANT_LOCALES.has(bl) || HANT_LOCALES.has(ul);
}

/**
 * 把 HTML 字符串里的横排引号替换为竖排字形。
 *
 * 只替换**文本节点**里的字符 —— 用「标签外才替换」的方式跳过标签本身，
 * 避免破坏 `<a title="说“话”">` 这类属性值。
 *
 * ⚠️ **刻意不提供「反向还原」**（实测踩坑，2026-10-06）：
 * 映射是**多对多** —— 简体里 `‘` 与 `「` 都映射到 `﹁`、`’` 与 `」` 都映射到 `﹂`
 * （繁体则相反）。因此从竖排字形**无法唯一反推**原字符（试过：
 * `「引用」` 还原后变成 `‘引用’`，`『强调』` 变成 `“强调”`）。
 * Readest 有 `reversePunctuationTransform` 但它服务于「简繁转换的反向」，
 * 且默认关闭；本项目不需要该场景（关闭竖排时压根不调用本函数即可）。
 * ⇒ 保持单一方向，函数签名不带 reverse。
 *
 * @param html 书内 HTML（章节正文）
 * @param hant 是否用繁体映射
 */
export function transformVerticalPunctuation(html: string, hant: boolean): string {
  if (typeof html !== "string" || !html) return html;
  const map = hant ? MAP_HANT : MAP_HANS;
  // 逐段扫描，标签内不动
  let out = "";
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out += replaceSegment(html.slice(i), map);
      break;
    }
    out += replaceSegment(html.slice(i, lt), map);
    // 找到该标签的结束 '>'（正文属性里极少出现裸 '>'）
    const gt = html.indexOf(">", lt);
    if (gt === -1) {
      out += html.slice(lt);
      break;
    }
    out += html.slice(lt, gt + 1);
    i = gt + 1;
  }
  return out;
}

function replaceSegment(seg: string, map: ReadonlyArray<readonly [string, string]>): string {
  if (!seg) return seg;
  let r = seg;
  for (const [from, to] of map) {
    if (from === to) continue;
    r = r.split(from).join(to);
  }
  return r;
}
