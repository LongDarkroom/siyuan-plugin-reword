/**
 * 集中错误处理
 * ------------------------------------------------------------------
 * 根因修复（对应审查项 #7/#9 下游）：历史上大量 `catch {}` 空捕获与
 * `console.warn` 静默吞掉错误，导致 bug 难以发现、持久化失败被忽略。
 *
 * 本模块提供统一入口：错误经 showMessage 友好上报（不阻塞），并保留日志，
 * 杜绝「无声失败」。同时 safeRun 用于包装可能抛错的逻辑，避免单点崩溃。
 *
 * 2026-08-15 增强：所有上报的错误统一写入运行日志（Logger），
 * 记录「触发操作 + 错误内容 + 位置」，便于每次操作后排查报错环节。
 */

import { showMessage } from "siyuan";
import { getLogger } from "./logger.ts";

/** 以友好方式上报错误（不抛）；同时写入运行日志 */
export function reportError(e: unknown, label?: string): void {
  const msg = e instanceof Error ? e.message : String(e);
  const text = label ? `[${label}] ${msg}` : msg;
  console.error("[REword] " + text, e);
  try {
    showMessage(text.slice(0, 200), 3000, "error");
  } catch {
    /* showMessage 不可用（如 Node 单测）时忽略 */
  }
  try {
    getLogger().error(text, { operation: label, error: e });
  } catch {
    /* 日志层异常不应影响主流程 */
  }
}

/**
 * 静默捕获登记（2026-08-28）
 * ------------------------------------------------------------------
 * 历史上大量「catch 后仅跟一句注释」的空捕获把异常完全吞掉：既不弹提示、
 * 也不写日志，导致线上出问题时**没有任何信号**——用户只看到"点了没反应"，
 * 排查全靠猜。2026-08-28 全库体检实测：此类捕获约 100 处（index.ts 31 处、
 * ai-panel 15 处、ReaderView 14 处、ann-editor 11 处、dict-engine 6 处等）。
 *
 * 本函数用于替换这类空捕获，**严格保持原有「吞掉异常、继续执行」的语义**
 * （只改 catch 体内，不改变任何控制流，零行为变更风险），仅补记一条运行日志，
 * 让原本不可见的失败变得可观测。
 *
 * 分级建议：
 *  - "debug"（默认）：预期内的容错。如 JSON 解析试探、localStorage 不可用时降级。
 *  - "warn"        ：不该发生、吞掉后可继续。如单条记录写入失败、可选能力缺失。
 *  - "error"       ：会造成用户数据丢失或功能失效。如持久化失败、词典加载失败。
 *
 * @param e     捕获到的异常
 * @param label 操作标签（写明是哪个操作），会写入日志的 operation 字段
 * @param level 日志级别
 */
export function logSwallow(
  e: unknown,
  label?: string,
  level: "debug" | "warn" | "error" = "debug"
): void {
  try {
    const msg = e instanceof Error ? e.message : String(e);
    const text = label ? `[${label}] 已忽略异常: ${msg}` : `已忽略异常: ${msg}`;
    const logger = getLogger();
    if (level === "error") logger.error(text, { operation: label, error: e });
    else if (level === "warn") logger.warn(text, { operation: label, error: e });
    else logger.debug(text, { operation: label, error: e });
  } catch {
    /* 日志层自身异常绝不能反噬主流程：本函数定位是"可观测性增强"，不能成为新的失败点 */
  }
}

/** 安全执行：成功返回结果，失败上报并返回 fallback */
export async function safeRun<T>(
  fn: () => Promise<T>,
  fallback: T,
  label?: string
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    reportError(e, label);
    return fallback;
  }
}

/** 同步安全执行 */
export function safeRunSync<T>(fn: () => T, fallback: T, label?: string): T {
  try {
    return fn();
  } catch (e) {
    reportError(e, label);
    return fallback;
  }
}
