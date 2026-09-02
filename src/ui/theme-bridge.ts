/**
 * L3：主题同步总线（接口化第一阶段）
 * ------------------------------------------------------------------
 * 全局唯一的思源主题切换监听。任何需要「跟随思源主题」的模块
 * （阅读器、dock 面板、iframe 等）都订阅此总线，避免各组件重复造 MutationObserver。
 *
 * 思源切换主题时的可观测行为（多版本兼容，故同时监听）：
 * - 在 <html> 上改 data-theme-mode（"light" / "dark"）  ← 阅读器原本就监听这个
 * - 在 <html> 上改 class（部分版本会加/去 theme--dark）
 * - 在 <body> 上加/去 theme--dark / theme--light 类
 * 三者任一变化都视为主题切换。
 *
 * 2026-09-01：作为「思源风格接口化」L3 落地，替代阅读器原本各自独立的 MutationObserver。
 */

import { injectTokens } from "./siyuan-tokens.ts";

type ThemeChangeCb = () => void;

const subscribers = new Set<ThemeChangeCb>();
let observer: MutationObserver | null = null;
let rafScheduled = false;
// 2026-09-02 修复「阅读器不变色」：
// 旧实现只 diff data-theme-mode / theme--dark 类，而思源换主题（同模式切主题、换强调色、
// 或仅替换 <head> 里的主题 <style>/<link>）往往不动这些属性 → 观察者静默、阅读器不重刷。
// 改为「盯实际令牌值」：组合若干关键 --b3-* 计算值 + 主题模式类作为签名，
// 任何可见外观变化都会改签名 → 必触发重刷。
let lastSig = "";

/** 读取思源当前外观签名：关键令牌计算值 + 主题模式类（多版本兼容，任一变化即视为换主题） */
function computeThemeSig(): string {
  let cs: CSSStyleDeclaration | null = null;
  try {
    cs = getComputedStyle(document.documentElement);
  } catch {
    cs = null;
  }
  const pick = (n: string) => (cs ? (cs.getPropertyValue(n) || "").trim() : "");
  const mode = document.documentElement.getAttribute("data-theme-mode") || "";
  const htmlClass = document.documentElement.className || "";
  const bodyClass = document.body?.className || "";
  return [
    mode,
    htmlClass,
    bodyClass,
    pick("--b3-theme-background"),
    pick("--b3-theme-on-background"),
    pick("--b3-theme-primary"),
    pick("--b3-theme-on-surface"),
    pick("--b3-border-color"),
  ].join("|");
}

function scheduleNotify(): void {
  if (rafScheduled) return;
  rafScheduled = true;
  // rAF + 超时双保险：确保思源切换主题的 DOM/CSS 变量已落地后再通知订阅者，
  // 否则订阅者读到的仍是旧主题值。
  requestAnimationFrame(() => {
    setTimeout(() => {
      rafScheduled = false;
      const sig = computeThemeSig();
      if (sig === lastSig) return;
      lastSig = sig;
      for (const cb of subscribers) {
        try {
          cb();
        } catch {
          /* 单个订阅者出错不影响其余 */
        }
      }
      // 主题切换后为所有已注册 iframe 重注令牌（阅读器内容 iframe 跑在 foliate srcdoc 内，
      // CSS 自定义属性不跨 iframe 继承，必须随主题重注；注册表集中管理，避免各组件各自处理）。
      refreshAllIframeTokens();
    }, 0);
  });
}

/** 初始化全局主题监听（幂等，多次调用只建一个 observer） */
export function initThemeBridge(): void {
  if (observer) return;
  lastSig = computeThemeSig();
  observer = new MutationObserver(scheduleNotify);
  // 1) <html> 属性变化（data-theme-mode / class，覆盖切换浅色↔深色）
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme-mode", "class"],
  });
  // 2) <body> 类变化（部分版本在 body 上加/去 theme--dark）
  const observeBody = () => {
    if (document.body && observer) {
      observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }
  };
  if (document.body) observeBody();
  else document.addEventListener("DOMContentLoaded", observeBody, { once: true });
  // 3) <head> 子节点增删（思源换主题常表现为替换/插入主题 <style> 或 <link data-type="theme">，
  //    此时不触发 <html>/<body> 属性变化，必须靠这里兜住；配合 computeThemeSig 的值 diff 去抖）。
  if (document.head) {
    observer.observe(document.head, { childList: true, subtree: true });
  }
}

/** 订阅思源主题切换，返回取消订阅函数（onDestroy 时调用） */
export function subscribeThemeChange(cb: ThemeChangeCb): () => void {
  initThemeBridge();
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/** iframe 注册表：主题切换时统一重注令牌（配合 siyuan-tokens.injectTokensIntoIframe） */
const iframeRegistry = new Set<HTMLIFrameElement>();

export function registerIframe(iframe: HTMLIFrameElement): void {
  iframeRegistry.add(iframe);
  // 注册时立即把当前思源令牌注入：iframe 新建时取不到父文档 CSS 变量，必须显式注入一次
  if (iframe.contentDocument) injectTokens(iframe.contentDocument);
}

export function unregisterIframe(iframe: HTMLIFrameElement): void {
  iframeRegistry.delete(iframe);
}

/** 主题变化时为所有已注册 iframe 重注令牌 */
export function refreshAllIframeTokens(): void {
  for (const f of iframeRegistry) {
    if (f.contentDocument) injectTokens(f.contentDocument);
  }
}
