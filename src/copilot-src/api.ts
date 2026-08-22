/**
 * See API Document in [API.md](https://github.com/siyuan-note/siyuan/blob/master/API.md)
 * API 文档见 [API_zh_CN.md](https://github.com/siyuan-note/siyuan/blob/master/API_zh_CN.md)
 *
 * ------------------------------------------------------------------
 * 统一收口说明（2026-08-16）：
 * 全量 SiYuan API 封装已迁移至 `src/siyuan/api.ts`（唯一枢纽）。本文件仅作为
 * copilot-src 的兼容层：
 *   - 其余公共函数一律 re-export 枢纽，避免重复实现与行为分叉；
 *   - 仅保留 2 个「签名/返回形态与枢纽不同」的专属函数：
 *       · forwardProxy（位置参数式，兼容 copilot-src 内部历史调用）
 *       · forwardProxyFetch（返回 fetch-like 对象，ai-chat 等强依赖）
 *   这 2 个函数内部统一委托枢纽的 `forwardProxyRaw`，不再各自实现。
 */

import { forwardProxyRaw } from "../siyuan/api.ts";

export * from "../siyuan/api.ts";

// **************************************** Network（copilot-src 专属形态） ****************************************

/**
 * 位置参数式转发（兼容 copilot-src 内部历史调用）。
 * 底层统一走枢纽 `forwardProxyRaw`。
 */
export async function forwardProxy(
    url: string, method: string = 'GET', payload: any = {},
    headers: any[] = [], timeout: number = 7000, contentType: string = "text/html"
): Promise<IResForwardProxy> {
    const headersRecord: Record<string, string> = {};
    for (const h of headers) {
        const entries = Object.entries(h)[0];
        if (entries) headersRecord[entries[0]] = String(entries[1]);
    }
    const r = await forwardProxyRaw({
        url,
        method,
        timeout,
        contentType,
        headers: headersRecord,
        payload: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
    // 保持旧返回形态：{ code, msg, data: { status, headers, body } }
    return { code: r.code, msg: r.msg, data: { status: r.status, headers: r.headers, body: r.body } } as any;
}

/**
 * 将 forwardProxy 包装为类 fetch 接口，用于替代浏览器原生 fetch 绕过 CORS
 *
 * 限制：
 * - 不支持 streaming（因 body 为完整字符串）
 * - 不支持 AbortSignal
 * - 默认超时 3600000ms（1 小时，覆盖大模型长生成 / 流式缓冲）
 */
export async function forwardProxyFetch(
    url: string,
    init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        timeout?: number;
    }
): Promise<{
    ok: boolean;
    status: number;
    headers: Headers;
    json: () => Promise<any>;
    text: () => Promise<string>;
}> {
    const method = init?.method || 'GET';
    const headersArray = Object.entries(init?.headers || {}).map(([name, value]) => ({
        [name]: value
    }));
    const result = await forwardProxy(
        url,
        method,
        init?.body || '',
        headersArray,
        init?.timeout !== undefined && init.timeout > 0 ? init.timeout : 3600000,
        'application/json'
    );
    const responseHeaders = new Headers();
    Object.entries((result as any).data?.headers || result.headers || {}).forEach(([key, value]) => {
        responseHeaders.set(key, String(value));
    });
    const status = (result as any).data?.status ?? (result as any).status ?? 200;
    const body = (result as any).data?.body ?? (result as any).body ?? "";
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: responseHeaders,
        json: async () => JSON.parse(body),
        text: async () => body,
    };
}
