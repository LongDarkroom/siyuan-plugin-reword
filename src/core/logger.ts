/**
 * REword 统一运行日志
 * ------------------------------------------------------------------
 * 目标：记录每次操作的「执行过程 + 结果」，并捕获、标记操作过程中所有报错，
 *      让使用者在每次操作后都能清楚知道哪些环节出现了报错。
 *
 * 覆盖信息：
 *   - 时间：每条记录含 epoch 毫秒 + ISO 时间串
 *   - 触发操作：operation 字段（如 "AI精读" / "词典导入" / "拖块插入"）
 *   - 错误内容：error.{name,message,stack}
 *   - 错误位置：source 字段（文件:行:列，由调用栈自动提取）
 *   - 耗时：operation 自动计时 durationMs
 *
 * 存储：
 *   - 内存环形缓冲（默认 3000 条，供查看器实时展示）
 *   - 按日落盘：<baseDir>/reword-YYYY-MM-DD.jsonl（机器可读）+ .log（人类可读）
 *   - 导出：writeExport() 生成 reword-log-export-<ts>.{log,json} 并尝试写入剪贴板
 *
 * 设计约束：
 *   - 纯数据/IO，不依赖 SiYuan SDK，可被任意模块安全引入（无循环依赖）
 *   - 落盘失败 / clipboard 失败一律静默吞掉，绝不阻塞主流程
 *   - 同时镜像到 console（统一 [REword-LOG] 前缀），与历史调试习惯兼容
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogKind = "log" | "op-start" | "op-end" | "op-error";

export interface LogError {
  name: string;
  message: string;
  stack?: string;
}

export interface LogEntry {
  seq: number;
  time: number;
  iso: string;
  level: LogLevel;
  kind: LogKind;
  operation?: string;
  source?: string;
  message: string;
  error?: LogError;
  durationMs?: number;
  data?: unknown;
}

export interface LogOpts {
  operation?: string;
  source?: string;
  error?: unknown;
  durationMs?: number;
  data?: unknown;
}

export interface LogFilter {
  level?: LogLevel | "all";
  since?: number;
  operation?: string;
  limit?: number;
  search?: string;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data, (_k, v) => (typeof v === "function" ? "[fn]" : v));
  } catch {
    return "[不可序列化]";
  }
}

/**
 * 从调用栈提取调用方位置（file:line:col）。
 * @param skip 跳过栈帧数（logger 内部层级），默认 2。
 */
function callerSite(skip = 2): string | undefined {
  try {
    const stack = new Error().stack;
    if (!stack) return undefined;
    const lines = stack.split("\n").slice(skip + 1);
    for (const line of lines) {
      const m =
        line.match(/\(([^()]*):(\d+):(\d+)\)$/) ||
        line.match(/at\s+([^()]*):(\d+):(\d+)$/);
      if (m) {
        const file = m[1].replace(/^.*[\\/]/, "");
        return `${file}:${m[2]}:${m[3]}`;
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function nowParts(): { time: number; iso: string } {
  const time = Date.now();
  return { time, iso: new Date(time).toISOString() };
}

export class Logger {
  private entries: LogEntry[] = [];
  private seq = 0;
  private max = 3000;
  private baseDir = "";
  private enabled = true;
  private dayFlag = "";
  private textPath = "";
  private jsonlPath = "";
  private globalInstalled = false;

  /* ----- 落盘缓冲（2026-09-02 性能修复）-----
   * 原实现在每条日志上直接 fs.appendFileSync ×2，属同步磁盘 I/O，会整个阻塞
   * Electron 渲染进程主线程。实测单日 14643 条日志 = 29286 次同步写盘，
   * 是思源「一卡就动不了界面」的主因之一（与 ResizeObserver 错误风暴叠加后
   * 更形成自我强化的死循环：写盘阻塞 → 布局延迟 → 更多 ResizeObserver 告警）。
   * 现改为：内存缓冲 + 定时/阈值异步批量落盘，主线程零同步 I/O。
   */
  private pendingText: string[] = [];
  private pendingJsonl: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  /** 定时 flush 间隔（ms） */
  private static readonly FLUSH_MS = 1000;
  /** 缓冲条数阈值：达到即立即异步 flush，避免峰值时内存膨胀 */
  private static readonly FLUSH_MAX = 256;

  /** 初始化日志目录与落盘路径（插件 onload 时调用） */
  configure(opts: { baseDir: string; max?: number; enabled?: boolean }): void {
    this.baseDir = opts.baseDir;
    if (typeof opts.max === "number") this.max = opts.max;
    if (typeof opts.enabled === "boolean") this.enabled = opts.enabled;
    try {
      if (this.baseDir && !fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }
    } catch {
      /* ignore */
    }
    this.rotateIfNeeded();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  private rotateIfNeeded(): void {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    if (this.dayFlag === day) return;
    this.dayFlag = day;
    if (!this.baseDir) return;
    try {
      if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
      this.jsonlPath = path.join(this.baseDir, `reword-${day}.jsonl`);
      this.textPath = path.join(this.baseDir, `reword-${day}.log`);
    } catch {
      /* ignore */
    }
  }

  private push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.shift();
  }

  /**
   * 入缓冲（同步部分只做字符串拼接，绝不触碰磁盘）。
   * 真正的写盘在 scheduleFlush/flushAsync/flushSync 中完成。
   */
  private appendFile(entry: LogEntry): void {
    if (!this.enabled || !this.baseDir) return;
    try {
      this.pendingJsonl.push(JSON.stringify(entry) + "\n");
      this.pendingText.push(this.formatText(entry) + "\n");
      this.scheduleFlush();
    } catch {
      /* 入缓冲失败不影响主流程 */
    }
  }

  /** 排程异步落盘：缓冲达阈值立即刷，否则最多延迟 FLUSH_MS */
  private scheduleFlush(): void {
    if (this.pendingText.length >= Logger.FLUSH_MAX) {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      void this.flushAsync();
      return;
    }
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushAsync();
    }, Logger.FLUSH_MS);
  }

  /**
   * 异步批量落盘（不阻塞主线程）。
   * 用 flushing 串行化，避免并发 append 造成内容交错；
   * 刷完若缓冲又攒了新日志，自动再排一次。
   */
  private async flushAsync(): Promise<void> {
    if (this.flushing) return;
    if (this.pendingText.length === 0 && this.pendingJsonl.length === 0) return;
    this.flushing = true;
    try {
      this.rotateIfNeeded();
      const text = this.pendingText.join("");
      const jsonl = this.pendingJsonl.join("");
      this.pendingText = [];
      this.pendingJsonl = [];
      try {
        if (this.jsonlPath && jsonl) await fs.promises.appendFile(this.jsonlPath, jsonl, "utf-8");
        if (this.textPath && text) await fs.promises.appendFile(this.textPath, text, "utf-8");
      } catch {
        /* 落盘失败不影响主流程 */
      }
    } finally {
      this.flushing = false;
    }
    if (this.pendingText.length || this.pendingJsonl.length) this.scheduleFlush();
  }

  /**
   * 同步落盘（仅用于导出/卸载等必须确保数据已写入的时刻）。
   * 日常运行请勿调用——它会在主线程做同步 I/O。
   */
  public flushSync(): void {
    if (!this.enabled || !this.baseDir) return;
    if (this.pendingText.length === 0 && this.pendingJsonl.length === 0) return;
    try {
      this.rotateIfNeeded();
      const text = this.pendingText.join("");
      const jsonl = this.pendingJsonl.join("");
      this.pendingText = [];
      this.pendingJsonl = [];
      if (this.jsonlPath && jsonl) fs.appendFileSync(this.jsonlPath, jsonl, "utf-8");
      if (this.textPath && text) fs.appendFileSync(this.textPath, text, "utf-8");
    } catch {
      /* 落盘失败不影响主流程 */
    }
  }

  private formatText(e: LogEntry): string {
    const op = e.operation ? `[${e.operation}] ` : "";
    const src = e.source ? ` @${e.source}` : "";
    const dur = typeof e.durationMs === "number" ? ` (${e.durationMs}ms)` : "";
    let line = `${e.iso} ${e.level.toUpperCase()} ${e.kind}${src} ${op}${e.message}${dur}`;
    if (e.error) line += `  ↳ ${e.error.name}: ${e.error.message}`;
    return line;
  }

  private emit(
    level: LogLevel,
    kind: LogKind,
    message: string,
    opts?: LogOpts
  ): LogEntry {
    const { time, iso } = nowParts();
    const entry: LogEntry = {
      seq: ++this.seq,
      time,
      iso,
      level,
      kind,
      operation: opts?.operation,
      source:
        opts?.source ||
        (kind === "log" && !opts?.error ? callerSite(3) : opts?.source),
      message,
    };
    if (opts?.durationMs != null) entry.durationMs = opts.durationMs;
    if (opts?.data !== undefined) entry.data = opts.data;
    if (opts?.error !== undefined) {
      const err = opts.error;
      entry.error =
        err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : { name: "Error", message: String(err) };
      if (level !== "error") entry.level = "error";
    }
    this.push(entry);
    this.appendFile(entry);

    // 控制台镜像（统一前缀，兼容历史调试习惯）
    const tag = `[REword-LOG ${entry.level}]${entry.operation ? " " + entry.operation : ""}`;
    const out =
      `${tag} ${entry.message}` +
      (entry.error ? ` :: ${entry.error.name}: ${entry.error.message}` : "");
    if (entry.level === "error") console.error(out, opts?.error ?? "");
    else if (entry.level === "warn") console.warn(out);
    else console.log(out);
    return entry;
  }

  /** DEBUG：最详细的过程信息 */
  debug(message: string, opts?: LogOpts): LogEntry {
    return this.emit("debug", "log", message, opts);
  }
  /** INFO：普通过程/结果 */
  info(message: string, opts?: LogOpts): LogEntry {
    return this.emit("info", "log", message, opts);
  }
  /** WARN：可恢复的问题 */
  warn(message: string, opts?: LogOpts): LogEntry {
    return this.emit("warn", "log", message, opts);
  }
  /** ERROR：显式上报一个错误（message 可为 Error 或字符串） */
  error(message: string | Error, opts?: LogOpts): LogEntry {
    if (message instanceof Error) {
      return this.emit("error", "log", message.message, {
        ...opts,
        error: message,
      });
    }
    return this.emit("error", "log", message, opts);
  }

  /**
   * 包裹一次异步操作：记录 op-start / 成功 op-end（含耗时）/ 失败 op-error（含错误位置与内容），
   * 并重新抛出原错误（调用方通常已有 catch）。
   */
  async operation<T>(
    name: string,
    fn: () => Promise<T>,
    opts?: { source?: string; data?: unknown }
  ): Promise<T> {
    const start = Date.now();
    this.emit("info", "op-start", "开始", {
      operation: name,
      source: opts?.source,
      data: opts?.data,
    });
    try {
      const r = await fn();
      const dur = Date.now() - start;
      this.emit("info", "op-end", "完成", {
        operation: name,
        durationMs: dur,
      });
      return r;
    } catch (e) {
      const dur = Date.now() - start;
      this.emit("error", "op-error", "失败", {
        operation: name,
        error: e,
        durationMs: dur,
        source: opts?.source,
      });
      throw e;
    }
  }

  /** 同步版 operation */
  operationSync<T>(
    name: string,
    fn: () => T,
    opts?: { source?: string; data?: unknown }
  ): T {
    const start = Date.now();
    this.emit("info", "op-start", "开始", {
      operation: name,
      source: opts?.source,
      data: opts?.data,
    });
    try {
      const r = fn();
      const dur = Date.now() - start;
      this.emit("info", "op-end", "完成", {
        operation: name,
        durationMs: dur,
      });
      return r;
    } catch (e) {
      const dur = Date.now() - start;
      this.emit("error", "op-error", "失败", {
        operation: name,
        error: e,
        durationMs: dur,
        source: opts?.source,
      });
      throw e;
    }
  }

  /** 查询记录（支持级别/时间/操作/搜索过滤与条数限制） */
  getEntries(filter: LogFilter = {}): LogEntry[] {
    let out = this.entries;
    if (filter.level && filter.level !== "all") {
      const min = LEVEL_RANK[filter.level as LogLevel];
      out = out.filter((e) => LEVEL_RANK[e.level] >= min);
    }
    if (filter.since != null) out = out.filter((e) => e.time >= filter.since!);
    if (filter.operation)
      out = out.filter((e) => e.operation === filter.operation);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      out = out.filter(
        (e) =>
          e.message.toLowerCase().includes(q) ||
          (e.operation || "").toLowerCase().includes(q) ||
          (e.source || "").toLowerCase().includes(q) ||
          (e.error?.message || "").toLowerCase().includes(q)
      );
    }
    out = out.slice();
    if (filter.limit != null) out = out.slice(-filter.limit);
    return out;
  }

  /** 指定时间之后的错误数（用于快速判断「本次操作是否报错」） */
  countErrors(since?: number): number {
    return this.entries.filter(
      (e) => e.level === "error" && (since == null || e.time >= since)
    ).length;
  }

  /** 最近一条错误（含 op-error） */
  lastError(): LogEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].level === "error") return this.entries[i];
    }
    return undefined;
  }

  clear(): void {
    this.entries = [];
    this.seq = 0;
  }

  /** 生成人类可读报告（错误优先，便于排查） */
  exportText(limit = 2000): string {
    const all = this.getEntries({ limit });
    const errs = all.filter((e) => e.level === "error" || e.kind === "op-error");
    let s = "";
    s += `REword 运行日志导出\n`;
    s += `导出时间: ${new Date().toISOString()}\n`;
    s += `总记录: ${all.length}  |  错误数: ${errs.length}\n`;
    s += `==================================================\n`;
    if (errs.length) {
      s += `\n[错误汇总] (共 ${errs.length} 条，错误优先)\n`;
      for (const e of errs.slice(-50)) {
        s += `\n• ${e.iso}  操作[${e.operation ?? "-"}]${e.source ? "  @ " + e.source : ""}\n`;
        s += `  内容: ${e.error ? e.error.name + ": " + e.error.message : e.message}\n`;
        if (e.error?.stack)
          s += `  堆栈: ${e.error.stack.split("\n").slice(0, 4).join("\n        ")}\n`;
      }
      s += `\n--------------------------------------------------\n`;
    }
    s += `\n[完整记录] (最近 ${all.length} 条)\n`;
    for (const e of all) s += this.formatText(e) + "\n";
    return s;
  }

  exportJSON(limit = 5000): string {
    return safeStringify(this.getEntries({ limit }));
  }

  /**
   * 写出导出文件（文本 + JSON），并尝试复制到剪贴板。
   * @returns 文件绝对路径
   */
  async writeExport(): Promise<{ textPath: string; jsonPath: string }> {
    this.rotateIfNeeded();
    // 导出前强制同步刷盘：把尚未落地的缓冲日志一并写入，保证导出内容与磁盘一致
    this.flushSync();
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const textPath = path.join(this.baseDir, `reword-log-export-${ts}.log`);
    const jsonPath = path.join(this.baseDir, `reword-log-export-${ts}.json`);
    const text = this.exportText();
    const json = this.exportJSON();
    try {
      fs.writeFileSync(textPath, text, "utf-8");
      fs.writeFileSync(jsonPath, json, "utf-8");
      this.emit("info", "log", "日志已导出", {
        operation: "日志导出",
        data: { textPath, jsonPath },
      });
    } catch (e) {
      this.emit("error", "log", "导出日志文件写入失败", {
        operation: "日志导出",
        error: e,
      });
    }
    // 复制到剪贴板（best-effort，Node 测试环境无 window）
    try {
      const w: any = typeof window !== "undefined" ? window : undefined;
      if (w?.navigator?.clipboard?.writeText) {
        await w.navigator.clipboard.writeText(text).catch(() => {});
      }
    } catch {
      /* ignore */
    }
    return { textPath, jsonPath };
  }

  /** 安装全局错误捕获（window.onerror / unhandledrejection），捕获未处理异常与位置 */
  installGlobalCapture(): void {
    if (this.globalInstalled) return;
    this.globalInstalled = true;
    const w: any = typeof window !== "undefined" ? window : undefined;
    if (!w) return;
    const label = (extra: string) => `未捕获异常${extra ? " (" + extra + ")" : ""}`;
    // 同源同错误限流：1 秒窗口内同一 source+message 最多记录 3 条，防止异常风暴刷屏
    const throttle = new Map<string, { count: number; ts: number }>();
    const THROTTLE_MS = 1000;
    const THROTTLE_MAX = 3;
    const throttled = (key: string): boolean => {
      const now = Date.now();
      const rec = throttle.get(key);
      if (!rec || now - rec.ts > THROTTLE_MS) {
        throttle.set(key, { count: 1, ts: now });
        return false;
      }
      rec.count += 1;
      return rec.count > THROTTLE_MAX;
    };

    /* ------------------------------------------------------------------
     * 2026-09-02 性能修复：浏览器已知良性循环的**聚合并极低频记录**。
     *
     * 背景：思源（含其内核与第三方插件）存在 ResizeObserver 循环，持续抛出
     *   "ResizeObserver loop completed with undelivered notifications"。
     *   该异常经 addEventListener("error") 通道到达本处理器 —— 注意它**不走**
     *   window.onerror 赋值通道，因此 console-filter.ts 的降级逻辑对此无效
     *   （实测：console-filter 只拦到 104 条，本通道却记录了 14116 条）。
     *
     * 危害：即便有「1 秒 3 条」的节流，仍达 180 条/分钟（≈3 条/秒 × 2 次写盘
     *   + console.error），实测单日 14643 条日志中 14116 条来自此处。
     *   更糟的是会形成自我强化的死循环：
     *     写盘/console 阻塞主线程 → 布局延迟 → ResizeObserver 更容易
     *     "undelivered notifications" → 抛出更多告警 → 继续阻塞。
     *   这正是「一卡就动不了思源界面」的直接成因。
     *
     * 处理：命中良性模式后只累加计数，每 5 分钟合并成一条 debug 记录，
     *   完全不进 error 通道（不写 error 级日志、不 console.error）。
     * ------------------------------------------------------------------ */
    const BENIGN_PATTERNS: readonly string[] = [
      "ResizeObserver loop",
      "ResizeObserver loop limit exceeded",
      "Script error", // 跨域脚本的无信息错误，无法定位，无记录价值
    ];
    const benignCount = new Map<string, number>();
    const benignLastTs = new Map<string, number>();
    const BENIGN_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟合并一次
    const recordBenign = (key: string, msg: string, src?: string): void => {
      const n = (benignCount.get(key) ?? 0) + 1;
      benignCount.set(key, n);
      const now = Date.now();
      const last = benignLastTs.get(key) ?? 0;
      if (now - last < BENIGN_INTERVAL_MS) return;
      benignLastTs.set(key, now);
      benignCount.set(key, 0);
      this.emit(
        "debug",
        "log",
        label("window.onerror") + `（浏览器良性循环，本周期共忽略 ${n} 次）: ${msg}`,
        { source: src }
      );
    };
    w.addEventListener?.(
      "error",
      (ev: any) => {
        const err = ev?.error || ev?.reason;
        let src: string | undefined;
        if (ev?.filename)
          src = `${String(ev.filename).replace(/^.*[\\/]/, "")}:${ev?.lineno ?? "?"}:${ev?.colno ?? "?"}`;
        const msg = err instanceof Error
          ? err.message
          : String(ev?.message || (err && (err as { message?: unknown }).message) || "未知错误");
        // ① 浏览器已知良性循环：聚合计数后极低频记录，不进 error 通道
        const benignKey = BENIGN_PATTERNS.find((p) => msg.includes(p));
        if (benignKey) {
          recordBenign(benignKey, msg, src);
          return;
        }
        // ② 思源内核自身的布局崩溃（插件无法修复）降级为 debug，不记 ERROR、不刷屏。
        // 注意：不能携带 error 字段，否则 emit 会强制提升为 error 级
        if (src?.startsWith("common.") && msg.includes("getBoundingClientRect")) {
          this.emit("debug", "log", label("window.onerror") + "（内核布局）: " + msg, { source: src });
          return;
        }
        const key = `${src || ""}|${msg}`;
        if (throttled(key)) return;
        if (err) {
          this.emit("error", "log", label("window.onerror"), {
            error: err,
            source: src,
          });
        } else {
          this.emit("error", "log", label("window.onerror") + ": " + msg, {
            source: src,
          });
        }
      },
      true
    );
    w.addEventListener?.(
      "unhandledrejection",
      (ev: any) => {
        const reason = ev?.reason;
        const msg =
          reason instanceof Error
            ? reason.message
            : String((reason && (reason as { message?: unknown }).message) || reason || "未知错误");
        // 与 error 通道一致：良性循环只做聚合，不进 error 通道
        const benignKey = BENIGN_PATTERNS.find((p) => msg.includes(p));
        if (benignKey) {
          recordBenign(benignKey, msg);
          return;
        }
        // 同源限流（该通道此前完全没有限流，异常风暴时会无上限刷 error 日志）
        if (throttled(`rejection|${msg}`)) return;
        this.emit("error", "log", label("Promise 未捕获拒绝"), {
          error: reason instanceof Error ? reason : new Error(String(reason)),
        });
      },
      true
    );
  }
}

let _logger: Logger | null = null;

/** 获取全局唯一 Logger 实例 */
export function getLogger(): Logger {
  if (!_logger) _logger = new Logger();
  return _logger;
}
