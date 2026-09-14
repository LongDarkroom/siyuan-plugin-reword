/**
 * REword · 内置 Radicale 服务管家（Local CalDAV Service Manager）
 * ------------------------------------------------------------------
 * 让插件自己负责本地 CalDAV 服务（Radicale）的启停，替代 macOS 登录项。
 *
 * 两种模式（settings.serviceMode）：
 *   - `follow`：思源启动时拉起服务，思源退出时停止（插件接管）
 *   - `manual`：仅由设置面板里的按钮手动启停
 *
 * ── 关键技术依据（2026-09-14 查证思源前端产物）────────────────────
 * 思源加载插件时把 `require` 直接注入函数作用域：
 *   const Be = Xe => ({siyuan: le})[Xe] ?? window.require?.(Xe);
 *   window.eval("(function anonymous(require, module, exports){" + 插件代码 + "})")(Be, ...)
 * 即：非 "siyuan" 的模块一律回落到 `window.require`，而渲染进程自己就在
 * `require("fs")` / `require("electron")` —— 是**完整的 Node require**。
 * 故插件可直接 `require("child_process").spawn(...)`。
 * ⚠️ `child_process` 需列进 vite.config.mts 的 `external`，否则会被打包器尝试解析。
 *
 * ── 三条实现纪律 ────────────────────────────────────────────────
 * 1. **卸载路径零 I/O**：`killManagedServiceNow()` 只对内存里缓存的 pid 发
 *    SIGTERM（`process.kill` 是同步系统调用，不阻塞），绝不读文件——
 *    因为 onunload 里 await 不到异步结果，思源不会等。
 * 2. **归属判定优先信 pidfile**：pidfile 指向的进程仍存活 ⇒ 就是自己拉起的
 *    （包括"思源被强杀留下的孤儿"，下次能正常接管并停止）。只有"pidfile 不存在
 *    但端口在监听"才算真正的外部服务。
 * 3. **启动前必探端口**：已在监听则直接复用，绝不重复 spawn（否则端口冲突、
 *    日志里刷 "Address already in use"）。
 */
import {
  DEFAULT_SERVICE_CONFIG,
  DEFAULT_SERVICE_PYTHON,
  type CalendarSyncSettings,
  type ServiceStatus,
} from "./types.ts";
import { t } from "../i18n/index.ts";

/* ---------- Node 能力（思源注入的完整 require） ---------- */

function nodeRequire(name: string): any {
  try {
    return require(name);
  } catch {
    return null;
  }
}

function homedir(): string {
  const os = nodeRequire("os");
  if (os?.homedir) {
    try {
      return os.homedir() || "";
    } catch {
      /* 落到下面的兜底 */
    }
  }
  return process.env.HOME || process.env.USERPROFILE || "";
}

/** 展开 `~` 前缀（Node 的 fs 不认 `~`，必须自己展开） */
function expandPath(p: string): string {
  const s = (p || "").trim();
  if (!s) return "";
  if (s === "~") return homedir();
  if (s.startsWith("~/")) return homedir() + s.slice(1);
  return s;
}

/** pidfile / 日志的固定落点（与 radicale.conf 同域，便于排查） */
const PID_FILE_REL = "~/.caldav-test/radicale.pid";
const LOG_FILE_REL = "~/.caldav-test/radicale.out.log";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 本插件拉起的服务进程号（内存缓存）。
 * ⚠️ 存在的唯一目的：让 onunload 能在**不做任何 I/O** 的前提下停止服务。
 */
let managedPid = 0;

/* ---------- 配置解析 ---------- */

export interface ResolvedServicePaths {
  python: string;
  config: string;
  pidFile: string;
  logFile: string;
}

export function resolveServicePaths(s: CalendarSyncSettings): ResolvedServicePaths {
  return {
    python: expandPath(s.servicePythonPath || DEFAULT_SERVICE_PYTHON),
    config: expandPath(s.serviceConfigPath || DEFAULT_SERVICE_CONFIG),
    pidFile: expandPath(PID_FILE_REL),
    logFile: expandPath(LOG_FILE_REL),
  };
}

/** 从 serverUrl 解析端口（解析不出则回落 5232） */
export function servicePort(s: CalendarSyncSettings): number {
  const raw = (s.serverUrl || "").trim();
  if (raw) {
    try {
      const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
      if (u.port) {
        const n = Number(u.port);
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch {
      /* 交给默认值 */
    }
  }
  return 5232;
}

/* ---------- 探针 ---------- */

/** 探测本机端口是否已在监听（TCP connect，无副作用） */
export function probePort(port: number, host = "127.0.0.1", timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const net = nodeRequire("net");
    if (!net?.connect) {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        sock?.destroy();
      } catch {
        /* 已断开 */
      }
      resolve(ok);
    };
    let sock: any;
    try {
      sock = net.connect({ port, host });
    } catch {
      resolve(false);
      return;
    }
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

function isAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    // ESRCH = 不存在；EPERM = 存在但无权限（仍算存活）
    return e?.code === "EPERM";
  }
}

async function readPidFile(pidFile: string): Promise<number> {
  const fs = nodeRequire("fs");
  if (!fs?.promises) return 0;
  try {
    const raw = await fs.promises.readFile(pidFile, "utf8");
    const n = parseInt(String(raw).trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function fileExists(p: string): Promise<boolean> {
  const fs = nodeRequire("fs");
  if (!fs?.promises || !p) return false;
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

/* ---------- 状态 ---------- */

export async function getServiceStatus(s: CalendarSyncSettings): Promise<ServiceStatus> {
  const { python, config, pidFile } = resolveServicePaths(s);
  const port = servicePort(s);

  const [hasPython, hasConfig, running] = await Promise.all([
    fileExists(python),
    fileExists(config),
    probePort(port),
  ]);
  const programFound = hasPython && hasConfig;

  const pid = await readPidFile(pidFile);
  const owned = running && isAlive(pid);
  if (owned) managedPid = pid;

  let detail: string;
  if (!programFound) {
    detail = !hasPython
      ? t("未找到服务程序，请检查解释器路径")
      : t("未找到配置文件，请检查路径");
  } else if (owned) {
    detail = t("运行中（由插件启动）");
  } else if (running) {
    detail = t("运行中（由其他方式启动）");
  } else {
    detail = t("已停止");
  }

  return { running, owned, pid: owned ? pid : null, programFound, detail };
}

/* ---------- 启动 ---------- */

export interface ServiceActionResult {
  ok: boolean;
  message: string;
  status: ServiceStatus;
}

export async function startService(s: CalendarSyncSettings): Promise<ServiceActionResult> {
  const { python, config, pidFile, logFile } = resolveServicePaths(s);
  const port = servicePort(s);

  if (!(await fileExists(python))) {
    return {
      ok: false,
      message: t("未找到服务程序：{path}", { path: python }),
      status: await getServiceStatus(s),
    };
  }
  if (!(await fileExists(config))) {
    return {
      ok: false,
      message: t("未找到配置文件：{path}", { path: config }),
      status: await getServiceStatus(s),
    };
  }

  // 已在监听 ⇒ 复用，绝不重复拉起
  if (await probePort(port)) {
    const st = await getServiceStatus(s);
    return {
      ok: true,
      message: st.owned ? t("服务已在运行") : t("端口 {port} 已被占用，未重复启动", { port: String(port) }),
      status: st,
    };
  }

  const cp = nodeRequire("child_process");
  const fs = nodeRequire("fs");
  if (!cp?.spawn || !fs) {
    return {
      ok: false,
      message: t("当前环境不支持启动本地服务"),
      status: await getServiceStatus(s),
    };
  }

  // 清掉可能干扰 Python 的环境变量（沙箱注入的 shim 会污染 site-packages 解析）
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.PYTHONPATH;
  delete env.PYTHONHOME;
  delete env.PYTHONSTARTUP;

  let outFd: number | undefined;
  try {
    outFd = fs.openSync(logFile, "a");
  } catch {
    outFd = undefined;
  }

  let child: any;
  try {
    child = cp.spawn(python, ["-m", "radicale", "--config", config], {
      detached: true,
      stdio: outFd === undefined ? "ignore" : ["ignore", outFd, outFd],
      env,
      cwd: homedir() || undefined,
    });
  } catch (e: any) {
    if (outFd !== undefined) {
      try {
        fs.closeSync(outFd);
      } catch {
        /* 忽略 */
      }
    }
    return {
      ok: false,
      message: t("启动失败：{err}", { err: String(e?.message || e) }),
      status: await getServiceStatus(s),
    };
  }

  child.unref?.();
  managedPid = Number(child.pid) || 0;

  try {
    await fs.promises.writeFile(pidFile, String(managedPid));
  } catch {
    /* pidfile 写不进不影响本次启动，只是下次归属判定会退化为"外部服务" */
  }

  // 轮询等待就绪（Radicale 冷启动通常 1–3 秒）
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    if (await probePort(port)) {
      return { ok: true, message: t("服务已启动"), status: await getServiceStatus(s) };
    }
  }

  return {
    ok: false,
    message: t("服务启动超时，请查看日志：{path}", { path: logFile }),
    status: await getServiceStatus(s),
  };
}

/* ---------- 停止 ---------- */

export async function stopService(s: CalendarSyncSettings): Promise<ServiceActionResult> {
  const { pidFile } = resolveServicePaths(s);
  const port = servicePort(s);
  const pid = (await readPidFile(pidFile)) || managedPid;

  // 没有可停的托管进程
  if (!pid || !isAlive(pid)) {
    if (await probePort(port)) {
      return {
        ok: false,
        message: t("该服务不是由插件启动的，无法停止"),
        status: await getServiceStatus(s),
      };
    }
    return { ok: true, message: t("服务已停止"), status: await getServiceStatus(s) };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* 已退出 */
  }

  for (let i = 0; i < 12; i++) {
    await sleep(250);
    if (!isAlive(pid)) break;
  }
  if (isAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* 忽略 */
    }
    await sleep(250);
  }

  managedPid = 0;
  const fs = nodeRequire("fs");
  try {
    await fs?.promises?.unlink(pidFile);
  } catch {
    /* pidfile 不存在也无所谓 */
  }

  return { ok: true, message: t("服务已停止"), status: await getServiceStatus(s) };
}

/* ---------- 卸载路径（零 I/O，必须同步） ---------- */

/**
 * 停止由本插件拉起的服务 —— 专供 `onunload` 调用。
 * 只对内存里的 pid 发一次 SIGTERM，不读文件、不 await。
 * 留下的 pidfile 不是问题：下次启动时若进程已死会自动清理。
 */
export function killManagedServiceNow(): void {
  const pid = managedPid;
  managedPid = 0;
  if (!pid || pid <= 0) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* 已退出 */
  }
}

/** 是否持有托管进程（供 onunload 判断要不要动手） */
export function hasManagedService(): boolean {
  return managedPid > 0;
}
