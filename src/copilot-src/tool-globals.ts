/**
 * 上游 Agent 工具（sql / get_block_content / remove_database_rows）依赖的运行时全局。
 * 上游在自身运行环境把这些函数注入到全局，REword 未包含该入口逻辑，此处补足，
 * 实现直接复用 copilot-src/api.ts 的思源 API 封装。
 *
 * 由 bridge.ts 以副作用方式导入（import "./tool-globals"），在 dock 挂载前注册。
 */
import { sql, getBlockKramdown, getBlockByID, request } from "./api.ts";

function ensureGlobal(name: string, fn: (...args: any[]) => any): void {
    (globalThis as any)[name] = fn;
}

ensureGlobal("siyuan_sql_query", async (query: string) => {
    return sql(query);
});

ensureGlobal("siyuan_get_block_content", async (id: string, format: string, command?: string) => {
    if (format === "kramdown") {
        return getBlockKramdown(id, command || "textmark");
    }
    return getBlockByID(id);
});

ensureGlobal("siyuan_remove_database_rows", async (avID: string, srcIDs: string[]) => {
    return request("/api/av/removeAttributeViewRows", { avID, srcIDs });
});
