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
