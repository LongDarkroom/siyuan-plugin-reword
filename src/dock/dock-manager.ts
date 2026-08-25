/**
 * 统一 Dock 管理器（Phase 1 + 2）
 *
 * 设计目标：把「词库 / 查词典 / 微阅批注 / AI 精读 / 复习」从「单一组合 Dock + Tab 互斥」
 * 升级为「每个功能可独立停靠到左 / 右 / 下栏」，从而支持同时查看多个面板
 * （例如左栏 AI 精读 + 右栏 微阅批注）。
 *
 * 落地策略（低风险平滑迁移）：
 *  - 默认所有功能停在「组合栏」(combined)，行为与旧版完全一致，不破坏任何既有引用；
 *  - 用户在「面板布局管理」里把某个功能设为 左/右/下栏 时，该功能在组合栏隐藏其 Tab，
 *    并额外注册一个独立 Dock，承载该功能；
 *  - 布局持久化到 hiword-dock-layout.json，插件重载后生效。
 *
 * 思源 Dock 图标的左右排序由思源自身管理（用户可拖拽），本管理器只决定「停哪一侧」。
 */

/** 停靠位置：组合栏 / 思源四角 + 下栏 / 隐藏 */
export type DockSlot =
  | "combined"
  | "LeftTop"
  | "LeftBottom"
  | "RightTop"
  | "RightBottom"
  | "Bottom"
  | "hidden";

/** 可停靠功能元信息 */
export interface DockableFeature {
  id: string;
  /** 显示名称（Dock 标题 / 管理器列表） */
  title: string;
  /** 内联 svg 字符串（addDock 直接接受 svg tag，可绕开图标 id 校验） */
  icon: string;
  /** 默认停靠位置（首次启动用） */
  defaultSlot: Exclude<DockSlot, "hidden">;
}

/** 布局配置：featureId -> slot */
export interface DockLayoutConfig {
  [featureId: string]: DockSlot;
}

const STORAGE_KEY = "hiword-dock-layout.json";

export const SLOT_LABELS: { value: DockSlot; label: string }[] = [
  { value: "combined", label: "组合栏（默认）" },
  { value: "LeftTop", label: "左侧 · 上" },
  { value: "LeftBottom", label: "左侧 · 下" },
  { value: "RightTop", label: "右侧 · 上" },
  { value: "RightBottom", label: "右侧 · 下" },
  { value: "Bottom", label: "底部栏" },
  { value: "hidden", label: "隐藏" },
];

export class DockManager {
  private features: DockableFeature[] = [];
  private config: DockLayoutConfig = {};

  constructor(private plugin: any) {}

  /** 注册一个可停靠功能（重复 id 忽略） */
  registerFeature(f: DockableFeature): void {
    if (!this.features.find((x) => x.id === f.id)) this.features.push(f);
  }

  getFeatures(): DockableFeature[] {
    return this.features;
  }

  /** 加载持久化布局，并与已注册功能合并出最终配置 */
  async load(): Promise<void> {
    let saved: DockLayoutConfig | null = null;
    try {
      saved = (await this.plugin.loadData(STORAGE_KEY)) as DockLayoutConfig | null;
    } catch {
      saved = null;
    }
    this.config = saved && typeof saved === "object" ? saved : {};
    // 未显式配置的功能回退到 defaultSlot
    for (const f of this.features) {
      if (!(f.id in this.config)) this.config[f.id] = f.defaultSlot;
    }
  }

  getSlot(id: string): DockSlot {
    return this.config[id] ?? "combined";
  }

  getConfig(): DockLayoutConfig {
    return { ...this.config };
  }

  /** 持久化单个功能的停靠位置 */
  async setSlot(id: string, slot: DockSlot): Promise<void> {
    this.config[id] = slot;
    try {
      await this.plugin.saveData(STORAGE_KEY, this.config);
    } catch (e) {
      // 持久化失败不阻断 UI（下次重载会重新加载）
      // eslint-disable-next-line no-console
      console.warn("[REword] Dock 布局持久化失败:", e);
    }
  }

  /** 停靠在独立 Dock 的功能（排除 combined 与 hidden） */
  getStandaloneFeatures(): { feature: DockableFeature; slot: DockSlot }[] {
    return this.features
      .filter((f) => {
        const s = this.config[f.id];
        return s && s !== "combined" && s !== "hidden";
      })
      .map((f) => ({ feature: f, slot: this.config[f.id] }));
  }

  /** 留在组合 Dock 的功能 id 列表 */
  getCombinedFeatureIds(): string[] {
    return this.features
      .filter((f) => this.config[f.id] === "combined" || this.config[f.id] === undefined)
      .map((f) => f.id);
  }

  /** 是否至少有一个功能被隐藏（用于 UI 提示） */
  hasHidden(): boolean {
    return this.features.some((f) => this.config[f.id] === "hidden");
  }
}
