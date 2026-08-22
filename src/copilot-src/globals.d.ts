// 上游 Agent 工具依赖的运行时全局（上游在自身运行环境注入，REword 此处补足）。
// 仅作类型声明；运行时实现见 ./tool-globals.ts（由 bridge 副作用导入）。
declare function siyuan_sql_query(query: string): Promise<any>;
declare function siyuan_get_block_content(id: string, format: string, command?: string): Promise<any>;
declare function siyuan_remove_database_rows(avID: string, srcIDs: string[]): Promise<any>;
