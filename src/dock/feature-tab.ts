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
 */
import { openTab } from "siyuan";
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

/**
 * 注册全部功能的主区页签工厂（onload 阶段调用一次）。
 * init 内构建「窄头部条（标题 + ⇄ 停靠到侧栏 + ⚙️ 设置 + 📐 布局）+ 内容区」，
 * 内容区复用 #hiword-dock-content 结构 → renderFeatureInto 无需任何改动即可工作。
 */
export function registerFeatureTabs(p: RewordPlugin): void {
  for (const f of p.dockManager.getFeatures()) {
    const fid = f.id;
    try {
      p.addTab({
        type: FEATURE_TAB_PREFIX + fid,
        init: function (this: any) {
          const custom = this;
          // ⭐ 首行先登记页签实例（openFeatureTab 去重 / featureTabBackToCombined 关闭都依赖）；
          // 后续渲染若抛错绝不能丢引用，否则点 ⧉ 会重复开页签、⇄ 收回关不掉（2026-09-11 实测双 bug 根因）。
          tabElements.set(fid, custom.element);
          tabRecords.set(fid, { tab: custom.tab, head: custom.tab?.headElement ?? null });
          ensureDockSideStyles();
          custom.element.style.display = "flex";
          custom.element.style.flexDirection = "column";
          custom.element.style.minHeight = "0";
          custom.element.style.overflow = "hidden";
          custom.element.innerHTML = `<div class="hiword-dock-panel" style="flex:1;min-height:0;display:flex;flex-direction:column;">
            <div class="hiword-dock-sidehead">
              <span class="hiword-dock-sidehead-title">${t(f.title)}</span>
              <button class="hiword-dock-back-btn" data-act="dock" title="${t("收回组合栏")}">⇄ ${t("收回")}</button>
              <button class="hiword-dock-settings-btn" data-act="settings" title="${t("全局设置")}">⚙️</button>
              <button class="hiword-dock-settings-btn" data-act="layout" title="${t("面板布局管理")}">📐</button>
            </div>
            <div class="hiword-dock-content" id="hiword-dock-content"></div>
          </div>`;
          custom.element.querySelector('[data-act="dock"]')?.addEventListener("click", () => {
            void featureTabBackToCombined(p, fid);
          });
          custom.element.querySelector('[data-act="settings"]')?.addEventListener("click", () => p.openUnifiedSettings());
          custom.element.querySelector('[data-act="layout"]')?.addEventListener("click", () => openDockManagerPanel(p));
          exposeDockContentDelegation(p, custom.element);
          try {
            p.renderFeatureInto(fid, custom.element);
          } catch (e) {
            getLogger().warn(`[REword] 页签内容渲染失败 (${fid})`, { operation: "主区页签-init", error: e });
          }
          try { p.applyFontSize(); } catch (__swallowErr) { logSwallow(__swallowErr, "feature-tab.ts · applyFontSize", "debug"); }
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
}

/** 打开某功能的主区页签；已打开则聚焦（不重复开），未打开则新建并激活 */
export async function openFeatureTab(p: RewordPlugin, id: string): Promise<void> {
  const f = p.dockManager.getFeatures().find((x) => x.id === id);
  if (!f) return;
  const rec = tabRecords.get(id);
  if (rec?.tab) {
    try {
      rec.tab.parent?.switchTab?.(rec.tab.headElement ?? rec.head);
    } catch (e) {
      logSwallow(e, "feature-tab.ts · openFeatureTab focus", "debug");
    }
    return;
  }
  if (tabRecords.has(id)) {
    // init 已登记但 custom.tab 尚不可用（极端时序）：宁可不聚焦也不重复 openTab（2026-09-11 重复页签教训）
    await new Promise((r) => setTimeout(r, 60));
    const rec2 = tabRecords.get(id);
    try {
      rec2?.tab?.parent?.switchTab?.(rec2.tab.headElement ?? rec2.head);
    } catch (e) {
      logSwallow(e, "feature-tab.ts · openFeatureTab late-focus", "debug");
    }
    return;
  }
  if (opening.has(id)) return;
  opening.add(id);
  try {
    // custom.id 必须精确等于 addTab 注册的工厂 key（plugin.name + type 直接拼接）
    const tab = await openTab({
      app: (window as any).siyuan?.ws?.app,
      custom: {
        id: `${p.name}${FEATURE_TAB_PREFIX}${id}`,
        type: FEATURE_TAB_PREFIX + id,
        icon: f.icon,
        title: t(f.title),
        data: { featureId: id },
      } as any,
      keepCursor: false,
      openNewTab: true,
      afterOpen: () => {
        try {
          const opened = tabRecords.get(id)?.tab;
          if (opened) opened.parent?.switchTab?.(opened.headElement);
        } catch (e) {
          logSwallow(e, "feature-tab.ts · afterOpen", "debug");
        }
      },
    });
    if (tab) {
      const prev = tabRecords.get(id);
      tabRecords.set(id, { tab, head: (tab as any)?.headElement ?? prev?.head ?? null });
      try {
        (tab as any).parent?.switchTab?.((tab as any).headElement);
      } catch (e) {
        logSwallow(e, "feature-tab.ts · openFeatureTab switch", "debug");
      }
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
 * 页签 ⇄ 收回组合栏（2026-09-11 v2）：功能回到组合栏 Tab 行并激活，同时关闭主区页签。
 * 关页签走思源内部 Tab.parent.removeTab（switchTab 同源的内部 API；关不掉则降级为
 * 「页签保留 + 组合栏激活」，双处同源渲染无冲突，仅少了自动收尾）。
 */
export async function featureTabBackToCombined(p: RewordPlugin, id: string): Promise<void> {
  await p.dockManager.setSlot(id, "combined");
  // moveFeatureToSlot(combined)：刷新组合栏 Tab 行把功能收纳进来（icon 显隐等）
  moveFeatureToSlot(p, id, "combined");
  // ⭐ 先展开侧栏组合栏再激活 Tab：组合栏折叠时只切 Tab 用户看不到任何变化（2026-09-11 实测「收回没反应」根因之一）
  p.dockModel?.showDock?.();
  activateCombinedTab(p, id);
  const rec = tabRecords.get(id);
  const head = rec?.head ?? rec?.tab?.headElement ?? null;
  try {
    (rec?.tab as any)?.parent?.removeTab?.(head);
  } catch (e) {
    logSwallow(e, "feature-tab.ts · featureTabBackToCombined close", "debug");
  }
  tabRecords.delete(id);
  tabElements.delete(id);
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
