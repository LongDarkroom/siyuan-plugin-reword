// 薄垫片：上游组件从 "./index" 仅取 WEBAPP_TAB_TYPE。
// 上游完整 index.ts 是插件入口（与 REword 冲突），此处只导出被引用的符号。
export const WEBAPP_TAB_TYPE = "copilot-webapp";
