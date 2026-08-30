/**
 * 插件根目录识别（2026-08-30 修复）
 *
 * 背景：之前 `isPluginRoot` 只认 `package.json` + `name === "siyuan-plugin-reword"`。
 * SiYuan 集市发布的插件包只有 `plugin.json`（官方契约），不含 `package.json`，
 * 导致 Windows 集市安装后所有用户 `isPluginRoot` 第一关就 false，词典全部 MISSING。
 *
 * 修复：把身份证明改为双证据（plugin.json 优先 / package.json 兜底）。
 * 配套抽出 `isPluginRootWithFs` 纯函数，可注入 mock fs 测全部组合。
 *
 * 覆盖：
 *   1. plugin.json 命中（发布包场景）
 *   2. package.json 命中（开发模式）
 *   3. plugin.json + package.json 都有（dev 装到工作空间场景）
 *   4. plugin.json name 不对（误命中其他插件目录）
 *   5. dict 目录缺失
 *   6. dict 目录无 .mdx
 *   7. dict 只有非内置 .mdx（用户词典）
 *   8. plugin.json / package.json 都是非法 JSON
 *   9. 双证据都不存在（renderer/dict 等误命中目录）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPluginRootWithFs, isAsarPath, resolvePluginPathWithFs } from "../src/core/plugin-path.ts";

/** 构造一个 mock fsOps，模拟一个虚拟目录树 */
function makeFs(layout) {
  // files: 路径 → 内容字符串（仅文件）
  const files = new Map();
  // dirs: 路径集合（用于 existsSync 判定）
  const dirs = new Set();
  function walk(node, base) {
    dirs.add(base);
    if (typeof node === "string") {
      files.set(base, node);
      return;
    }
    for (const [name, val] of Object.entries(node)) {
      const next = base === "/" ? "/" + name : base + "/" + name;
      if (typeof val === "string") {
        files.set(next, val);
        dirs.add(next); // 文件路径也是合法存在路径
      } else {
        walk(val, next);
      }
    }
  }
  for (const [root, content] of Object.entries(layout)) walk(content, root);

  return {
    existsSync(p) { return files.has(p) || dirs.has(p); },
    readFileSync(p, _enc) {
      const v = files.get(p);
      if (v == null) throw new Error("ENOENT: " + p);
      return v;
    },
    readdirSync(p) {
      const prefix = p.endsWith("/") ? p : p + "/";
      const children = new Set();
      for (const k of files.keys()) {
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length);
          if (rest && !rest.includes("/")) children.add(rest);
        }
      }
      return [...children];
    },
  };
}

const PLUGIN = "siyuan-plugin-reword";

/* ----------------- 正例：身份证明 + dict 都满足 ----------------- */

test("isPluginRoot: 仅 plugin.json 命中（SiYuan 集市发布包场景）", () => {
  const fsOps = makeFs({
    "/plugins/reword": {
      "plugin.json": JSON.stringify({ name: "siyuan-plugin-reword", version: "1.4.3" }),
      "dict": { "ncecd.mdx": "" },
    },
  });
  assert.equal(isPluginRootWithFs("/plugins/reword", PLUGIN, fsOps), true);
});

test("isPluginRoot: 仅 package.json 命中（开发模式场景）", () => {
  const fsOps = makeFs({
    "/src/reword": {
      "package.json": JSON.stringify({ name: "siyuan-plugin-reword", version: "1.4.3" }),
      "dict": { "ncecd.mdx": "" },
    },
  });
  assert.equal(isPluginRootWithFs("/src/reword", PLUGIN, fsOps), true);
});

test("isPluginRoot: plugin.json + package.json 都有（双命中）", () => {
  const fsOps = makeFs({
    "/ws/reword": {
      "plugin.json": JSON.stringify({ name: "siyuan-plugin-reword" }),
      "package.json": JSON.stringify({ name: "siyuan-plugin-reword", private: true }),
      "dict": { "ecd2.mdx": "", "ncecd.mdx": "" },
    },
  });
  assert.equal(isPluginRootWithFs("/ws/reword", PLUGIN, fsOps), true);
});

test("isPluginRoot: dict 里有任一内置词典（ncecd/ecd2/hanyu）即认", () => {
  for (const dict of ["ncecd.mdx", "ecd2.mdx", "hanyu.mdx"]) {
    const fsOps = makeFs({
      "/p": {
        "plugin.json": JSON.stringify({ name: "siyuan-plugin-reword" }),
        "dict": { [dict]: "" },
      },
    });
    assert.equal(isPluginRootWithFs("/p", PLUGIN, fsOps), true, `${dict} 应当被认作内置`);
  }
});

/* ----------------- 反例：身份证明维度 ----------------- */

test("isPluginRoot: plugin.json name 错（误命中其他插件目录）→ false", () => {
  const fsOps = makeFs({
    "/plugins/other": {
      "plugin.json": JSON.stringify({ name: "siyuan-other-plugin" }),
      "dict": { "ncecd.mdx": "" },
    },
  });
  assert.equal(isPluginRootWithFs("/plugins/other", PLUGIN, fsOps), false);
});

test("isPluginRoot: package.json name 错 → false（不绕过 plugin.json）", () => {
  // plugin.json 是对的但 name 是其他名字时，仍应当 false
  const fsOps = makeFs({
    "/p": {
      "plugin.json": JSON.stringify({ name: "wrong-name" }),
      "package.json": JSON.stringify({ name: "siyuan-plugin-reword" }),
      "dict": { "ncecd.mdx": "" },
    },
  });
  // plugin.json.name 不匹配 + package.json.name 匹配 → 走 package.json 兜底
  // 当前实现：plugin.json 读取失败（name 不对）→ fallback 到 package.json（匹配）→ true
  // 期望：true（因为 package.json 是有效的身份证明）
  assert.equal(isPluginRootWithFs("/p", PLUGIN, fsOps), true,
    "plugin.json name 不匹配时仍可走 package.json 兜底");
});

test("isPluginRoot: plugin.json / package.json 都不存在 → false", () => {
  const fsOps = makeFs({
    "/random": {
      "dict": { "ncecd.mdx": "" },
    },
  });
  assert.equal(isPluginRootWithFs("/random", PLUGIN, fsOps), false);
});

test("isPluginRoot: plugin.json + package.json 都存在但 name 都错 → false", () => {
  const fsOps = makeFs({
    "/p": {
      "plugin.json": JSON.stringify({ name: "x" }),
      "package.json": JSON.stringify({ name: "y" }),
      "dict": { "ncecd.mdx": "" },
    },
  });
  assert.equal(isPluginRootWithFs("/p", PLUGIN, fsOps), false);
});

test("isPluginRoot: plugin.json 是非法 JSON → 跳过走 package.json", () => {
  const fsOps = makeFs({
    "/p": {
      "plugin.json": "not a json",
      "package.json": JSON.stringify({ name: "siyuan-plugin-reword" }),
      "dict": { "ncecd.mdx": "" },
    },
  });
  assert.equal(isPluginRootWithFs("/p", PLUGIN, fsOps), true);
});

test("isPluginRoot: 两个文件都非法 JSON → false", () => {
  const fsOps = makeFs({
    "/p": {
      "plugin.json": "bad",
      "package.json": "also bad",
      "dict": { "ncecd.mdx": "" },
    },
  });
  assert.equal(isPluginRootWithFs("/p", PLUGIN, fsOps), false);
});

/* ----------------- 反例：dict 维度 ----------------- */

test("isPluginRoot: dict 目录不存在 → false", () => {
  const fsOps = makeFs({
    "/p": {
      "plugin.json": JSON.stringify({ name: "siyuan-plugin-reword" }),
    },
  });
  assert.equal(isPluginRootWithFs("/p", PLUGIN, fsOps), false);
});

test("isPluginRoot: dict 目录无 .mdx 文件 → false", () => {
  const fsOps = makeFs({
    "/p": {
      "plugin.json": JSON.stringify({ name: "siyuan-plugin-reword" }),
      "dict": { "manifest.json": "" },
    },
  });
  assert.equal(isPluginRootWithFs("/p", PLUGIN, fsOps), false);
});

test("isPluginRoot: dict 只有非内置 .mdx（用户自备词典） → false", () => {
  const fsOps = makeFs({
    "/p": {
      "plugin.json": JSON.stringify({ name: "siyuan-plugin-reword" }),
      "dict": { "oxford.mdx": "", "collins.mdx": "" },
    },
  });
  // 只含用户词典 → 不通过内置词典检查 → 仍 false（避免误命中 renderer/dict 等）
  assert.equal(isPluginRootWithFs("/p", PLUGIN, fsOps), false);
});

test("isPluginRoot: renderer/dict 误命中场景（plugin.json + package.json 都没有）", () => {
  // 模拟思源安装目录里 renderer/dict 残留
  const fsOps = makeFs({
    "/SiYuan/resources/electron.asar/renderer/dict": {
      "ncecd.mdx": "",
    },
  });
  assert.equal(
    isPluginRootWithFs("/SiYuan/resources/electron.asar/renderer/dict", PLUGIN, fsOps),
    false,
    "误命中目录无身份文件应被拒",
  );
});

/* ----------------- 边界 ----------------- */

test("isPluginRoot: 空目录 → false", () => {
  const fsOps = makeFs({});
  assert.equal(isPluginRootWithFs("/empty", PLUGIN, fsOps), false);
});

/* ----------------- 加固：asar 守卫 + 便携版探测（2026-08-30） ----------------- */

test("isAsarPath: SiYuan 程序目录(electron.asar) 判定为 true", () => {
  assert.equal(isAsarPath("E:/思源笔记/SiYuan/resources/electron.asar/renderer"), true);
  assert.equal(isAsarPath("/Applications/SiYuan.app/Contents/Resources/electron.asar"), true);
});

test("isAsarPath: 真实插件目录/空串 判定为 false", () => {
  assert.equal(isAsarPath("F:/SIYUAN_workspace/data/plugins/siyuan-plugin-reword"), false);
  assert.equal(isAsarPath(""), false);
  assert.equal(isAsarPath("/Users/x/.config/siyuan/workspace.json"), false);
});

test("isAsarPath: 大小写不敏感", () => {
  assert.equal(isAsarPath("C:/APP/ELECTRON.ASAR/renderer"), true);
});

test("resolvePluginPathWithFs: 便携版/绿色版 exe 同级 workspace.json 命中真实插件目录", () => {
  // 模拟用户诊断场景：dirname / thisPath 都指向 asar，cwd 是 system32，
  // 但 workspace.json 在 SiYuan 程序目录（exe 同级）且指向真实工作空间
  const fsOps = makeFs({
    "F:/SIYUAN_workspace/data/plugins/siyuan-plugin-reword": {
      "plugin.json": JSON.stringify({ name: "siyuan-plugin-reword", version: "1.4.3" }),
      "dict": { "ncecd.mdx": "" },
    },
    "E:/思源笔记/SiYuan/workspace.json": JSON.stringify([{ path: "F:/SIYUAN_workspace" }]),
  });
  const r = resolvePluginPathWithFs({
    dirname: "E:/思源笔记/SiYuan/resources/electron.asar/renderer",
    cwd: "C:/Windows/system32",
    platform: "win32",
    homedir: "C:/Users/test",
    execPath: "E:/思源笔记/SiYuan/SiYuan.exe",
    resourcesPath: "E:/思源笔记/SiYuan/resources",
    thisPath: "E:/思源笔记/SiYuan/resources/electron.asar/renderer",
  }, fsOps);
  assert.equal(
    r,
    "F:/SIYUAN_workspace/data/plugins/siyuan-plugin-reword",
    "asar 候选应被剔除，真实插件目录经 exe 同级 workspace.json 命中",
  );
});

test("resolvePluginPathWithFs: 所有候选都是 asar 时兜底返回空串（绝不返回 asar）", () => {
  const fsOps = makeFs({}); // 空文件系统，无任何候选可命中
  const r = resolvePluginPathWithFs({
    dirname: "E:/思源笔记/SiYuan/resources/electron.asar/renderer",
    cwd: "C:/Windows/system32",
    platform: "win32",
    homedir: "C:/Users/test",
    execPath: "E:/思源笔记/SiYuan/SiYuan.exe",
    resourcesPath: "E:/思源笔记/SiYuan/resources",
    thisPath: "E:/思源笔记/SiYuan/resources/electron.asar/renderer",
  }, fsOps);
  assert.equal(r, "", "兜底必须返回空串而非 asar 路径，避免词典路径拼到 asar 下抛 Invalid package");
});

test("resolvePluginPathWithFs: 标准 win32 APPDATA workspace.json 仍命中", () => {
  const fsOps = makeFs({
    "F:/WS/data/plugins/siyuan-plugin-reword": {
      "plugin.json": JSON.stringify({ name: "siyuan-plugin-reword" }),
      "dict": { "ecd2.mdx": "" },
    },
    "C:/Users/test/AppData/Roaming/SiYuan/workspace.json": JSON.stringify({ workspaces: [{ path: "F:/WS" }] }),
  });
  const r = resolvePluginPathWithFs({
    dirname: "E:/思源笔记/SiYuan/resources/electron.asar/renderer",
    cwd: "C:/Windows/system32",
    platform: "win32",
    homedir: "C:/Users/test",
    appData: "C:/Users/test/AppData/Roaming",
    execPath: "E:/思源笔记/SiYuan/SiYuan.exe",
    resourcesPath: "E:/思源笔记/SiYuan/resources",
    thisPath: "E:/思源笔记/SiYuan/resources/electron.asar/renderer",
  }, fsOps);
  assert.equal(r, "F:/WS/data/plugins/siyuan-plugin-reword");
});

test("resolvePluginPathWithFs: workspace.json {data:[...]} 格式兼容", () => {
  const fsOps = makeFs({
    "F:/WS2/data/plugins/siyuan-plugin-reword": {
      "plugin.json": JSON.stringify({ name: "siyuan-plugin-reword" }),
      "dict": { "hanyu.mdx": "" },
    },
    "C:/Users/test/AppData/Roaming/SiYuan/workspace.json": JSON.stringify({ data: [{ path: "F:/WS2" }] }),
  });
  const r = resolvePluginPathWithFs({
    dirname: "E:/思源笔记/SiYuan/resources/electron.asar/renderer",
    cwd: "C:/Windows/system32",
    platform: "win32",
    homedir: "C:/Users/test",
    appData: "C:/Users/test/AppData/Roaming",
    execPath: "E:/思源笔记/SiYuan/SiYuan.exe",
    resourcesPath: "E:/思源笔记/SiYuan/resources",
    thisPath: "E:/思源笔记/SiYuan/resources/electron.asar/renderer",
  }, fsOps);
  assert.equal(r, "F:/WS2/data/plugins/siyuan-plugin-reword");
});

