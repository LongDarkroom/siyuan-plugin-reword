/**
 * REword · 思源集成层（SiYuan Integration Layer）
 * ------------------------------------------------------------------
 * 统一封装思源笔记核心 API，供 REword 各功能模块复用：
 *  - types     思源数据结构定义
 *  - client    统一请求封装（fetchSyncPost）
 *  - block     块读写 + 大纲同步
 *  - attrs     属性（custom-）读写 + SQL 查询
 *  - filetree  文档树 / 笔记本管理
 *
 * 使用：import { getBlockKramdown, sqlQuery, lsNotebooks } from "./siyuan";
 */
export * from "./types.ts";
export * from "./client.ts";
export * from "./block.ts";
export * from "./attrs.ts";
export * from "./filetree.ts";
