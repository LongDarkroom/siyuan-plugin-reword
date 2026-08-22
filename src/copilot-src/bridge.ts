/**
 * Copilot 上游（Svelte）侧栏桥接到 REword。
 *
 * 上游 ai-sidebar.svelte 是一个 21k 行的单体组件，要求宿主 plugin 提供
 * SiYuan Plugin 基类 API（saveData/loadData/app/name）+ 部分上游特有方法
 * （saveSettings/loadSettings/registerWebAppIcon/...）。这里用一个轻量适配器把
 * REword 的插件实例包成上游期望的形状，并把上游设置落到 REword 数据目录的
 * "settings.json"（与 REword 自身设置互不干扰）。
 */
import AISidebar from "./ai-sidebar.svelte";
import { updateSettings } from "./stores/settings.ts";
import { getDefaultSettings } from "./defaultSettings.ts";
// 副作用导入：补足上游 Agent 工具依赖的运行时全局（siyuan_sql_query 等）
import "./tool-globals";

const AI_SIDEBAR_TYPE = "ai-chat-sidebar";
const SETTINGS_FILE = "settings.json";

/** 把 REword 插件实例适配为上游 sidebar 期望的 plugin 形状 */
function makeCopilotPlugin(host: any): any {
  const adapter: any = {
    name: host.name,
    app: host.app,
    // —— 标准 Plugin API ——
    saveData: (k: string, v: any) => host.saveData(k, v),
    loadData: (k: string) => host.loadData(k),
    addCommand: (c: any) => host.addCommand?.(c),
    addDock: (c: any) => host.addDock?.(c),
    addTab: (c: any) => host.addTab?.(c),
    openSetting: () => host.openSetting?.(),
    // —— 上游特有：设置读写（走 REword 数据目录的 settings.json）——
    async loadSettings(): Promise<any> {
      const stored = (await host.loadData(SETTINGS_FILE)) || {};
      const merged = { ...getDefaultSettings(), ...stored };
      updateSettings(merged);
      return merged;
    },
    async saveSettings(s: any): Promise<void> {
      await host.saveData(SETTINGS_FILE, s);
      updateSettings(s);
    },
    // —— 上游特有：WebApp 相关（REword 暂未实现，置空实现避免崩溃）——
    syncWebAppDocks() {},
    syncWebAppCollectionDock() {},
    registerWebAppIcon() {},
    getWebAppIconId() {
      return "copilot-webapp-icon";
    },
    openAIWindow() {},
    openAITab() {},
  };
  return adapter;
}

/** 把上游 AISidebar 挂载到指定宿主元素（dock 由 REword 自身注册）。 */
export function initCopilotSidebar(host: any, element: HTMLElement): void {
  const cpPlugin = makeCopilotPlugin(host);
  // 初始化设置 store（同步上游默认 + 已存）
  cpPlugin.loadSettings().catch((e: any) => {
    console.error("[copilot-src] loadSettings failed:", e);
  });
  new AISidebar({
    target: element,
    props: {
      plugin: cpPlugin,
    },
  });
}
