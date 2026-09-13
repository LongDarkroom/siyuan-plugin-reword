/**
 * REword · 主区功能页签（2026-09-11 v2：组合栏恢复后的「放大镜」形态）
 * ---------------------------------------------------------------
 * 每个可停靠功能注册一个思源自定义 Tab 类型（plugin.addTab）。
 * 设计原则：**组合栏是家，页签是放大镜，角落停靠是特例**——
 * - 家：所有 combined 功能常驻组合栏 Tab 行，点 Tab 即用（轻场景）；
 * - 放大镜：组合栏 Tab 悬停 ⧉ / 右键 → 弹出为主区页签（重场景，大空间沉浸）；
 * - 收回：页签头部 ⇄ → 关闭页签、功能回家（activateCombinedTab 激活组合栏 Tab）。
 * - 注册：onload 阶段 registerFeatureTabs()；去重：已开 → 聚焦不重复开。
 * openTab 路由实测结论（复用 reader-tab.ts）：
 * custom.id 必须精确等于 addTab 注册的工厂 key = plugin.name + type（无分隔符）。
 *
 * 2026-09-12 修复（「⧉ 重复开页签」+「⇄ 收回没反应」同源双 bug，源码级查证思源前端产物）：
 * 1) 思源 openTab 的 custom 去重分支是 `!options.openNewTab && getAllModels().custom.find(...)`——
 *    我们传了 openNewTab:true，**思源自身去重被显式跳过**，去重必须由本模块负责。
 * 2) 思源「按类型找页签」的官方入口是导出的 getAllTabs(customModelType)（内部按 Custom 模型
 *    type 匹配，与思源内置去重同源）→ 用它做唯一权威查找，内存映射降级为兜底。
 * 3) 关页签正解：思源 Tab 类的实现就是 `close(){ this.parent.removeTab(this.id) }`；
 *    旧代码传的是 headElement 元素（应为 tab.id 字符串）→ 静默无效 = 「收回没反应」。
 * 4) 关不掉时**保留**内存映射（旧代码无条件注销 → 下次 ⧉ 判定「未开」→ 重复开）。
 */
import { getAllTabs, openTab, showMessage } from "siyuan";
import type RewordPlugin from "../index.ts";
import { getLogger } from "../core/logger.ts";
import { logSwallow } from "../core/safe.ts";
import { destroyAllPreviews } from "../annotation/ann-preview.ts";
import { activateCombinedTab, ensureDockSideStyles, exposeDockContentDelegation, moveFeatureToSlot, openDockManagerPanel } from "./dock-layout.ts";
import { t } from "../i18n/index.ts";

/** 自定义 Tab 类型前缀（addTab type = 前缀 + featureId） */
export const FEATURE_TAB_PREFIX = "hiword-feature-";

/** featureId -> 页签内容根元素（init 写入，destroy 移除） */
const tabElements = new Map<string, HTMLElement>();
/** featureId -> { tab, head }（聚焦已有页签用） */
const tabRecords = new Map<string, { tab: any; head: any }>();
/** 正在打开中的功能（防重入竞态导致重复 openTab，同 reader-tab.opening） */
const opening = new Set<string>();

/** 思源注册键：custom.id === plugin.name + tab.type（openTab 路由查找用，无分隔符） */
function featureTabKey(p: RewordPlugin, id: string): string {
  return `${p.name}${FEATURE_TAB_PREFIX}${id}`;
}

/**
 * 查找某功能当前**真实存活**的主区页签（去重唯一权威入口）。
 * 首选思源导出 API getAllTabs(customModelType)：它按 Custom 模型 type 精确匹配，
 * 与思源内置去重同源，且不依赖本模块内存状态（插件重载 / 记录丢失 / 关页签失败后都能自愈）。
 * 内存映射仅作兜底，且要求 head 仍在 DOM 中才算存活。
 */
function findLiveTab(p: RewordPlugin, id: string): any | null {
  try {
    const hits = getAllTabs(featureTabKey(p, id)) as any[];
    if (hits && hits.length > 0) return hits[0];
  } catch (e) {
    logSwallow(e, "feature-tab.ts · getAllTabs 查询", "debug");
  }
  const rec = tabRecords.get(id);
  const head: HTMLElement | null = rec?.tab?.headElement ?? null;
  if (rec?.tab && head && document.contains(head)) return rec.tab;
  if (rec) {
    // 陈旧记录（页签已不在 DOM）：清掉，避免误判「已打开」挡住新建
    tabRecords.delete(id);
    tabElements.delete(id);
  }
  return null;
}

/** 聚焦（切换到）某功能页签；思源内置去重也是 switchTab(headElement) + showHeading() 这个调法 */
function focusFeatureTab(tab: any): void {
  const head: HTMLElement | null = tab?.headElement ?? null;
  try {
    if (tab?.parent?.switchTab && head) {
      tab.parent.switchTab(head);
      tab.parent.showHeading?.();
      return;
    }
  } catch (e) {
    logSwallow(e, "feature-tab.ts · switchTab 聚焦", "debug");
  }
  // 兜底：直接点页签头（跨分屏窗口等场景）
  try {
    head?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  } catch (e) {
    logSwallow(e, "feature-tab.ts · 页签头点击", "debug");
  }
}

/** 页签是否已从 DOM 移除（关闭成功的判定依据） */
function isTabGone(tab: any): boolean {
  const head: HTMLElement | null = tab?.headElement ?? null;
  return !head || !document.contains(head);
}

/**
 * 关闭某功能页签，返回是否确认已关闭。
 * 三重降级：① Tab.close()（思源源码即 `close(){ this.parent.removeTab(this.id) }`）
 * ② parent.removeTab(tab.id)（思源内部关页签的原始调用）③ 点页签头自带 .item__close 图标。
 */
function closeFeatureTab(tab: any): boolean {
  try {
    if (typeof tab?.close === "function") {
      tab.close();
      if (isTabGone(tab)) return true;
    }
  } catch (e) {
    logSwallow(e, "feature-tab.ts · Tab.close", "debug");
  }
  try {
    if (tab?.parent?.removeTab && tab?.id) {
      tab.parent.removeTab(tab.id);
      if (isTabGone(tab)) return true;
    }
  } catch (e) {
    logSwallow(e, "feature-tab.ts · parent.removeTab", "debug");
  }
  try {
    const btn = tab?.headElement?.querySelector?.(".item__close") as HTMLElement | null;
    if (btn) {
      btn.click();
      if (isTabGone(tab)) return true;
    }
  } catch (e) {
    logSwallow(e, "feature-tab.ts · .item__close 点击", "debug");
  }
  return isTabGone(tab);
}

/**
 * 注册全部功能的主区页签工厂（onload 阶段调用一次）。
 * 页签内容 = 「窄头部条（标题 + ⇄ 收回 + ⚙️ 设置 + 📐 布局）+ 内容区」，
 * 内容区复用 #hiword-dock-content 结构 → renderFeatureInto 无需任何改动即可工作。
 */
export function registerFeatureTabs(p: RewordPlugin): void {
  for (const f of p.dockManager.getFeatures()) {
    const fid = f.id;
    try {
      p.addTab({
        type: FEATURE_TAB_PREFIX + fid,
        init: function (this: any) {
          mountFeatureTab(p, fid, this.element, this.tab);
        },
        destroy: function (this: any) {
          tabElements.delete(fid);
          tabRecords.delete(fid);
          destroyAllPreviews();
        },
      });
    } catch (e) {
      getLogger().error(`[REword] 功能页签注册失败 (${fid}):`, { operation: "初始化-主区页签", error: e });
    }
  }
  closeRetiredFeatureTabs(p);
  adoptLegacyFeatureTabs(p);
  // 版本标记：便于确认当前生效的是哪一版实现（排查「改了没生效」用）
  getLogger().info("[REword] 主区功能页签控制器 v3 就绪（getAllTabs 去重 + Tab.close 收回）");
}

/**
 * 已下线 feature 的主区页签清扫（2026-09-12 词库并入「学习」面板时新增）。
 * `vocab` 不再注册 Tab 工厂，但思源会把用户上次开着的主区页签持久化并在重启时尝试恢复；
 * 工厂缺失时该页签会变成空白死页签。这里按 type 精确查找并关闭，幂等且不依赖内存映射。
 */
const RETIRED_FEATURE_IDS = ["vocab"];

function closeRetiredFeatureTabs(p: RewordPlugin): void {
  for (const id of RETIRED_FEATURE_IDS) {
    let tabs: any[] = [];
    try {
      tabs = (getAllTabs(featureTabKey(p, id)) as any[]) ?? [];
    } catch (e) {
      logSwallow(e, "feature-tab.ts · 下线页签查询", "debug");
      continue;
    }
    for (const tab of tabs) {
      if (closeFeatureTab(tab)) {
        getLogger().info(`[REword] 已关闭下线功能的主区页签 (${id})`);
      } else {
        getLogger().warn(`[REword] 下线功能的主区页签未能关闭 (${id})`);
      }
    }
  }
}


/**
 * 把某功能的页签内容挂到 host（init 与「收养遗留页签」共用；结构每次整体重建，幂等）。
 * ⭐ 首行即登记页签实例：后续渲染若抛错绝不能丢引用，否则点 ⧉ 会重复开页签、⇄ 关不掉。
 */
function mountFeatureTab(p: RewordPlugin, fid: string, host: HTMLElement, tab: any): void {
  tabElements.set(fid, host);
  tabRecords.set(fid, { tab, head: tab?.headElement ?? null });
  ensureDockSideStyles();
  const title = t(p.dockManager.getFeatures().find((x) => x.id === fid)?.title ?? fid);
  host.style.display = "flex";
  host.style.flexDirection = "column";
  host.style.minHeight = "0";
  host.style.overflow = "hidden";
  host.innerHTML = `<div class="hiword-dock-panel" style="flex:1;min-height:0;display:flex;flex-direction:column;">
    <div class="hiword-dock-sidehead">
      <span class="hiword-dock-sidehead-title">${title}</span>
      <button class="hiword-dock-back-btn" data-act="dock" title="${t("收回组合栏")}">⇄ ${t("收回")}</button>
      <button class="hiword-dock-settings-btn" data-act="settings" title="${t("全局设置")}">⚙️</button>
      <button class="hiword-dock-settings-btn" data-act="layout" title="${t("面板布局管理")}">📐</button>
    </div>
    <div class="hiword-dock-content" id="hiword-dock-content"></div>
  </div>`;
  host.querySelector('[data-act="dock"]')?.addEventListener("click", () => {
    void featureTabBackToCombined(p, fid);
  });
  host.querySelector('[data-act="settings"]')?.addEventListener("click", () => p.openUnifiedSettings());
  host.querySelector('[data-act="layout"]')?.addEventListener("click", () => openDockManagerPanel(p));
  exposeDockContentDelegation(p, host);
  try {
    p.renderFeatureInto(fid, host);
  } catch (e) {
    getLogger().warn(`[REword] 页签内容渲染失败 (${fid})`, { operation: "主区页签-init", error: e });
  }
  try { p.applyFontSize(); } catch (__swallowErr) { logSwallow(__swallowErr, "feature-tab.ts · applyFontSize", "debug"); }
}

/**
 * 收养遗留页签（2026-09-12 新增）：插件重载后，旧实例开出的功能页签仍留在主区，
 * 但它们的按钮闭包指向已失效的旧实例（点 ⇄ 毫无反应、内容也不随新实例刷新），
 * 会被误当成「修复没生效」。这里用思源 getAllTabs 找回并**重新挂载**到当前实例。
 * 思源重启恢复页签时 init 会先跑（映射已命中），因此不会重复挂载。
 */
function adoptLegacyFeatureTabs(p: RewordPlugin): void {
  for (const f of p.dockManager.getFeatures()) {
    const fid = f.id;
    let tabs: any[] = [];
    try {
      tabs = (getAllTabs(featureTabKey(p, fid)) as any[]) ?? [];
    } catch (e) {
      logSwallow(e, "feature-tab.ts · 收养查询", "debug");
      continue;
    }
    for (const tab of tabs) {
      if (tabRecords.get(fid)?.tab === tab) continue; // 本次 init 已挂载，无需重复
      const host = (tab?.model?.element ?? tab?.panelElement) as HTMLElement | undefined;
      if (!host) continue;
      try {
        mountFeatureTab(p, fid, host, tab);
      } catch (e) {
        getLogger().warn(`[REword] 收养遗留页签失败 (${fid})`, { error: e });
      }
    }
  }
}

/** 打开某功能的主区页签；已打开则聚焦（不重复开），未打开则新建并激活 */
export async function openFeatureTab(p: RewordPlugin, id: string): Promise<void> {
  const f = p.dockManager.getFeatures().find((x) => x.id === id);
  if (!f) return;
  // ⭐ 去重：openNewTab:true 时思源不会自己去重，必须在这里挡住（2026-09-12 重复页签根因）
  const live = findLiveTab(p, id);
  if (live) {
    focusFeatureTab(live);
    return;
  }
  if (opening.has(id)) return;
  opening.add(id);
  try {
    // custom.id 必须精确等于 addTab 注册的工厂 key（plugin.name + type 直接拼接）
    const tab = await openTab({
      app: (window as any).siyuan?.ws?.app,
      custom: {
        id: featureTabKey(p, id),
        type: FEATURE_TAB_PREFIX + id,
        icon: f.icon,
        title: t(f.title),
        data: { featureId: id },
      } as any,
      keepCursor: false,
      openNewTab: true,
      // 思源在 removeCurrentTab 未传时会默认置 true，配合「在当前页签打开文件」配置
      // 可能误关无关的文档页签；显式关掉这条分支（源码查证）
      removeCurrentTab: false,
      afterOpen: () => {
        // init 已登记则直接用；否则回查思源（跨窗口 / 时序兜底）
        focusFeatureTab(tabRecords.get(id)?.tab ?? findLiveTab(p, id));
      },
    });
    if (tab) {
      tabRecords.set(id, { tab, head: (tab as any)?.headElement ?? null });
      focusFeatureTab(findLiveTab(p, id) ?? tab);
    }
  } catch (e) {
    getLogger().warn(`[REword] 打开功能页签失败 (${id})`, { error: e });
  } finally {
    opening.delete(id);
  }
}

/** 某功能的主区页签是否已打开 */
export function isFeatureTabOpen(id: string): boolean {
  return tabElements.has(id);
}

/**
 * 页签 ⇄ 收回组合栏：功能回到组合栏 Tab 行并激活，同时关闭主区页签。
 * 2026-09-12 修复：旧代码把 headElement 当 removeTab 参数（思源要的是 tab.id）导致关闭静默失败，
 * 而失败后仍无条件注销映射 → 下次 ⧉ 判定「未开」又开一个（重复页签）。
 * 现在：用 Tab.close() 正解关闭；**关不掉就保留映射**并提示用户，绝不让状态失真。
 */
export async function featureTabBackToCombined(p: RewordPlugin, id: string): Promise<void> {
  const live = findLiveTab(p, id);
  const closed = live ? closeFeatureTab(live) : true;
  // 功能回家：写回停靠关系 → 刷新组合栏 Tab 行（moveFeatureToSlot 只刷新，不再自动开页签）
  await p.dockManager.setSlot(id, "combined");
  moveFeatureToSlot(p, id, "combined");
  // 展开侧栏组合栏再激活 Tab：组合栏折叠时只切 Tab 用户看不到任何变化
  p.dockModel?.showDock?.();
  activateCombinedTab(p, id);
  if (closed) {
    tabRecords.delete(id);
    tabElements.delete(id);
  } else {
    // 保留映射：下次 ⧉ 只会聚焦这个仍开着的页签，不会重复开
    showMessage(t("页签未能自动关闭，请点页签上的 × 关闭"), 2600, "info" as any);
  }
}

/** 取某功能页签内容根元素（未打开返回 null） */
export function getFeatureTabElement(id: string): HTMLElement | null {
  return tabElements.get(id) ?? null;
}

/** 全部已打开功能页签的 [featureId, 元素] 列表（refreshActivePanel 逐个重绘用） */
export function getFeatureTabEntries(): [string, HTMLElement][] {
  return Array.from(tabElements.entries());
}

/** 重绘全部已打开的功能页签 */
export function refreshFeatureTabs(p: RewordPlugin): void {
  for (const [id, el] of tabElements) {
    try {
      p.renderFeatureInto(id, el);
    } catch (e) {
      getLogger().warn(`[REword] 刷新功能页签失败 (${id})`, { error: e });
    }
  }
}

/**
 * 「打开/聚焦某功能并拿到其承载元素」的统一异步入口（2026-09-11 v2）。
 * 路由：独立停靠 → 聚焦其 dock 面板；combined（家）→ 展开组合栏并激活对应 Tab
 * （activateCombinedTab 内同步 renderFeatureInto，返回 dockElement 即就绪）。
 * 仅当调用方显式要求主区页签（组合栏 ⧉ 弹出）才走 openFeatureTab。
 * - fn(el)：元素就绪后回调（渲染/填词等）
 * - opts.onMissing：超时未就绪兜底（如降级弹词典对话框）
 */
export async function withFeatureTab(
  p: RewordPlugin,
  id: string,
  fn: (el: HTMLElement) => void,
  opts?: { timeoutMs?: number; onMissing?: () => void }
): Promise<void> {
  const slot = p.dockManager.getSlot(id);
  if (slot !== "combined" && slot !== "hidden") {
    // 独立停靠：聚焦其 dock 面板（不开页签）
    p.standaloneModels.get(id)?.showDock?.();
    const el = p.standaloneElements.get(id);
    if (el) fn(el);
    else opts?.onMissing?.();
    return;
  }
  if (slot === "combined") {
    // combined = 组合栏是家：展开 dock + 激活 Tab，同步渲染后返回承载元素
    p.dockModel?.showDock?.();
    activateCombinedTab(p, id);
    const el = p.dockElement;
    if (el) fn(el);
    else opts?.onMissing?.();
    return;
  }
  // hidden：无组合栏 Tab，降级开主区页签（否则功能无入口）
  await openFeatureTab(p, id);
  const el = await waitForTabElement(id, opts?.timeoutMs ?? 1500);
  if (el) fn(el);
  else opts?.onMissing?.();
}

/** 轮询等待页签元素就绪（openTab resolve 与 addTab.init 之间存在时序差） */
function waitForTabElement(id: string, timeoutMs: number): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const el = tabElements.get(id);
      if (el) return resolve(el);
      if (Date.now() - t0 >= timeoutMs) return resolve(null);
      setTimeout(tick, 30);
    };
    tick();
  });
}
