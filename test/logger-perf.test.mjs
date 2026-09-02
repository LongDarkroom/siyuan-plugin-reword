// 日志系统性能回归测试（2026-09-02 思源卡顿修复）
// ----------------------------------------------------------------
// 背景：思源出现「一卡就动不了界面」的严重卡顿，根因链条为
//   ① 思源/第三方存在 ResizeObserver 循环，持续抛
//      "ResizeObserver loop completed with undelivered notifications"
//   ② 该异常经 addEventListener("error") 通道（**不经过** window.onerror
//      赋值通道，故 console-filter.ts 的降级对它无效）被 logger 记录为 error
//   ③ 每条 error 日志都执行 fs.appendFileSync ×2 —— 同步磁盘 I/O 阻塞
//      Electron 渲染进程主线程
//   ④ 实测单日 14643 条日志中 14116 条（96.5%）来自 ②，峰值 181 条/分钟
//      （即「1 秒 3 条」节流本身仍过量），形成恶性循环：
//      写盘阻塞 → 布局延迟 → 更多 ResizeObserver 告警 → 继续阻塞
//
// 本测试锁定三项修复，防止回归：
//   1) 良性循环（ResizeObserver 等）聚合为 debug，不再进 error 通道
//   2) 真实 error 不受影响（不能为了降噪误伤）
//   3) 落盘改为异步批量，单条日志不再触发同步写盘
//
// 注意：本文件需手动加入 test/ 白名单运行（npm test 长链会在前面的
//       tts-backend-fallback.test.mjs 失败处中断，见项目 MEMORY）。

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
// 用独立实例而非 getLogger() 单例：单例的 entries / globalInstalled 幂等标志
// 会跨 test 互相污染（第二条用例起 installGlobalCapture 直接 return）。
import { Logger } from "../src/core/logger.ts";

/** 建临时日志目录（自动清理） */
function withTmpLogDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reword-logtest-"));
  return {
    dir,
    cleanup: () => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不影响断言 */ }
    },
  };
}

/** 挂伪 window 并捕获 logger 注册的 error / unhandledrejection 监听 */
function mockWindowCapture() {
  const handlers = {};
  const origWin = globalThis.window;
  globalThis.window = {
    addEventListener: (type, cb) => { handlers[type] = cb; },
  };
  return {
    handlers,
    restore: () => { globalThis.window = origWin; },
  };
}

/** 静音 logger 的 console 镜像，避免污染测试输出 */
function muteConsole() {
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = () => {}; console.error = () => {}; console.warn = () => {};
  return () => { console.log = orig.log; console.error = orig.error; console.warn = orig.warn; };
}

function todayLogFile(dir) {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(dir, `reword-${day}.log`);
}

test("良性循环(ResizeObserver)错误风暴不再产生 error 级日志", () => {
  const { dir, cleanup } = withTmpLogDir();
  const cap = mockWindowCapture();
  const unmute = muteConsole();
  try {
    const log = new Logger();
    log.configure({ baseDir: dir, enabled: true });
    log.installGlobalCapture();
    const before = log.getEntries({ level: "error" }).length;

    const h = cap.handlers["error"];
    assert.ok(h, "应已注册 error 监听");
    // 模拟 50 条 ResizeObserver 告警（真实环境约 3 条/秒持续不断）
    for (let i = 0; i < 50; i++) {
      h({
        filename: "https://127.0.0.1:6806/appearance/x?v=1788330021434",
        lineno: 0,
        colno: 0,
        message: "ResizeObserver loop completed with undelivered notifications.",
        error: new Error("ResizeObserver loop completed with undelivered notifications."),
      });
    }
    const after = log.getEntries({ level: "error" }).length;
    assert.equal(after, before, `不应新增 error 级日志（前 ${before} / 后 ${after}）`);
  } finally {
    unmute(); cap.restore(); cleanup();
  }
});

test("良性循环聚合为单条 debug 且带忽略次数", () => {
  const { dir, cleanup } = withTmpLogDir();
  const cap = mockWindowCapture();
  const unmute = muteConsole();
  try {
    const log = new Logger();
    log.configure({ baseDir: dir, enabled: true });
    log.installGlobalCapture();

    const h = cap.handlers["error"];
    for (let i = 0; i < 20; i++) {
      h({
        filename: "https://127.0.0.1:6806/appearance/x?v=1",
        lineno: 0,
        colno: 0,
        message: "ResizeObserver loop completed with undelivered notifications.",
        error: new Error("ResizeObserver loop completed with undelivered notifications."),
      });
    }
    const benign = log
      .getEntries({ level: "all" })
      .filter((e) => e.message.includes("浏览器良性循环"));
    assert.equal(benign.length, 1, `应为 1 条聚合 debug，实际 ${benign.length}`);
    assert.equal(benign[0].level, "debug", "级别应为 debug（不得为 error）");
    assert.match(benign[0].message, /共忽略 \d+ 次/, "聚合消息应带忽略次数");
  } finally {
    unmute(); cap.restore(); cleanup();
  }
});

test("真实 error 仍被正常记录（降噪不误伤）", () => {
  const { dir, cleanup } = withTmpLogDir();
  const cap = mockWindowCapture();
  const unmute = muteConsole();
  try {
    const log = new Logger();
    log.configure({ baseDir: dir, enabled: true });
    log.installGlobalCapture();
    const before = log.getEntries({ level: "error" }).length;

    cap.handlers["error"]({
      filename: "https://127.0.0.1:6806/plugins/reword/index.js",
      lineno: 10,
      colno: 2,
      message: "boom",
      error: new Error("boom"),
    });
    const after = log.getEntries({ level: "error" }).length;
    assert.equal(after, before + 1, `真实 error 应被记录（前 ${before} / 后 ${after}）`);
  } finally {
    unmute(); cap.restore(); cleanup();
  }
});

test("落盘异步化：单条日志写入后不立即产生文件", () => {
  const { dir, cleanup } = withTmpLogDir();
  const unmute = muteConsole();
  try {
    const log = new Logger();
    log.configure({ baseDir: dir, enabled: true });
    log.info("异步落盘验证-1");
    log.info("异步落盘验证-2");
    assert.equal(
      fs.existsSync(todayLogFile(dir)),
      false,
      "同步写盘应已移除：此刻文件不应存在"
    );
  } finally {
    unmute(); cleanup();
  }
});

test("flushSync 能立即把缓冲落地", () => {
  const { dir, cleanup } = withTmpLogDir();
  const unmute = muteConsole();
  try {
    const log = new Logger();
    log.configure({ baseDir: dir, enabled: true });
    log.info("flushSync-1");
    log.info("flushSync-2");
    log.flushSync();
    const f = todayLogFile(dir);
    assert.equal(fs.existsSync(f), true, "flushSync 后文件应存在");
    const txt = fs.readFileSync(f, "utf-8");
    assert.match(txt, /flushSync-1/, "应包含第 1 条");
    assert.match(txt, /flushSync-2/, "应包含第 2 条");
  } finally {
    unmute(); cleanup();
  }
});

test("定时器(1s)自动把缓冲落盘", async () => {
  const { dir, cleanup } = withTmpLogDir();
  const unmute = muteConsole();
  try {
    const log = new Logger();
    log.configure({ baseDir: dir, enabled: true });
    log.info("定时落盘验证");
    await new Promise((r) => setTimeout(r, 1500));
    const txt = fs.readFileSync(todayLogFile(dir), "utf-8");
    assert.match(txt, /定时落盘验证/, "1 秒后应已自动落盘");
  } finally {
    unmute(); cleanup();
  }
});
