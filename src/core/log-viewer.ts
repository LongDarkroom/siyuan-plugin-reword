/**
 * REword 运行日志查看器 + 导出入口
 * ------------------------------------------------------------------
 * 用 siyuan Dialog 渲染一个轻量日志面板：错误优先展示、按级别/搜索过滤、
 * 错误堆栈可折叠、支持刷新 / 复制 / 清空 / 导出。
 * 同时提供导出命令（写入文件 + 复制到剪贴板）。
 */

import { Dialog } from "siyuan";
import { getLogger, type LogEntry, type LogLevel } from "./logger.ts";
import { showMessage } from "siyuan";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTime(iso: string): string {
  // 2026-08-15T12:18:06.123Z -> 12:18:06.123
  const m = iso.match(/T(\d{2}:\d{2}:\d{2}\.\d+)/);
  return m ? m[1] : iso;
}

function entryRow(e: LogEntry): string {
  const lvl = e.level;
  const op = e.operation ? `<span class="hiword-log-op">${escapeHtml(e.operation)}</span>` : "";
  const src = e.source ? `<span class="hiword-log-src">@${escapeHtml(e.source)}</span>` : "";
  const dur = typeof e.durationMs === "number" ? `<span class="hiword-log-dur">${e.durationMs}ms</span>` : "";
  const msg = escapeHtml(e.message);
  const isErr = lvl === "error" || e.kind === "op-error";
  let detail = "";
  if (e.error) {
    let stack = "";
    if (e.error.stack) {
      stack = `<div class="hiword-log-stack">${escapeHtml(
        e.error.stack.split("\n").slice(0, 6).join("\n")
      )}</div>`;
    }
    detail = `<div class="hiword-log-err">${escapeHtml(e.error.name)}: ${escapeHtml(
      e.error.message
    )}</div>${stack}`;
  }
  return `
    <div class="hiword-log-row hiword-log-${lvl}${isErr ? " hiword-log-row--err" : ""}">
      <div class="hiword-log-line">
        <span class="hiword-log-time">${fmtTime(e.iso)}</span>
        <span class="hiword-log-badge hiword-log-badge--${lvl}">${lvl.toUpperCase()}</span>
        ${op}${src}${dur}
        <span class="hiword-log-msg">${msg}</span>
      </div>
      ${detail}
    </div>`;
}

function renderList(entries: LogEntry[]): string {
  if (!entries.length) {
    return `<div class="hiword-log-empty">暂无日志记录。执行一次操作（如 AI 精读、查词、拖块）后这里会显示执行过程与报错。</div>`;
  }
  // 错误优先：报错排在前，其余按时间倒序
  const errs = entries.filter((e) => e.level === "error" || e.kind === "op-error");
  const ok = entries.filter((e) => !(e.level === "error" || e.kind === "op-error"));
  const ordered = [...errs.slice().reverse(), ...ok.slice().reverse()];
  return ordered.map(entryRow).join("");
}

/** 打开运行日志查看器 */
export function openLogViewer(): void {
  const logger = getLogger();
  const content = `
    <div class="hiword-log">
      <div class="hiword-log-head">
        <div class="hiword-log-summary" id="hiword-log-summary"></div>
        <div class="hiword-log-controls">
          <select id="hiword-log-level" class="hiword-log-select">
            <option value="all">全部级别</option>
            <option value="error">仅错误</option>
            <option value="warn">警告及以上</option>
            <option value="info">信息及以上</option>
          </select>
          <input id="hiword-log-search" class="hiword-log-input" placeholder="搜索操作/消息/错误…" />
          <button class="hiword-log-btn" id="hiword-log-refresh">刷新</button>
          <button class="hiword-log-btn" id="hiword-log-copy">复制</button>
          <button class="hiword-log-btn hiword-log-btn--danger" id="hiword-log-clear">清空</button>
          <button class="hiword-log-btn hiword-log-btn--primary" id="hiword-log-export">导出</button>
        </div>
      </div>
      <div class="hiword-log-body" id="hiword-log-body"></div>
    </div>`;

  const dialog = new Dialog({
    title: "REword 运行日志",
    content,
    width: "860px",
    height: "640px",
  });

  const root = dialog.element;
  const bodyEl = root.querySelector("#hiword-log-body") as HTMLElement;
  const summaryEl = root.querySelector("#hiword-log-summary") as HTMLElement;
  const levelEl = root.querySelector("#hiword-log-level") as HTMLSelectElement;
  const searchEl = root.querySelector("#hiword-log-search") as HTMLInputElement;

  const refresh = () => {
    const level = levelEl.value as LogLevel | "all";
    const search = searchEl.value.trim();
    const entries = logger.getEntries({ level, search: search || undefined });
    const errCount = logger.countErrors();
    summaryEl.innerHTML = `共 <b>${entries.length}</b> 条记录 ｜ 错误 <b style="color:#e5552b">${errCount}</b> 条${
      errCount ? ` ｜ 最近错误：${escapeHtml(logger.lastError()?.iso || "")}` : ""
    }`;
    bodyEl.innerHTML = renderList(entries);
    bodyEl.scrollTop = 0;
  };

  levelEl.addEventListener("change", refresh);
  searchEl.addEventListener("input", refresh);
  root.querySelector("#hiword-log-refresh")?.addEventListener("click", refresh);
  root.querySelector("#hiword-log-copy")?.addEventListener("click", async () => {
    const text = logger.exportText();
    try {
      await (window as any).navigator.clipboard.writeText(text);
      showMessage("日志已复制到剪贴板", 2000, "info");
    } catch {
      showMessage("复制失败，请改用「导出」", 3000, "error");
    }
  });
  root.querySelector("#hiword-log-clear")?.addEventListener("click", () => {
    logger.clear();
    refresh();
    showMessage("日志已清空", 1500, "info");
  });
  root.querySelector("#hiword-log-export")?.addEventListener("click", async () => {
    const { textPath } = await logger.writeExport();
    showMessage(`日志已导出：${textPath}`, 5000, "info");
  });

  refresh();
}

/** 导出日志为文件并复制到剪贴板（供命令调用） */
export async function exportLogsCommand(): Promise<void> {
  const logger = getLogger();
  const { textPath } = await logger.writeExport();
  const errCount = logger.countErrors();
  const tip = errCount
    ? `日志已导出（含 ${errCount} 条错误）：${textPath}`
    : `日志已导出（无错误）：${textPath}`;
  showMessage(tip, 6000, errCount ? "error" : "info");
}
