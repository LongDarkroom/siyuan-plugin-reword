/**
 * SiYuan API 统一收口（枢纽）
 * ------------------------------------------------------------------
 * 全插件唯一的 SiYuan 内核 API 封装来源。原先散落在 4 处的封装
 * （src/siyuan/client.ts、src/vocab/block-api.ts、src/copilot/api/siyuan.ts、
 * src/copilot-src/api.ts）已统一收敛到此文件：
 *   - ②③ 已删除，调用方直接 import 本文件；
 *   - ④ src/copilot-src/api.ts 改为 `export * from "../siyuan/api.ts"` + 仅保留
 *     其专属签名函数（位置参数 forwardProxy / fetch-like forwardProxyFetch）；
 *   - ③ src/copilot/api/siyuan.ts 改为 `export * from "../../siyuan/api"` + 对象式
 *     forwardProxy 别名（兼容旧 chat 的动态 import）。
 *
 * 关键统一点：所有「经思源内核代理转发外部请求」的调用都走 `forwardProxyRaw`，
 * 不再有 60s/7s/120s 三种默认超时与不同返回结构并存的分叉。
 *
 * See API Document in [API.md](https://github.com/siyuan-note/siyuan/blob/master/API.md)
 * API 文档见 [API_zh_CN.md](https://github.com/siyuan-note/siyuan/blob/master/API_zh_CN.md)
 */

import { fetchPost, fetchSyncPost, IWebSocketData, openTab, Constants, platformUtils, openMobileFileById } from "siyuan";
import { getLogger } from "../core/logger.ts";
import { isMobile } from "../core/env.ts";

/** 通用请求：返回 data；业务错误（code != 0）时仍返回 data（宽松取值，保持旧行为） */
export async function request(url: string, data: any, returnType: 'data' | 'response' = 'data') {
    let response: IWebSocketData = await fetchSyncPost(url, data);
    let res = response.code === 0 ? response.data : null;
    return returnType === 'data' ? res : response;
}

/** 文档摘要（用于添加 / 搜索列表展示） */
export interface DocSummary {
    id: string; // 文档根块 id（root_id）
    name: string; // 文档标题（块内容）
    hpath: string; // 完整路径，如 /笔记本/父文档/本文档
    notebookId?: string; // 所属笔记本 id
    updated?: number; // 更新时间（ms 时间戳，可能缺失）
}

/** 块（SQL 查询返回的子集） */
export interface SiyuanBlock {
    id: string;
    content: string; // 块纯文本内容
    markdown?: string; // 块 markdown
    type?: string; // 块类型：d=文档, h=标题, p=段落 ...
    root_id?: string; // 所属文档根块 id
    hpath?: string;
    updated?: string;
    [key: string]: any;
}

/** 笔记本信息 */
export interface Notebook {
    id: string;
    name: string;
    closed: boolean;
}

// **************************************** Riff (闪卡) ****************************************

export async function addRiffCards(blockIDs: string[], deckID: string = Constants.QUICK_DECK_ID): Promise<any> {
    let data = {
        deckID: deckID,
        blockIDs: blockIDs
    };
    let url = '/api/riff/addRiffCards';
    return request(url, data);
}

export async function removeRiffCards(blockIDs: string[], deckID: string = Constants.QUICK_DECK_ID): Promise<any> {
    let data = {
        deckID: deckID,
        blockIDs: blockIDs
    };
    let url = '/api/riff/removeRiffCards';
    return request(url, data);
}

export async function getRiffDecks(): Promise<any> {
    let url = '/api/riff/getRiffDecks';
    return request(url, {});
}

export async function createRiffDeck(name: string): Promise<any> {
    let data = {
        name: name
    };
    let url = '/api/riff/createRiffDeck';
    return request(url, data);
}

export async function removeRiffDeck(deckID: string): Promise<any> {
    let data = {
        deckID: deckID
    };
    let url = '/api/riff/removeRiffDeck';
    return request(url, data);
}

export async function renameRiffDeck(deckID: string, name: string): Promise<any> {
    let data = {
        deckID: deckID,
        name: name
    };
    let url = '/api/riff/renameRiffDeck';
    return request(url, data);
}

export async function getRiffCards(deckID: string): Promise<any> {
    let data = {
        deckID: deckID
    };
    let url = '/api/riff/getRiffCards';
    return request(url, data);
}


// **************************************** Noteboook ****************************************

export async function lsNotebooks(): Promise<IReslsNotebooks> {
    let url = '/api/notebook/lsNotebooks';
    const res = await request(url, '');
    try {
        if (res && res.notebooks && Array.isArray(res.notebooks)) {
            // 只返回未关闭的笔记本
            res.notebooks = res.notebooks.filter((n: any) => n.closed === false || n.closed === 0 || n.closed === 'false' ? true : false);
        }
    } catch (e) {
        getLogger().error("Filter notebooks error:", { error: e });
    }
    return res;
}


export async function openNotebook(notebook: NotebookId) {
    let url = '/api/notebook/openNotebook';
    return request(url, { notebook: notebook });
}


export async function closeNotebook(notebook: NotebookId) {
    let url = '/api/notebook/closeNotebook';
    return request(url, { notebook: notebook });
}


export async function renameNotebook(notebook: NotebookId, name: string) {
    let url = '/api/notebook/renameNotebook';
    return request(url, { notebook: notebook, name: name });
}


export async function createNotebook(name: string): Promise<Notebook> {
    let url = '/api/notebook/createNotebook';
    return request(url, { name: name });
}


export async function removeNotebook(notebook: NotebookId) {
    let url = '/api/notebook/removeNotebook';
    return request(url, { notebook: notebook });
}


export async function getNotebookConf(notebook: NotebookId): Promise<IResGetNotebookConf> {
    let data = { notebook: notebook };
    let url = '/api/notebook/getNotebookConf';
    return request(url, data);
}


export async function setNotebookConf(notebook: NotebookId, conf: NotebookConf): Promise<NotebookConf> {
    let data = { notebook: notebook, conf: conf };
    let url = '/api/notebook/setNotebookConf';
    return request(url, data);
}


// **************************************** File Tree ****************************************

export async function getDoc(id: BlockId) {
    let data = {
        id: id
    };
    let url = '/api/filetree/getDoc';
    return request(url, data);
}


export async function createDocWithMd(notebook: NotebookId, path: string, markdown: string): Promise<DocumentId> {
    let data = {
        notebook: notebook,
        path: path,
        markdown: markdown,
    };
    let url = '/api/filetree/createDocWithMd';
    return request(url, data);
}


export async function renameDoc(notebook: NotebookId, path: string, title: string): Promise<DocumentId> {
    let data = {
        notebook: notebook,
        path: path,
        title: title
    };
    let url = '/api/filetree/renameDoc';
    return request(url, data);
}

export async function renameDocByID(id: string, title: string): Promise<DocumentId> {
    let data = {
        id: id,
        title: title
    };
    let url = '/api/filetree/renameDocByID';
    return request(url, data);
}


export async function removeDoc(notebook: NotebookId, path: string) {
    let data = {
        notebook: notebook,
        path: path,
    };
    let url = '/api/filetree/removeDoc';
    return request(url, data);
}


export async function moveDocs(fromPaths: string[], toNotebook: NotebookId, toPath: string) {
    let data = {
        fromPaths: fromPaths,
        toNotebook: toNotebook,
        toPath: toPath
    };
    let url = '/api/filetree/moveDocs';
    return request(url, data);
}

export async function moveDocsByID(fromIDs: string[], toID: string) {
    let data = {
        fromIDs: fromIDs,
        toID: toID
    };
    let url = '/api/filetree/moveDocsByID';
    return request(url, data);
}


export async function getHPathByPath(notebook: NotebookId, path: string): Promise<string> {
    let data = {
        notebook: notebook,
        path: path
    };
    let url = '/api/filetree/getHPathByPath';
    return request(url, data);
}


export async function getHPathByID(id: BlockId): Promise<string> {
    let data = {
        id: id
    };
    let url = '/api/filetree/getHPathByID';
    return request(url, data);
}


export async function getIDsByHPath(notebook: NotebookId, path: string): Promise<BlockId[]> {
    let data = {
        notebook: notebook,
        path: path
    };
    let url = '/api/filetree/getIDsByHPath';
    return request(url, data);
}

export async function listDocsByPath(notebook: NotebookId, path: string, sort: number = 15, showHidden: boolean = false, maxListCount: number = 10000): Promise<any> {
    let data = {
        notebook: notebook,
        path: path,
        sort: sort,
        showHidden: showHidden,
        maxListCount: maxListCount
    };
    let url = '/api/filetree/listDocsByPath';
    return request(url, data);
}

export async function searchDocs(k: string, flashcard: boolean = false): Promise<IResSearchDocs[]> {
    let data = {
        k: k,
        flashcard: flashcard
    };
    let url = '/api/filetree/searchDocs';
    return request(url, data);
}

// **************************************** Asset Files ****************************************

export async function upload(assetsDirPath: string, files: any[]): Promise<IResUpload> {
    let form = new FormData();
    form.append('assetsDirPath', assetsDirPath);
    for (let file of files) {
        form.append('file[]', file);
    }
    let url = '/api/asset/upload';
    return request(url, form);
}

// **************************************** Block ****************************************
type DataType = "markdown" | "dom";
export async function insertBlock(
    dataType: DataType, data: string,
    nextID?: BlockId, previousID?: BlockId, parentID?: BlockId
): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        nextID: nextID,
        previousID: previousID,
        parentID: parentID
    }
    let url = '/api/block/insertBlock';
    return request(url, payload);
}


export async function prependBlock(dataType: DataType, data: string, parentID: BlockId | DocumentId): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        parentID: parentID
    }
    let url = '/api/block/prependBlock';
    return request(url, payload);
}


export async function appendBlock(dataType: DataType, data: string, parentID: BlockId | DocumentId): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        parentID: parentID
    }
    let url = '/api/block/appendBlock';
    return request(url, payload);
}


export async function updateBlock(dataType: DataType, data: string, id: BlockId): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        id: id
    }
    let url = '/api/block/updateBlock';
    return request(url, payload);
}


export async function deleteBlock(id: BlockId): Promise<IResdoOperations[]> {
    let data = {
        id: id
    }
    let url = '/api/block/deleteBlock';
    return request(url, data);
}


export async function moveBlock(id: BlockId, previousID?: PreviousID, parentID?: ParentID): Promise<IResdoOperations[]> {
    let data = {
        id: id,
        previousID: previousID,
        parentID: parentID
    }
    let url = '/api/block/moveBlock';
    return request(url, data);
}


export async function foldBlock(id: BlockId) {
    let data = {
        id: id
    }
    let url = '/api/block/foldBlock';
    return request(url, data);
}


export async function unfoldBlock(id: BlockId) {
    let data = {
        id: id
    }
    let url = '/api/block/unfoldBlock';
    return request(url, data);
}
export async function refreshSql() {
    return fetchSyncPost('/api/sqlite/flushTransaction');
}

export async function getBlockKramdown(id: BlockId, mode: string = 'textmark'): Promise<IResGetBlockKramdown> {
    let data = {
        id: id,
        mode: mode // 'md' or 'textmark',
    }
    let url = '/api/block/getBlockKramdown';
    return request(url, data); // 返回值 data.kramdown
}
export async function getBlockDOM(id: BlockId) {
    let data = {
        id: id
    }
    let url = '/api/block/getBlockDOM';
    return request(url, data);
}

export async function getChildBlocks(id: BlockId): Promise<IResGetChildBlock[]> {
    let data = {
        id: id
    }
    let url = '/api/block/getChildBlocks';
    return request(url, data);
}

export async function transferBlockRef(fromID: BlockId, toID: BlockId, refIDs: BlockId[]) {
    let data = {
        fromID: fromID,
        toID: toID,
        refIDs: refIDs
    }
    let url = '/api/block/transferBlockRef';
    return request(url, data);
}

// **************************************** Attributes ****************************************
export async function setBlockAttrs(id: BlockId, attrs: { [key: string]: string }) {
    let data = {
        id: id,
        attrs: attrs
    }
    let url = '/api/attr/setBlockAttrs';
    return request(url, data);
}


export async function getBlockAttrs(id: BlockId): Promise<{ [key: string]: string }> {
    let data = {
        id: id
    }
    let url = '/api/attr/getBlockAttrs';
    return request(url, data);
}

// **************************************** SQL ****************************************

export async function sql<T = Record<string, any>>(sql: string): Promise<T[]> {
    let sqldata = {
        stmt: sql,
    };
    let url = '/api/query/sql';
    return request(url, sqldata);
}

export async function getBlockByID(blockId: string): Promise<Block> {
    let sqlScript = `select * from blocks where id ='${blockId}'`;
    let data = await sql<Block>(sqlScript);
    return data[0];
}

export async function openBlock(blockId: string) {
    // 检测块是否存在
    const block = await getBlockByID(blockId);
    if (!block) {
        throw new Error('块不存在');
    }
    // 判断是否是移动端（统一走 core/env 工具）
    if (isMobile()) {
        // 如果是mobile，直接打开块
        openMobileFileById(window.siyuan.ws.app, blockId);
        return;
    }
    // 判断块的类型
    const isDoc = block.type === 'd';
    if (isDoc) {
        openTab({
            app: window.siyuan.ws.app,
            doc: {
                id: blockId,
                action: ["cb-get-focus", "cb-get-scroll"]
            },
            keepCursor: false,
            removeCurrentTab: false,
            openNewTab: true
        });
    } else {
        openTab({
            app: window.siyuan.ws.app,
            doc: {
                id: blockId,
                action: ["cb-get-focus", "cb-get-context", "cb-get-hl"]
            },
            keepCursor: false,
            removeCurrentTab: false,
            openNewTab: true
        });

    }
}
// **************************************** Template ****************************************

export async function render(id: DocumentId, path: string): Promise<IResGetTemplates> {
    let data = {
        id: id,
        path: path
    }
    let url = '/api/template/render';
    return request(url, data);
}


export async function renderSprig(template: string): Promise<string> {
    let url = '/api/template/renderSprig';
    return request(url, { template: template });
}

// **************************************** File ****************************************



export async function getFile(path: string): Promise<any> {
    let data = {
        path: path
    }
    let url = '/api/file/getFile';
    return new Promise((resolve, _) => {
        fetchPost(url, data, (content: any) => {
            resolve(content)
        });
    });
}


/**
 * fetchPost will secretly convert data into json, this func merely return Blob
 * @param endpoint
 * @returns
 */
export const getFileBlob = async (path: string): Promise<Blob | null> => {
    const endpoint = '/api/file/getFile'
    try {
        let response = await fetch(endpoint, {
            method: 'POST',
            body: JSON.stringify({
                path: path
            })
        });
        if (!response.ok) {
            return null;
        }

        let blob = await response.blob();

        // 检查是否为 JSON 格式的错误信息
        // 只有当 Content-Type 是 json 时才检查
        if (blob.type.includes('application/json')) {
            const text = await blob.text();
            try {
                const json = JSON.parse(text);
                // SiYuan 错误响应通常包含 code 非 0
                if (typeof json.code === 'number' && json.code !== 0) {
                    return null;
                }
                // 是有效的 JSON 文件内容，重建 Blob
                return new Blob([text], { type: blob.type });
            } catch (e) {
                // 解析失败，可能是普通文本，直接返回原始 blob
                return blob;
            }
        }

        return blob;
    } catch (e) {
        getLogger().error("getFileBlob error:", { error: e });
        return null;
    }
}


export async function putFile(path: string, isDir: boolean, file: any) {
    let form = new FormData();
    form.append('path', path);
    form.append('isDir', isDir.toString());
    form.append('file', file);

    // 使用 fetch 直接发送 FormData，避免 fetchSyncPost 可能的 JSON 处理问题
    try {
        const response = await fetch('/api/file/putFile', {
            method: 'POST',
            body: form
        });
        const res = await response.json();
        if (res.code === 0) {
            // 如果成功且 data 为 null，返回 true 以便调用者知道成功了
            return res.data ?? true;
        }
        return null;
    } catch (e) {
        getLogger().error("putFile error:", { error: e });
        return null;
    }
}

export async function removeFile(path: string) {
    let data = {
        path: path
    }
    let url = '/api/file/removeFile';
    return request(url, data);
}

export async function removeSkill(name: string) {
    let data = {
        name: name
    }
    let url = '/api/ai/agent/removeSkill';
    return request(url, data);
}


export async function readDir(path: string): Promise<IResReadDir> {
    let data = {
        path: path
    }
    let url = '/api/file/readDir';
    return request(url, data);
}


// **************************************** Export ****************************************

export async function exportMdContent(id: DocumentId, yfm: boolean = false, fillCSSVar: boolean = false, refMode: number = 2, embedMode: number = 0, adjustHeadingLevel: boolean = false): Promise<IResExportMdContent> {
    let data = {
        id: id,
        yfm: yfm,
        fillCSSVar: fillCSSVar, // true： 导出具体的css值，false：导出变量
        refMode: refMode, // 2：锚文本块链, 3：仅锚文本, 4：块引转脚注+锚点哈希
        embedMode: embedMode, //0：使用原始文本，1：使用 Blockquote
        adjustHeadingLevel: adjustHeadingLevel
    }
    let url = '/api/export/exportMdContent';
    return request(url, data);
}

export async function exportResources(paths: string[], name: string): Promise<IResExportResources> {
    let data = {
        paths: paths,
        name: name
    };
    let url = '/api/export/exportResources';
    return request(url, data);
}

// **************************************** Convert ****************************************

export type PandocArgs = string;
export async function pandoc(args: PandocArgs[]) {
    let data = {
        args: args
    }
    let url = '/api/convert/pandoc';
    return request(url, data);
}

// **************************************** Notification ****************************************

export async function pushMsg(msg: string, timeout: number = 7000) {
    let payload = {
        msg: msg,
        timeout: timeout
    };
    let url = "/api/notification/pushMsg";
    return request(url, payload);
}

export async function pushErrMsg(msg: string, timeout: number = 7000) {
    let payload = {
        msg: msg,
        timeout: timeout
    };
    let url = "/api/notification/pushErrMsg";
    return request(url, payload);
}

// **************************************** Network ****************************************

/**
 * 唯一底层转发实现：经 SiYuan 内核代理 `/api/network/forwardProxy` 转发外部请求。
 *
 * 统一要点：
 *  - 默认超时 120 秒（覆盖常规 AI 调用；长生成/流式另用调用方自行放大 timeout）。
 *  - headers 统一用 Record<string,string>，对外屏蔽「单键对象数组」的差异。
 *  - 返回结构统一为 { code, msg, status, headers, body }，便于各 transport 适配。
 *
 * REword 三处直调（ai-client / core-ai-client / online-phonetic）与 copilot 侧
 * 全部收敛到本函数，不再有 60s/7s/120s 三种默认超时并存的分叉。
 */
export interface ForwardProxyRawResult {
    /** SiYuan 内核 code（0 = 成功） */
    code: number;
    /** SiYuan 内核 msg */
    msg: string;
    /** HTTP 状态码（data.status） */
    status: number;
    /** 响应头 */
    headers: Record<string, string>;
    /** 响应体（字符串） */
    body: string;
}

export async function forwardProxyRaw(opts: {
    url: string;
    method?: string;
    timeout?: number;
    headers?: Record<string, string>;
    payload?: string;
    contentType?: string;
    responseEncoding?: "text" | "base64" | "base64-std" | "base64-url" | "base32" | "base32-std" | "base32-hex" | "hex";
}): Promise<ForwardProxyRawResult> {
    const headersArr = Object.entries(opts.headers || {}).map(([k, v]) => ({ [k]: v }));
    const reqBody: any = {
        url: opts.url,
        method: opts.method || "POST",
        timeout: opts.timeout ?? 120000,
        contentType: opts.contentType || "application/json",
        headers: headersArr,
        payload: opts.payload || "",
    };
    if (opts.responseEncoding) reqBody.responseEncoding = opts.responseEncoding;
    const resp: any = await fetchSyncPost("/api/network/forwardProxy", reqBody);
    const data = (resp && resp.data) || {};
    return {
        code: typeof resp?.code === "number" ? resp.code : 0,
        msg: typeof resp?.msg === "string" ? resp.msg : "",
        status: typeof data.status === "number" ? data.status : 200,
        headers: data.headers && typeof data.headers === "object" ? data.headers : {},
        body: typeof data.body === "string"
            ? data.body
            : data.body != null
                ? JSON.stringify(data.body)
                : "",
    };
}

// **************************************** AttributeView (Database) ****************************************

/**
 * 搜索数据库
 * @param keyword 搜索关键词
 * @param avID 可选的数据库ID，用于精确搜索
 */
export async function searchAttributeView(keyword: string, avID?: string): Promise<any> {
    let data: any = {
        keyword: keyword
    };
    if (avID) {
        data.avID = avID;
    }
    let url = '/api/av/searchAttributeView';
    return request(url, data);
}

/**
 * 获取数据库的列信息
 * @param avID 数据库ID
 */
export async function getAttributeViewKeysByAvID(avID: string): Promise<any> {
    let data = {
        avID: avID
    };
    let url = '/api/av/getAttributeViewKeysByAvID';
    return request(url, data);
}

/**
 * 渲染数据库视图内容
 * @param id 数据库ID
 * @param viewID 视图ID
 * @param pageSize 每页数量，默认9999999
 * @param page 页码，默认1
 * @param createIfNotExist 如果视图不存在是否创建
 */
export async function renderAttributeView(id: string, viewID: string, pageSize: number = 9999999, page: number = 1, createIfNotExist = false): Promise<any> {
    let data = {
        id: id,
        viewID: viewID,
        pageSize: pageSize,
        page: page,
        createIfNotExist: createIfNotExist

    };
    let url = '/api/av/renderAttributeView';
    return request(url, data);
}

/**
 * 添加数据库非绑定块和属性值
 * @param avID 数据库ID
 * @param blocksValues 二维数组，每个元素是一行的数据
 */
export async function appendAttributeViewDetachedBlocksWithValues(avID: string, blocksValues: any[][]): Promise<any> {
    let data = {
        avID: avID,
        blocksValues: blocksValues
    };
    let url = '/api/av/appendAttributeViewDetachedBlocksWithValues';
    return request(url, data);
}

/**
 * 添加数据库绑定块
 * @param avID 数据库ID
 * @param srcs 源块数组，包含id和isDetached字段
 */
export async function addAttributeViewBlocks(avID: string, srcs: Array<{ id: string, isDetached: boolean, itemID?: string }>): Promise<any> {
    let data = {
        avID: avID,
        srcs: srcs
    };
    let url = '/api/av/addAttributeViewBlocks';
    return request(url, data);
}

/**
 * 设置数据库块属性
 * @param avID 数据库ID
 * @param keyID 列ID
 * @param itemID 行ID/ItemID
 * @param value 属性值对象
 */
export async function setAttributeViewBlockAttr(avID: string, keyID: string, itemID: string, value: any): Promise<any> {
    let data = {
        avID: avID,
        keyID: keyID,
        itemID: itemID,
        value: value
    };
    let url = '/api/av/setAttributeViewBlockAttr';
    return request(url, data);
}

/**
 * 批量设置数据库块属性
 * @param avID 数据库ID
 * @param values 属性值数组
 */
export async function batchSetAttributeViewBlockAttrs(avID: string, values: Array<{ keyID: string, itemID: string, value: any }>): Promise<any> {
    let data = {
        avID: avID,
        values: values
    };
    let url = '/api/av/batchSetAttributeViewBlockAttrs';
    return request(url, data);
}

/**
 * 查询哪些数据库包含了指定块
 * @param id 块ID
 */
export async function getAttributeViewKeys(id: string): Promise<any> {
    let data = {
        id: id
    };
    let url = '/api/av/getAttributeViewKeys';
    return request(url, data);
}

/**
 * 根据ItemID获取绑定块ID
 * @param avID 数据库ID
 * @param itemIDs ItemID数组
 */
export async function getAttributeViewBoundBlockIDsByItemIDs(avID: string, itemIDs: string[]): Promise<any> {
    let data = {
        avID: avID,
        itemIDs: itemIDs
    };
    let url = '/api/av/getAttributeViewBoundBlockIDsByItemIDs';
    return request(url, data);
}

/**
 * 根据绑定块ID获取ItemID
 * @param avID 数据库ID
 * @param blockIDs 块ID数组
 */
export async function getAttributeViewItemIDsByBoundIDs(avID: string, blockIDs: string[]): Promise<any> {
    let data = {
        avID: avID,
        blockIDs: blockIDs
    };
    let url = '/api/av/getAttributeViewItemIDsByBoundIDs';
    return request(url, data);
}

/**
 * 添加数据库列
 * @param avID 数据库ID
 * @param keyName 列名称
 * @param keyType 列类型
 * @param previousKeyID 前一列ID，用于指定新列的位置（必需）
 * @param keyID 可选的列ID，如果不提供则自动生成
 * @param keyIcon 列图标，默认为空字符串
 */
export async function addAttributeViewKey(
    avID: string,
    keyName: string,
    keyType: string,
    previousKeyID: string,
    keyID?: string,
    keyIcon: string = ""
): Promise<any> {
    // 如果没有指定 keyID，自动生成一个
    const finalKeyID = keyID || window.Lute.NewNodeID();

    let data: any = {
        avID: avID,
        keyID: finalKeyID,
        keyName: keyName,
        keyType: keyType,
        keyIcon: keyIcon,
        previousKeyID: previousKeyID
    };

    let url = '/api/av/addAttributeViewKey';
    return request(url, data);
}

/**
 * 删除数据库列
 * @param avID 数据库ID
 * @param keyID 列ID
 */
export async function removeAttributeViewKey(avID: string, keyID: string): Promise<any> {
    let data = {
        avID: avID,
        keyID: keyID
    };
    let url = '/api/av/removeAttributeViewKey';
    return request(url, data);
}

/**
 * 删除数据库行
 * @param avID 数据库ID
 * @param srcIDs 要删除的行ID数组
 */
export async function removeAttributeViewBlocks(avID: string, srcIDs: string[]): Promise<any> {
    let data = {
        avID: avID,
        srcIDs: srcIDs
    };
    let url = '/api/av/removeAttributeViewBlocks';
    return request(url, data);
}

// **************************************** System ****************************************

export async function bootProgress(): Promise<IResBootProgress> {
    return request('/api/system/bootProgress', {});
}

export async function version(): Promise<string> {
    return request('/api/system/version', {});
}

export async function currentTime(): Promise<number> {
    return request('/api/system/currentTime', {});
}


export async function sendNotification(
    title: string,
    body: string,
    // 支持三种形式：
    // - 数字（秒）：延迟秒数
    // - Date 对象：具体的日期时间
    // - 字符串：ISO 8601 格式时间
    //   * 本地时间: "2026-03-12T11:50:00"（无时区后缀，表示本地时区）
    //   * UTC 时间: "2026-03-12T11:50:00Z"（带 Z 后缀，表示 UTC 时区）
    whenOrDelay: number | string | Date = 0,
    timeoutType: 'default' | 'never' = 'default'
) {
    let delayInSeconds = 0;

    if (typeof whenOrDelay === 'number') {
        delayInSeconds = Math.max(0, Math.floor(whenOrDelay));
    } else if (whenOrDelay instanceof Date) {
        const diffMs = whenOrDelay.getTime() - Date.now();
        delayInSeconds = Math.max(0, Math.ceil(diffMs / 1000));
    } else if (typeof whenOrDelay === 'string') {
        const t = Date.parse(whenOrDelay);
        getLogger().info(`sendNotification: parsing time string "${whenOrDelay}", parsed timestamp=${t}, Date.now()=${Date.now()}`);
        if (isNaN(t)) {
            getLogger().warn('sendNotification: invalid time string, sending immediately');
            delayInSeconds = 0;
        } else {
            const diffMs = t - Date.now();
            delayInSeconds = Math.max(0, Math.ceil(diffMs / 1000));
            getLogger().info(`sendNotification: diffMs=${diffMs}, delayInSeconds=${delayInSeconds}`);
            if (delayInSeconds === 0 && diffMs < 0) {
                getLogger().warn(`sendNotification: time "${whenOrDelay}" is in the past, sending immediately`);
            }
        }
    }
    getLogger().info(`sendNotification: title="${title}", body="${body}", delayInSeconds=${delayInSeconds}, timeoutType=${timeoutType}`);
    return platformUtils.sendNotification({
        channel: "Siyuan Copilot",
        title: title,
        body: body,
        delayInSeconds: delayInSeconds,
        timeoutType: timeoutType,
    });
}

/**
 * 取消指定 ID 的通知
 * @param id 通知 ID（由 sendNotification 返回）
 */
export function cancelNotification(id: number): void {
    return platformUtils.cancelNotification(id);
}

// **************************************** REword 专属扩展 ****************************************

/**
 * 取块 kramdown 源码（返回字符串，供 REword 词库/批注/上下文展开使用）。
 * 与 copilot-src 的 `getBlockKramdown`（返回对象）区分：此处直接返回正文串。
 */
export async function getBlockKramdownText(id: string, mode: string = 'textmark'): Promise<string> {
    const res: any = await fetchSyncPost('/api/block/getBlockKramdown', { id, mode });
    return res?.data?.kramdown ?? '';
}

/**
 * 列出所有文档（用于「添加文档」面板）
 * type='d' 表示文档根块；hpath 给出层级路径。
 */
export async function listDocuments(limit = 300): Promise<DocSummary[]> {
    const rows = await sql<{
        id: string;
        content: string;
        hpath: string;
        updated: string;
    }>(
        `SELECT id, content, hpath, updated FROM blocks WHERE type='d' ORDER BY updated DESC LIMIT ${limit}`
    );
    return rows.map((r) => ({
        id: r.id,
        name: (r.content || "(无标题)").trim() || "(无标题)",
        hpath: r.hpath || "",
        updated: r.updated ? new Date(r.updated.replace(" ", "T") + "Z").getTime() : undefined,
    }));
}

/**
 * 按关键词搜索文档（用于「搜索文档」面板）
 * 同时匹配文档标题(content)与路径(hpath)。
 */
export async function searchDocuments(keyword: string, limit = 50): Promise<DocSummary[]> {
    const kw = keyword.trim();
    if (!kw) return [];
    const esc = kw.replace(/'/g, "''");
    const rows = await sql<{
        id: string;
        content: string;
        hpath: string;
        updated: string;
    }>(
        `SELECT id, content, hpath, updated FROM blocks WHERE type='d' AND (content LIKE '%${esc}%' OR hpath LIKE '%${esc}%') ORDER BY updated DESC LIMIT ${limit}`
    );
    return rows.map((r) => ({
        id: r.id,
        name: (r.content || "(无标题)").trim() || "(无标题)",
        hpath: r.hpath || "",
        updated: r.updated ? new Date(r.updated.replace(" ", "T") + "Z").getTime() : undefined,
    }));
}

/**
 * 获取某个文档的完整正文（拼装该文档下所有块的文本）
 * 用于把文档加入「上下文」。返回 markdown 或纯文本拼接。
 */
export async function getDocumentContent(
    docId: string,
    asMarkdown = true
): Promise<string> {
    const rows = await sql<{ content: string; markdown: string }>(
        // 2026-08-21：改为 ORDER BY sort ASC, id ASC。
        //   - sort 字段是思源原生"块在文档树中的位置"，稳定反映视觉顺序
        //   - id ASC 兜底（思源 v3.x UUID 36 位字典序不再可靠，但与 sort 二级排序能稳定对齐）
        //   - 历史 custom-sort 子查询被 NULL 干扰,导致排序退化为不可控顺序
        `SELECT content, markdown FROM blocks WHERE root_id='${docId}' AND type NOT IN ('d') ORDER BY sort ASC, id ASC`
    );
    if (!rows.length) {
        // 兜底：直接获取根块
        const root = await sql<{ markdown: string; content: string }>(
            `SELECT markdown, content FROM blocks WHERE id='${docId}' LIMIT 1`
        );
        return root[0]?.[asMarkdown ? "markdown" : "content"] || "";
    }
    return rows.map((r) => (asMarkdown ? r.markdown || r.content : r.content)).join("\n\n");
}
