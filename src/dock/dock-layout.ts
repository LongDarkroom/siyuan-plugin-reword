/**
 * REword · Dock 布局运行时（P1-5 自 index.ts 机械拆出，零行为变更）
 * ------------------------------------------------------------------
 * 组合栏外壳 / 独立 dock 注册与迁移 / 布局管理面板 / 图标缓存兜底 / 顺序恢复。
 * 类方法搬成「函数收 plugin 参数」的独立模块；index.ts 保留同名薄委托方法，
 * SiYuan 生命周期 onLayoutReady 亦经委托调用。renderFeatureInto（面板渲染路由）
 * 仍留在插件类内，经 p.renderFeatureInto(...) 回调。
 * 依赖注入：`import type RewordPlugin` 仅类型引用（构建时擦除），无运行时循环依赖；
 * 被访问的 plugin 字段/方法在 index.ts 侧标注 @internal（TS public）。
 */
import type RewordPlugin from "../index.ts";
import { Dialog, showMessage } from "siyuan";
import { getLogger } from "../core/logger.ts";
import { logSwallow } from "../core/safe.ts";
import { isSmallMobile, isLargeMobile } from "../core/env.ts";
import { responsiveDialogSize } from "../core/responsive.ts";
import { destroyAllPreviews } from "../annotation/ann-preview.ts";
import { clearLaunchMarker } from "../reader/reader-tab.ts";
import { READER_FEATURE_ID } from "../reader/reader-dock.ts";
import { SLOT_LABELS, type DockableFeature, type DockSlot } from "./dock-manager.ts";

export function initDockPanels(p: RewordPlugin) {
    // 2026-08-29 移动端适配 Phase 5：dock 初始宽度按屏幕尺寸折算
    // - 桌面 320（沿用旧默认）
    // - 平板（iPad/Android Tablet）360（更宽一点方便触屏点击）
    // - 手机（iPhone/Android Phone）取视口宽度的 92%
    const dockWidth = isSmallMobile()
      ? Math.round((typeof window !== "undefined" ? window.innerWidth : 320) * 0.92)
      : isLargeMobile() ? 360 : 320;
    // ===== 组合 Dock（始终注册，承载 combined 功能的 Tab；保证 p.dockElement 有效）=====
    try {
      const combinedIds = p.dockManager.getCombinedFeatureIds();
      const dockResult: any = p.addDock({
        config: {
          position: "RightBottom" as const,
          size: { width: dockWidth, height: 0 },
          icon: "iconREword" /* index.ts ICON_REWORD */,
          title: "RE word",
        },
        data: {},
        type: "hiword-sidebar",
        init: (dock?: any) => {
          p.dockElement = dock.element;
          renderCombinedDockShell(p, dock.element, combinedIds);
        },
        update: () => { p.refreshActivePanel(); },
        destroy: () => { destroyAllPreviews(); p.dockElement = null; },
      });
      p.dockModel = (dockResult as any)?.model;
    } catch (e) {
      getLogger().error("[REword] 组合 Dock 注册失败:", { operation: "初始化-侧边栏", error: e });
    }

    // ===== 独立 Dock（仅注册非 combined/非 hidden 的功能；按 slot 停靠到对应侧栏）=====
    for (const { feature, slot } of p.dockManager.getStandaloneFeatures()) {
      try {
        registerStandaloneDock(p, feature, slot, dockWidth);
      } catch (e) {
        getLogger().error(`[REword] 独立 Dock 注册失败 (${feature.id}):`, { operation: "初始化-侧边栏", error: e });
      }
    }
    // 兜底修正已渲染的独立/组合 dock 图标（缓存乱码双保险）
    requestAnimationFrame(() => fixStandaloneDockIcons(p));
  }

  /** 注册一个功能的独立 Dock（幂等：已注册则跳过）。用于初始化与「拖出到角落」运行时扩展 */
export function registerStandaloneDock(p: RewordPlugin, f: DockableFeature, slot: DockSlot, dockWidth = 320): void {
    if (p.standaloneElements.has(f.id)) return;
    if (slot === "combined" || slot === "hidden") return;
    const dockResult: any = p.addDock({
      config: {
        position: slot as any,
        // 独立 dock 沿用组合 dock 同样的响应式宽度（避免侧栏左右宽度不一致）
        size: { width: dockWidth, height: 0 },
        icon: f.icon,
        title: f.title,
        show: true,
      },
      data: {},
      type: "hiword-standalone-" + f.id,
      init: (dock?: any) => {
        p.standaloneElements.set(f.id, dock.element);
        dock.element.innerHTML = `<div class="hiword-dock-panel"><div class="hiword-dock-content" id="hiword-dock-content"></div></div>`;
        exposeDockContentDelegation(p, dock.element);
        p.renderFeatureInto(f.id, dock.element);
        p.applyFontSize();
      },
      update: () => {
        const el = p.standaloneElements.get(f.id);
        if (el) p.renderFeatureInto(f.id, el);
      },
      destroy: () => { destroyAllPreviews(); p.standaloneElements.delete(f.id); p.standaloneModels.delete(f.id); },
    });
    p.standaloneModels.set(f.id, (dockResult as any)?.model);
  }

  /** 渲染组合栏外壳（Tab 栏 + 内容区 + 头部按钮），combined 功能作为 Tab 呈现 */
export function renderCombinedDockShell(p: RewordPlugin, dockElement: HTMLElement, combinedIds: string[]) {
    const tabsHtml = combinedIds.length
      ? combinedIds.map((id, i) => `<button class="hiword-dock-tab${i === 0 ? " active" : ""}" data-tab="${id}">${featureTitle(p, id)}</button>`).join("")
      : `<div class="hiword-dock-empty">所有功能已移至独立侧边栏</div>`;
    dockElement.innerHTML = `
      <div class="hiword-dock-panel">
        <div class="hiword-dock-header">
          <div class="hiword-dock-tabs">${tabsHtml}</div>
          <div class="hiword-dock-header-actions">
            <button class="hiword-dock-settings-btn" id="hiword-settings-btn" title="全局设置">⚙️</button>
            <button class="hiword-dock-settings-btn" id="hiword-dock-layout-btn" title="面板布局管理（可拖拽功能到角落 / 组合栏）">📐</button>
            <button class="hiword-dock-settings-btn" id="hiword-reload-btn" data-action="reload-plugin" title="重载插件">🔄</button>
          </div>
        </div>
        <div class="hiword-dock-content" id="hiword-dock-content"></div>
      </div>`;

    dockElement.querySelector(".hiword-dock-tabs")?.addEventListener("click", (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("hiword-dock-tab")) {
        destroyAllPreviews();
        dockElement.querySelectorAll(".hiword-dock-tab").forEach((t: Element) => t.classList.remove("active"));
        target.classList.add("active");
        p.renderFeatureInto(target.dataset.tab!, dockElement);
      }
    });

    dockElement.querySelector("#hiword-settings-btn")?.addEventListener("click", () => p.openUnifiedSettings());
    dockElement.querySelector("#hiword-dock-layout-btn")?.addEventListener("click", () => openDockManagerPanel(p));

    if (combinedIds.length > 0) p.renderFeatureInto(combinedIds[0], dockElement);
    exposeDockContentDelegation(p, dockElement);
    p.applyFontSize();
  }

  /** 重新渲染组合栏 Tab（功能在组合栏 / 独立栏之间移动后调用） */
export function refreshCombinedDock(p: RewordPlugin): void {
    if (!p.dockElement) return;
    const combinedIds = p.dockManager.getCombinedFeatureIds();
    const activeTab = p.dockElement.querySelector(".hiword-dock-tab.active") as HTMLElement | null;
    const activeId = activeTab?.dataset.tab ?? undefined;
    renderCombinedDockShell(p, p.dockElement, combinedIds);
    // 恢复此前激活的 Tab（若该功能仍在组合栏内），避免拖动功能时组合栏内容乱跳
    if (activeId && combinedIds.includes(activeId)) {
      const dockEl = p.dockElement;
      const tab = dockEl.querySelector(`.hiword-dock-tab[data-tab="${activeId}"]`) as HTMLElement | null;
      if (tab) {
        dockEl.querySelectorAll(".hiword-dock-tab").forEach((t: Element) => t.classList.remove("active"));
        tab.classList.add("active");
        p.renderFeatureInto(activeId, dockEl);
      }
    }
  }

  /** 给某个 Dock 根元素绑定 #hiword-dock-content 的点击委托（词库/批注等交互） */
export function exposeDockContentDelegation(p: RewordPlugin, dockElement: HTMLElement) {
    dockElement.querySelector("#hiword-dock-content")?.addEventListener("click", (e: Event) => {
      p.handleDockClick(e, dockElement);
    });
  }

  /** 取功能显示名 */
export function featureTitle(p: RewordPlugin, id: string): string {
    return p.dockManager.getFeatures().find((f) => f.id === id)?.title ?? id;
  }


  /**
   * 修正【本插件】在「local-plugin-docks」中的缓存，保留用户自定义的图标顺序/位置，
   * 只覆盖可能过期的 icon / title 字段，避免旧版本残留 id 导致侧边栏图标乱码。
   *
   * 为什么不能清空：
   * local-plugin-docks 同时保存了思源侧栏的图标顺序（index）与停靠位置（position）。
   * 之前「每次清空」会导致用户拖拽的图标顺序在重启后丢失，全部回到默认位置。
   * 改为只修正 icon/title，即可在消除乱码的同时保留用户布局。
   */
export async function clearStaleDockCache(p: RewordPlugin): Promise<void> {
    try {
      const root = (window as any).siyuan?.storage?.["local-plugin-docks"];
      if (!root || typeof root !== "object" || !root[p.name] || typeof root[p.name] !== "object") return;
      const pluginDocks = root[p.name];
      for (const type of Object.keys(pluginDocks)) {
        const cfg = pluginDocks[type];
        if (!cfg || typeof cfg !== "object") continue;
        if (type === "hiword-sidebar") {
          cfg.icon = "iconREword" /* index.ts ICON_REWORD */;
          cfg.title = "RE word";
        } else if (type.startsWith("hiword-standalone-")) {
          const fid = type.slice("hiword-standalone-".length);
          const f = p.dockManager.getFeatures().find((x) => x.id === fid);
          if (f) {
            cfg.icon = f.icon;
            cfg.title = f.title;
          }
        }
      }
      getLogger().info("[REword] 已修正本插件 Dock 缓存图标（local-plugin-docks），保留布局顺序");
    } catch (e) {
      getLogger().warn("[REword] 修正 Dock 缓存失败", { error: e });
    }
  }

  /** 修正已渲染 dock 图标的兜底：强制把 <use> 指向本功能正确的 symbol id，
   *  并把正确 icon/title 写回 local-plugin-docks，防止下次启动时思源用旧缓存覆盖。
   *  与 clearStaleDockCache 双保险，覆盖「插件热重载不重跑 In」的场景。 */
export function fixStandaloneDockIcons(p: RewordPlugin): void {
    const root = (window as any).siyuan?.storage?.["local-plugin-docks"];
    const pluginDocks = root?.[p.name];
    const apply = (type: string, iconId: string, title?: string) => {
      // 1. 修正当前 DOM
      const use = document.querySelector(`.dock__item[data-type="${type}"] svg use`) as SVGUseElement | null;
      if (use) {
        const href = "#" + iconId;
        use.setAttribute("xlink:href", href);
        use.setAttribute("href", href);
      }
      // 2. 同步写回缓存，避免下次 In 时旧缓存覆盖
      const shortType = type.slice(p.name.length);
      const cfg = pluginDocks?.[shortType];
      if (cfg && typeof cfg === "object") {
        cfg.icon = iconId;
        if (title) cfg.title = title;
      }
    };
    const prefix = p.name;
    for (const { feature } of p.dockManager.getStandaloneFeatures()) {
      apply(prefix + "hiword-standalone-" + feature.id, feature.icon, feature.title);
    }
    apply(prefix + "hiword-sidebar", "iconREword" /* index.ts ICON_REWORD */, "RE word");
  }

  /**
   * 布局就绪后，按 local-plugin-docks 缓存把本插件 Dock 图标恢复到上次保存的分组位置。
   * 思源的 In 渲染通常已自动恢复，但这里做兜底：若某图标未落到缓存记录的位置/分组，
   * 显式调用 Dock.add() 把它放回去，确保重启后用户自定义顺序不丢失。
   */
export function restoreDockOrderFromCache(p: RewordPlugin): void {
    try {
      const pluginDocks = (window as any).siyuan?.storage?.["local-plugin-docks"]?.[p.name];
      if (!pluginDocks || typeof pluginDocks !== "object") return;
      const prefix = p.name;
      for (const type of Object.keys(pluginDocks)) {
        const cfg = pluginDocks[type];
        if (!cfg || typeof cfg !== "object") continue;
        if (type !== "hiword-sidebar" && !type.startsWith("hiword-standalone-")) continue;
        const fullType = prefix + type;
        const item = document.querySelector(`.dock__item[data-type="${fullType}"]`) as HTMLElement | null;
        if (!item) continue;
        const slot = positionToSlot(p, cfg.position);
        if (!slot) continue;
        const { dock, index } = resolveTargetDock(p, slot);
        if (!dock) continue;
        // 若已在目标 dock 的对应分组内，跳过
        const currentDockEl = item.closest(".dock") as HTMLElement | null;
        const targetDockEl = dock.element as HTMLElement | null;
        if (currentDockEl && targetDockEl && currentDockEl === targetDockEl) {
          const group = item.parentElement;
          const groupIndex = group ? Array.from(group.children).indexOf(item) : -1;
          if (groupIndex === index) continue;
        }
        try {
          dock.add(index, item);
        } catch (e) {
          getLogger().warn(`[REword] 恢复 Dock 顺序失败 (${type})`, { error: e });
        }
      }
    } catch (e) {
      getLogger().warn("[REword] 恢复 Dock 顺序失败", { error: e });
    }
  }

  /**
   * 一次性面板布局迁移（v2）：将布局重置为「全部收入组合栏」的干净状态。
   * 解决此前「所有功能独立图标都跑出来、侧边栏杂乱」的问题——组合栏是功能的默认归宿，
   * 只有用户主动拖出到角落时才生成独立 Dock。旧布局（hiword-dock-layout.json）可能残留
   * standalone 配置导致杂乱，重置一次即可让新的默认值（全部 combined）生效。
   */
export async function migrateDockLayoutOnce(p: RewordPlugin): Promise<void> {
    const marker = "hiword-dock-layout-migrated-v2";
    let done = false;
    try { done = !!(await p.loadData(marker)); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · migrateDockLayoutOnce", "debug"); }
    if (done) return;
    try {
      await p.saveData("hiword-dock-layout.json", {});
      getLogger().info("[REword] 已重置面板布局为组合栏默认（全部功能收入组合栏）");
    } catch (e) {
      getLogger().warn("[REword] 面板布局迁移失败", { error: e });
    }
    try { await p.saveData(marker, true); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · migrateDockLayoutOnce", "error"); }
  }

  /** 根据 data-type 找到承载该 dock 的思源 Dock 实例（left/right/bottom） */
export function findDockByType(p: RewordPlugin, type: string): any {
    const layout = (window as any).siyuan?.layout;
    if (!layout) return null;
    for (const d of [layout.leftDock, layout.rightDock, layout.bottomDock]) {
      if (d && d.data && d.data[type]) return d;
    }
    return null;
  }

  /** 仅控制独立 dock 栏图标的显隐（不触碰面板内容，避免误开/误关） */
export function setStandaloneDockVisible(p: RewordPlugin, id: string, visible: boolean): void {
    const type = p.name + "hiword-standalone-" + id;
    const item = document.querySelector(`.dock__item[data-type="${type}"]`) as HTMLElement | null;
    if (!item) return;
    if (visible) {
      item.classList.remove("fn__none");
      item.style.display = "";
    } else {
      item.classList.add("fn__none");
      item.style.display = "none";
    }
  }

  /** 强制关闭某功能的独立 dock 面板 */
export function closeStandaloneDockPanel(p: RewordPlugin, id: string): void {
    const type = p.name + "hiword-standalone-" + id;
    const dock = findDockByType(p, type);
    if (!dock) return;
    try {
      // 思源 toggleModel(ge, xe, Ze, at, ot)：关闭逻辑位于 `if (pt.active || at)` 内，
      // 仅传 (type,false,true) 时 at=false，面板未处于 active 则整段跳过 → 关不掉（死面板）。
      // 第 4 参 at=true 强制进入关闭分支，无论面板当前是否 active。
      dock.toggleModel?.(type, false, true, true);
    } catch (e) {
      getLogger().warn(`[REword] 关闭独立 Dock 面板失败 (${id})`, { error: e });
    }
  }

  /** 解析 slot 对应的思源 Dock 实例与分栏 index（0=上/左分组，1=下/右分组） */
export function resolveTargetDock(p: RewordPlugin, slot: DockSlot): { dock: any; index: number } {
    const layout = (window as any).siyuan?.layout;
    switch (slot) {
      case "LeftTop": return { dock: layout.leftDock, index: 0 };
      case "LeftBottom": return { dock: layout.leftDock, index: 1 };
      case "RightTop": return { dock: layout.rightDock, index: 0 };
      case "RightBottom": return { dock: layout.rightDock, index: 1 };
      // 底部栏「底部」落区：与 registerStandaloneDock 用 position:"Bottom"（经思源 genButton 得 index 0）保持一致，
      // 统一落在底部左侧，避免「首次拖放=左下、再次拖放=右下」的左右跳变。
      case "Bottom": return { dock: layout.bottomDock, index: 0 };
      default: return { dock: layout.rightDock, index: 1 };
    }
  }

  /** 把思源缓存里的 position 字符串映射回本插件的 DockSlot */
export function positionToSlot(p: RewordPlugin, position: string): DockSlot | null {
    switch (position) {
      case "LeftTop":
      case "LeftBottom":
      case "RightTop":
      case "RightBottom":
      case "Bottom":
        return position;
      case "Left":
        return "LeftTop";
      case "Right":
        return "RightBottom";
      default:
        return null;
    }
  }

  /**
   * 运行时即时移动某功能 dock 到目标位置（无需重载思源）。
   * - combined / hidden：隐藏独立 dock（若存在），并刷新组合栏 Tab 将其收纳为组合栏入口；
   * - Left/Right/Bottom：确保独立 dock 已注册（combined → 角落时按需创建），再用思源原生
   *   Dock.add() 跨栏迁移图标与面板（自动持久化）。
   * 返回 "moved" 表示即时生效；"reload-needed" 表示无法运行时完成。
   */
export function moveFeatureToSlot(p: RewordPlugin, id: string, slot: DockSlot): "moved" | "reload-needed" {
    const f = p.dockManager.getFeatures().find((x) => x.id === id);
    if (!f) return "reload-needed";
    if (slot === "combined" || slot === "hidden") {
      // 收入组合栏 / 隐藏：先关闭可能仍打开的独立面板，再隐藏图标，最后把功能作为 Tab 收纳进组合栏
      closeStandaloneDockPanel(p, id);
      setStandaloneDockVisible(p, id, false);
      refreshCombinedDock(p);
      return "moved";
    }
    // 独立停靠：确保独立 Dock 已注册（combined → 角落时按需创建），再跨栏迁移
    const alreadyRegistered = p.standaloneElements.has(id);
    try {
      registerStandaloneDock(p, f, slot);
    } catch (e) {
      getLogger().warn(`[REword] 注册独立 Dock 失败 (${id} -> ${slot})`, { error: e });
      return "reload-needed";
    }
    setStandaloneDockVisible(p, id, true);
    // 移动后立即兜底修正图标（覆盖思源 local-plugin-docks 缓存污染的 icon）
    requestAnimationFrame(() => fixStandaloneDockIcons(p));
    if (alreadyRegistered) {
      const type = p.name + "hiword-standalone-" + id;
      const item = document.querySelector(`.dock__item[data-type="${type}"]`) as HTMLElement | null;
      const { dock: targetDock, index } = resolveTargetDock(p, slot);
      if (item && targetDock) {
        try {
          targetDock.add(index, item);
        } catch (e) {
          getLogger().warn(`[REword] 移动 Dock 失败 (${id} -> ${slot})`, { error: e });
        }
      }
    }
    // 若原在组合栏，刷新移除其 Tab
    refreshCombinedDock(p);
    return "moved";
  }

  /** 布局完全就绪后，隐藏「组合栏/隐藏」功能的独立 dock 图标（避免与组合栏总览重复显示） */
export function onLayoutReady(p: RewordPlugin) {
    try {
      for (const f of p.dockManager.getFeatures()) {
        const slot = p.dockManager.getSlot(f.id);
        if (slot === "combined" || slot === "hidden") {
          // 关闭残留的独立面板（避免「有面板没图标」的死面板），再隐藏图标
          closeStandaloneDockPanel(p, f.id);
          setStandaloneDockVisible(p, f.id, false);
        }
      }
      // 布局就绪后再兜底修正一次独立 Dock 图标（缓存污染兜底），并恢复用户自定义顺序
      requestAnimationFrame(() => {
        fixStandaloneDockIcons(p);
        restoreDockOrderFromCache(p);
      });
      // 重启思源后自动恢复上次打开的阅读 Tab（思源不会自动恢复自定义插件 Tab）
      // 由 restoreSession 内部等空闲窗口后再恢复；上次启动卡死时直接跳过（自愈）
      try {
        void p.readerDock?.tabController?.restoreSession?.({ crashed: p.lastLaunchCrashed });
      } catch (__e) { logSwallow(__e, "index.ts · restoreReaderTabs", "debug"); }
    } catch (e) {
      getLogger().warn("[REword] onLayoutReady 隐藏组合栏独立 Dock 失败", { error: e });
      // 2026-09-05：布局阶段若抛错，restoreSession 不会被调用 → 启动标记残留，
      // 下次启动会误判「上次卡死」而跳过阅读 Tab 恢复。这里补清一次。
      clearLaunchMarker();
    }
  }

  /** 聚焦某功能的承载 Dock（组合栏切 Tab / 独立 Dock 调 showDock） */
export function focusFeatureDock(p: RewordPlugin, id: string) {
    const slot = p.dockManager.getSlot(id);
    if (slot !== "combined" && slot !== "hidden") {
      p.standaloneModels.get(id)?.showDock?.();
    } else {
      p.dockModel?.showDock?.();
      const tab = p.dockElement?.querySelector(`.hiword-dock-tab[data-tab="${id}"]`) as HTMLElement | null;
      tab?.click();
    }
  }

  /** 取某功能当前承载它的 Dock 根元素（独立 Dock 优先，否则组合栏） */
export function getFeatureElement(p: RewordPlugin, id: string): HTMLElement | null {
    const slot = p.dockManager.getSlot(id);
    if (slot !== "combined" && slot !== "hidden") {
      return p.standaloneElements.get(id) ?? p.dockElement;
    }
    return p.dockElement;
  }

  /** 刷新某功能（在其承载 Dock 中重绘；组合栏仅在对应 Tab 激活时才重绘，避免覆盖其它 Tab） */
export function refreshFeature(p: RewordPlugin, id: string) {
    const slot = p.dockManager.getSlot(id);
    if (slot !== "combined" && slot !== "hidden") {
      const el = p.standaloneElements.get(id);
      if (el) p.renderFeatureInto(id, el);
      return;
    }
    if (p.dockElement) {
      const activeTab = p.dockElement.querySelector(".hiword-dock-tab.active") as HTMLElement | null;
      if (!activeTab || activeTab.dataset.tab === id) {
        p.renderFeatureInto(id, p.dockElement);
      }
    }
  }

  /**
   * 面板布局管理（Phase 2 + Phase 3）：
   *  - 每个功能用下拉框选择停靠位置，改动即时生效（无需重载）；
   *  - 也可直接拖动功能行到屏幕对应角落（主侧边栏 / 左上 / 左下 / 右上 / 右下 / 底部）即时停靠。
   */
export function openDockManagerPanel(p: RewordPlugin) {
    const features = p.dockManager.getFeatures();
    const rows = features.map((f) => {
      const cur = p.dockManager.getSlot(f.id);
      const opts = SLOT_LABELS
        .map((s) => `<option value="${s.value}"${s.value === cur ? " selected" : ""}>${s.label}</option>`)
        .join("");
      return `<div class="hiword-dm-row" draggable="true" data-feature="${f.id}">
        <span class="hiword-dm-drag" title="拖动到屏幕角落以停靠">⠿</span>
        <span class="hiword-dm-name"><span class="hiword-dm-icon" data-feature="${f.id}"></span>${f.title}</span>
        <select class="hiword-dm-select b3-select" data-feature="${f.id}">${opts}</select>
      </div>`;
    }).join("");
    const dialog = new Dialog({
      title: "面板布局管理",
      content: `<div class="hiword-dm">
        <div class="hiword-dm-tip">选择停靠位置<strong>即时生效</strong>，无需重载；也可直接<strong>拖动功能行到屏幕对应角落</strong>（主侧边栏 / 左上 / 左下 / 右上 / 右下 / 底部）。同侧多个面板在思源中为堆叠互斥，需同时查看请分到不同侧。</div>
        ${rows}
        <div class="hiword-dm-actions">
          <button class="b3-button b3-button--outline hiword-dm-close" id="hiword-dm-close">关闭</button>
        </div>
      </div>`,
      width: responsiveDialogSize(460, "width"),
    });
    const content = dialog.element.querySelector(".hiword-dm") as HTMLElement;

    // 为每个功能名渲染对应图标（管理器内也能区分）
    content?.querySelectorAll<HTMLElement>(".hiword-dm-icon").forEach((ico) => {
      const fid = ico.dataset.feature!;
      const f = features.find((x) => x.id === fid);
      if (f) ico.innerHTML = `<svg class="hiword-dm-inline-icon"><use xlink:href="#${f.icon}"></use></svg>`;
    });

    // 下拉框：即时移动
    content?.querySelectorAll(".hiword-dm-select").forEach((sel) => {
      sel.addEventListener("change", async (e: Event) => {
        const target = e.target as HTMLSelectElement;
        const fid = target.dataset.feature!;
        const slot = target.value as DockSlot;
        await p.dockManager.setSlot(fid, slot);
        const res = moveFeatureToSlot(p, fid, slot);
        showMessage(res === "moved" ? "布局已即时应用" : "需重载思源生效", 1800, "info" as any);
      });
    });

    // 拖拽停靠：功能行可拖到屏幕角落
    content?.addEventListener("dragstart", (e: DragEvent) => {
      const row = (e.target as HTMLElement).closest(".hiword-dm-row") as HTMLElement | null;
      if (!row) return;
      (e.dataTransfer as any)?.setData("text/plain", row.dataset.feature || "");
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      showDockDropZones(p);
    });
    content?.addEventListener("dragend", () => hideDockDropZones(p));

    content?.querySelector("#hiword-dm-close")?.addEventListener("click", () => dialog.destroy());
  }

  /** 显示拖拽落区 overlay（全屏六角） */
export function showDockDropZones(p: RewordPlugin) {
    let overlay = document.getElementById("hiword-dock-zones") as HTMLElement | null;
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "hiword-dock-zones";
      overlay.className = "hiword-dock-zones";
      overlay.innerHTML = `
        <div class="hiword-dz hiword-dz-combined" data-slot="combined"><span>主侧边栏</span><em>组合栏总览</em></div>
        <div class="hiword-dz hiword-dz-lt" data-slot="LeftTop"><span>左上</span></div>
        <div class="hiword-dz hiword-dz-lb" data-slot="LeftBottom"><span>左下</span></div>
        <div class="hiword-dz hiword-dz-rt" data-slot="RightTop"><span>右上</span></div>
        <div class="hiword-dz hiword-dz-rb" data-slot="RightBottom"><span>右下</span></div>
        <div class="hiword-dz hiword-dz-bottom" data-slot="Bottom"><span>底部</span></div>`;
      document.body.appendChild(overlay);
      overlay.querySelectorAll<HTMLElement>(".hiword-dz").forEach((zone) => {
        zone.addEventListener("dragover", (e: DragEvent) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
          zone.classList.add("hiword-dz--over");
        });
        zone.addEventListener("dragleave", () => zone.classList.remove("hiword-dz--over"));
        zone.addEventListener("drop", async (e: DragEvent) => {
          e.preventDefault();
          zone.classList.remove("hiword-dz--over");
          const fid = (e.dataTransfer as any)?.getData("text/plain") || "";
          const slot = zone.dataset.slot as DockSlot;
          hideDockDropZones(p);
          if (fid && slot) {
            await p.dockManager.setSlot(fid, slot);
            const res = moveFeatureToSlot(p, fid, slot);
            const sel = document.querySelector(`.hiword-dm-select[data-feature="${fid}"]`) as HTMLSelectElement | null;
            if (sel) sel.value = slot;
            showMessage(
              res === "moved"
                ? `${featureTitle(p, fid)} 已停靠到${slotLabel(p, slot)}`
                : "需重载思源生效",
              2000, "info" as any);
          }
        });
      });
    }
    requestAnimationFrame(() => overlay!.classList.add("hiword-dz-show"));
  }

  /** 隐藏拖拽落区 overlay */
export function hideDockDropZones(p: RewordPlugin) {
    const overlay = document.getElementById("hiword-dock-zones");
    if (overlay) overlay.classList.remove("hiword-dz-show");
  }

  /** slot 的中文标签 */
export function slotLabel(p: RewordPlugin, slot: DockSlot): string {
    return SLOT_LABELS.find((s) => s.value === slot)?.label ?? slot;
  }
