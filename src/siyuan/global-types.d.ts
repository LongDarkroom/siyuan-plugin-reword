/**
 * 思源全局环境类型（全局 ambient，无需 import 即可使用）
 * ------------------------------------------------------------------
 * 2026-08-28 迁移说明：原本散落在已删除的死代码目录 src/copilot-src/types/
 * 下。清理该目录时发现 src/siyuan/api.ts **依赖这里的全局类型**（BlockId、
 * DocumentId、IResReadDir、Window.siyuan 等），直接删除会导致 tsc 报
 * "Cannot find name" 数十处。故将其迁移到本文件——它们是思源 API 的公共
 * 类型，本就应归属 siyuan 层，而非某个已废弃的 copilot 分支目录。
 *
 * 版权：源自 frostime/siyuan-plugin-copilot（GPL-3.0），保留原始署名。
 */

/* ===== 以下源自 src/types/index.d.ts（Copyright (c) 2024 by frostime） ===== */

type DocumentId = string;
type BlockId = string;
type NotebookId = string;
type PreviousID = BlockId;
type ParentID = BlockId | DocumentId;

type Notebook = {
    id: NotebookId;
    name: string;
    icon: string;
    sort: number;
    closed: boolean;
}

type NotebookConf = {
    name: string;
    closed: boolean;
    refCreateSavePath: string;
    createDocNameTemplate: string;
    dailyNoteSavePath: string;
    dailyNoteTemplatePath: string;
}

type BlockType =
    | 'd'
    | 'p'
    | 'query_embed'
    | 'l'
    | 'i'
    | 'h'
    | 'iframe'
    | 'tb'
    | 'b'
    | 's'
    | 'c'
    | 'widget'
    | 't'
    | 'html'
    | 'm'
    | 'av'
    | 'audio';

type BlockSubType = "d1" | "d2" | "s1" | "s2" | "s3" | "t1" | "t2" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "table" | "task" | "toggle" | "latex" | "quote" | "html" | "code" | "footnote" | "cite" | "collection" | "bookmark" | "attachment" | "comment" | "mindmap" | "spreadsheet" | "calendar" | "image" | "audio" | "video" | "other";

type Block = {
    id: BlockId;
    parent_id?: BlockId;
    root_id: DocumentId;
    hash: string;
    box: string;
    path: string;
    hpath: string;
    name: string;
    alias: string;
    memo: string;
    tag: string;
    content: string;
    fcontent?: string;
    markdown: string;
    length: number;
    type: BlockType;
    subtype: BlockSubType;
    /** string of { [key: string]: string } */
    ial?: string;
    sort: number;
    created: string;
    updated: string;
}

type doOperation = {
    action: string;
    data: string;
    id: BlockId;
    parentID: BlockId | DocumentId;
    previousID: BlockId;
    retData: null;
}

interface Window {
    siyuan: {
        config: any;
        notebooks: any;
        menus: any;
        dialogs: any;
        blockPanels: any;
        storage: any;
        user: any;
        ws: any;
        languages: any;
        emojis: any;
    };
    Lute: any;
}

/* ===== 以下源自 src/types/api.d.ts（思源内核 API 响应结构） ===== */

interface IResGetNotebookConf {
    box: string;
    conf: NotebookConf;
    name: string;
}

interface IReslsNotebooks {
    notebooks: Notebook[];
}

interface IResUpload {
    errFiles: string[];
    succMap: { [key: string]: string };
}

interface IResdoOperations {
    doOperations: doOperation[];
    undoOperations: doOperation[] | null;
}

interface IResGetBlockKramdown {
    id: BlockId;
    kramdown: string;
}

interface IResGetChildBlock {
    id: BlockId;
    type: BlockType;
    subtype?: BlockSubType;
}

interface IResGetTemplates {
    content: string;
    path: string;
}

interface IResReadDir {
    isDir: boolean;
    isSymlink: boolean;
    name: string;
}

interface IResExportMdContent {
    hPath: string;
    content: string;
}

interface IResBootProgress {
    progress: number;
    details: string;
}

interface IResForwardProxy {
    body: string;
    contentType: string;
    elapsed: number;
    headers: { [key: string]: string };
    status: number;
    url: string;
}

interface IResExportResources {
    path: string;
}

interface IResSearchDocs {
    box: string;
    path: string;
    hPath: string;
}
