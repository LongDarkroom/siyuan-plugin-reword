/**
 * 适配器注册表装配（R1 收敛 · Readest 蓝本）
 * ---------------------------------------------------------------
 * 各适配器模块加载时自注册到 content-adapter 的 registry；
 * 本文件被 document-loader 副作用引入，确保 DocumentLoader 可用前已注册完毕。
 *
 * 映射关系（与旧 openBook 分支行为等价）：
 *   epub/mobi/azw3/fb2 → EpubAdapter（foliate 原生）
 *   pdf                → PdfAdapter（foliate + PDF.js 大纲）
 *   text(txt/md)       → TextAdapter（makeTextBook）
 *   comic(cbz)         → ComicAdapter（foliate 图片序列，无文本）
 *   other              → EpubAdapter（兜底，等价于旧 else 分支 view.open(file)）
 */
import { registerAdapter } from "../content-adapter.ts";
import { EpubAdapter } from "./epub-adapter.ts";
import { PdfAdapter } from "./pdf-adapter.ts";
import { TextAdapter } from "./text-adapter.ts";
import { ComicAdapter } from "./comic-adapter.ts";

registerAdapter("epub", EpubAdapter);
registerAdapter("pdf", PdfAdapter);
registerAdapter("text", TextAdapter);
registerAdapter("comic", ComicAdapter);
registerAdapter("other", EpubAdapter);

export { EpubAdapter, PdfAdapter, TextAdapter, ComicAdapter };
