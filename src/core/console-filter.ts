/**
 * Console 过滤：屏蔽已知良性噪音，让真实错误可见。
 * ------------------------------------------------------------------
 * 修复开发者工具显示问题(2026-08-23)
 *
 * 噪音源:
 *  1. iframe sandbox 警告 — 思源内核 UI / foliate-js srcdoc iframe 都用
 *     sandbox="allow-scripts allow-same-origin",Chrome 出于安全考虑
 *     对该组合输出 warning("An iframe which has both allow-scripts and
 *     allow-same-origin for its sandbox attribute can escape its sandboxing.")。
 *     源头在 foliate vendor + 思源内核,不可改;只在显示层降级。
 *  2. ResizeObserver loop 异常 — 浏览器已知良性循环(observer
 *     回调里修改了观察元素尺寸),svelte runtime 误报为 unhandled
 *     error(`emit @ plugin:siyuan-plugin-reword:4`)。源头在 copilot-src
 *     的 ResizeObserver 用法,改根因成本高;在 window.onerror 降级
 *     显示并记录到 debug 日志即可。
 *
 * 不动 logger.ts 已有结构;本模块只覆盖 console.error + console.warn + window.onerror。
 * 真实错误/警告(不匹配 pattern)全部透传。
 *
 * 2026-08-23 扩展:Chrome 的 iframe sandbox 警告经 console.warn 路径派发
 *   (不是 console.error),所以必须同时拦截 console.warn 才能屏蔽。
 */

import { getLogger } from "./logger.ts";

/** 触发降级的字符串片段(命中即静默);其他字符串全部透传 */
const SUPPRESSED_PATTERNS: readonly string[] = [
  "iframe which has both allow-scripts", // sandbox 警告(foliate srcdoc iframe / 思源内核)
  "ResizeObserver loop",                  // 浏览器良性循环
];

/**
 * 2026-08-23 新增:同 pattern 去重,避免 ResizeObserver 反复 throw 时刷屏。
 * 60 秒内同 pattern 只调一次 getLogger.debug,避免 console 面板被重复 debug 占满。
 * 仅用于 window.onerror 路径(去重 debug 记日志);console.error / console.warn 路径不**去重。
 */
const SUPPRESSED_HISTORY = new Map<string, number>(); // pattern → lastSeenTs
const SUPPRESS_DEDUP_MS = 60_000;

/**
 * 命中检测:扫描所有 string 参数,任一 pattern 命中即视为需降级;
 * 同时返回命中的 pattern key(用于去重)。
 *
 * 2026-08-23 修复:foliate 等库经常用多参形式 console.warn("[context]", actualMsg),
 *   只查 args[0] 会漏命中。改为扫描所有参数。
 */
function shouldSuppress(input: unknown | unknown[]): { suppressed: boolean; key: string } {
  // 兼容单参数(string)或多参数(数组)
  const inputs = Array.isArray(input) ? input : [input];
  for (const item of inputs) {
    if (typeof item !== "string") continue;
    for (const p of SUPPRESSED_PATTERNS) {
      if (item.includes(p)) {
        return { suppressed: true, key: p };
      }
    }
  }
  return { suppressed: false, key: "" };
}

/** 检查是否在 60s 去重窗口内(同 pattern) */
function isInDedupWindow(key: string): boolean {
  if (!key) return false;
  const last = SUPPRESSED_HISTORY.get(key) ?? 0;
  return Date.now() - last < SUPPRESS_DEDUP_MS;
}

/** 标记 pattern 当前时间戳(用于下次去重比较) */
function markDedup(key: string): void {
  if (!key) return;
  SUPPRESSED_HISTORY.set(key, Date.now());
}

let installed = false;

/**
 * 一次性安装 console + window.onerror 过滤。
 * 应在 onload 开头(日志初始化之后)调用。
 * 多次调用幂等:只在首次生效。
 */
export function installConsoleFilter(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  // 1) console.error 过滤:屏蔽 sandbox 警告(不修改原始 console.error,
  //    只对命中 pattern 的调用做 noop,避免误伤真实错误)
  //    注:console.error 路径不**去重(避免误屏蔽真实错误)。
  const origError = console.error.bind(console);
  console.error = (...args: any[]) => {
    if (shouldSuppress(args).suppressed) return;
    origError(...args);
  };

  // 2) console.warn 过滤:Chrome 的 iframe sandbox 安全警告经 console.warn 派发
  //    (如 foliate srcdoc iframe)。降级为 noop,避免 console 面板被同样警告刷屏。
  //    注:console.warn 路径不**去重(避免误屏蔽真实警告)。
  const origWarn = console.warn.bind(console);
  console.warn = (...args: any[]) => {
    if (shouldSuppress(args).suppressed) return;
    origWarn(...args);
  };

  // 3) window.onerror 过滤:ResizeObserver loop 是浏览器已知良性循环,
  //    不应被 svelte runtime 升级为 REword-LOG error。降级为 debug + 同 pattern 60s 去重,
  //    避免 ResizeObserver 反复 throw 时 console 面板被 debug 日志刷屏。
  const origOnError = window.onerror;
  window.onerror = (msg: string | Event, src?: string, line?: number, col?: number, err?: Error) => {
    const { suppressed, key } = shouldSuppress(msg);
    if (suppressed) {
      // 仅在 60s 窗口外才记 debug(避免同 pattern 反复 throw 时刷屏)
      if (!isInDedupWindow(key)) {
        markDedup(key);
        try {
          getLogger().debug("[REword] 浏览器良性循环已降级(console filter):", { data: { msg: String(msg).slice(0, 200), pattern: key } });
        } catch {
          /* logger 自身出错不阻断 */
        }
      }
      return true; // 始终阻止默认上报(避免 REword-LOG error 污染)
    }
    // 链式调用:如果原本有 onerror 处理器,先调用它
    if (typeof origOnError === "function") {
      return (origOnError as any).call(window, msg, src, line, col, err);
    }
    return false; // 让浏览器继续默认上报
  };
}

/** 测试/运维:重置安装标志(用于单测隔离) */
export function __resetConsoleFilterForTest(): void {
  installed = false;
  SUPPRESSED_HISTORY.clear();
}
