/**
 * 插件根目录识别（纯函数，可单测）
 * ------------------------------------------------------------------
 * 2026-08-30 修复背景：
 *   原实现只认 `package.json` + `name === "siyuan-plugin-reword"` 作为
 *   插件身份证明。但 SiYuan 集市安装的发布包只含 `plugin.json`（SiYuan
 *   官方契约），不含 `package.json`——导致 Windows 集市安装用户
 *   `isPluginRoot` 第一关就 false，词典全部 MISSING（用户报告）。
 *
 * 修复方案：身份证明改为"双证据 OR"
 *   1. plugin.json + name === "siyuan-plugin-reword"  ← SiYuan 发布包
 *   2. package.json + name === "siyuan-plugin-reword" ← 开发模式（`npm run dev`）
 *   任一满足即视为本插件根；dict/*.mdx 内置词典检查保留作正交维度
 *   （防误命中 renderer/dict 等用户曾误导入词典的位置）。
 *
 * 抽到独立模块而非内联在 index.ts（单文件 12860+ 行）的原因：
 *   - index.ts 含 parameter properties / enum 等语法，Node strip-types 跑不动
 *   - 纯函数 + 可注入 fsOps 便于单测覆盖 4 个维度的所有组合
 */
import * as path from "path";
import * as fs from "node:fs";

/** fs 接口（测试时可注入 mock，生产环境传 node fs） */
export interface PluginRootFsOps {
  existsSync(p: string): boolean;
  readFileSync(p: string, enc: string): string;
  readdirSync(p: string): string[];
}

/** 内置词典白名单（识别"这是 REword 插件目录"的关键） */
const BUILTIN_DICTS = ["ncecd.mdx", "ecd2.mdx", "hanyu.mdx"];

/** 节点 fs → 满足 PluginRootFsOps 形态（仅暴露三个方法，避免泄漏 fs 全部 API） */
const nodeFs: PluginRootFsOps = {
  existsSync: (p) => fs.existsSync(p),
  readFileSync: (p, enc) => fs.readFileSync(p, enc as BufferEncoding),
  readdirSync: (p) => fs.readdirSync(p),
};

/**
 * 判定 `dir` 是否为本插件根目录。
 *   1. dict/ 子目录存在 + 至少一个内置词典 .mdx
 *   2. 身份证明：plugin.json 优先 / package.json 兜底（任一满足即可）
 * @param dir 候选根目录绝对路径
 * @param pluginName 期望的插件名（当前为 "siyuan-plugin-reword"）
 * @param fsOps 可选 fs 抽象（默认 node fs；测试传 mock）
 */
export function isPluginRootWithFs(
  dir: string,
  pluginName: string,
  fsOps: PluginRootFsOps = nodeFs
): boolean {
  // 1. dict/ 子目录 + 至少一个内置词典 .mdx
  const d = path.join(dir, "dict");
  if (!fsOps.existsSync(d)) return false;
  let mdx: string[];
  try { mdx = fsOps.readdirSync(d).filter((f) => f.endsWith(".mdx")); }
  catch { return false; }
  if (mdx.length === 0) return false;
  if (!mdx.some((f) => BUILTIN_DICTS.includes(f))) return false;

  // 2. 身份证明：plugin.json 优先（SiYuan 官方契约，所有发布包都含）
  if (identifyByJson(path.join(dir, "plugin.json"), pluginName, fsOps)) return true;
  //    兜底：package.json（开发模式 / 源码目录）
  if (identifyByJson(path.join(dir, "package.json"), pluginName, fsOps)) return true;
  return false;
}

/** 读取 JSON 文件并检查 name 字段是否匹配（解析失败返回 false） */
function identifyByJson(jsonPath: string, pluginName: string, fsOps: PluginRootFsOps): boolean {
  if (!fsOps.existsSync(jsonPath)) return false;
  try {
    const data = JSON.parse(fsOps.readFileSync(jsonPath, "utf-8"));
    return !!(data && data.name === pluginName);
  } catch {
    return false;
  }
}

/** 判断路径是否落在 SiYuan 程序目录的 electron.asar 虚拟包内（绝不可当作插件目录） */
export function isAsarPath(p: string): boolean {
  return !!p && /electron\.asar/i.test(p);
}

/** resolvePluginPathWithFs 所需的运行时环境快照（便于单测注入） */
export interface ResolvePluginPathEnv {
  dirname?: string;
  cwd: string;
  platform: string;            // "win32" | "darwin" | "linux"
  homedir: string;
  appData?: string;
  localAppData?: string;
  execPath?: string;
  resourcesPath?: string;
  thisPath?: string;           // SiYuan 基类 this.path（可能指向 asar）
  pluginName?: string;
}

/**
 * 确定性探测插件根目录（纯函数，可单测）。
 *
 * 加固要点（2026-08-30）：
 *   1. **asar 守卫**：任何含 electron.asar 的路径都绝不进入候选，兜底也返回 ""
 *      ——杜绝词典路径被拼到 asar 下，抛出令人困惑的 "Invalid package"。
 *   2. **便携版探测**：除标准 workspace.json 位置外，补充 exe 同级目录与
 *      process.resourcesPath 父级（绿色版/便携版 SiYuan 常把 workspace.json 放这）。
 *   3. **workspace.json 多格式兼容**：数组 / {workspaces} / {data}。
 *
 * @returns 含 dict/*.mdx 且通过身份校验的插件根目录；找不到时返回 ""（绝不为 asar）。
 */
export function resolvePluginPathWithFs(
  env: ResolvePluginPathEnv,
  fsOps: PluginRootFsOps = nodeFs
): string {
  const PLUGIN_NAME = env.pluginName || "siyuan-plugin-reword";
  // 注意：必须把注入的 fsOps 透传给 isPluginRootWithFs，否则会回退到真实 node fs，
  // 在测试/某些运行时下 cwd 恰好是插件目录时会误判（isPluginRoot(".") 为真）。
  const isPluginRoot = (dir: string): boolean => isPluginRootWithFs(dir, PLUGIN_NAME, fsOps);

  const candidates: string[] = [];
  const pushCand = (p?: string) => {
    if (!p) return;
    const np = path.normalize(p);
    if (isAsarPath(np)) return;            // 绝不把 SiYuan 程序目录当插件目录
    if (!candidates.includes(np)) candidates.push(np);
  };

  // 1. 从 __dirname 向上遍历（最可靠，与环境变量无关）
  const dirname = env.dirname;
  if (dirname && dirname !== ".") {
    let cur = path.normalize(dirname);
    for (let i = 0; i < 8; i++) {
      pushCand(cur);
      pushCand(path.join(cur, "data", "plugins", PLUGIN_NAME));
      pushCand(path.join(cur, PLUGIN_NAME));
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }

  // 2. workspace.json 多位置探测（跨平台 + 便携版）
  const home = env.homedir || "";
  const wsCandidates: string[] = [];
  if (home) {
    wsCandidates.push(
      path.join(home, ".config", "siyuan", "workspace.json"),
      path.join(home, ".config", "SiYuan", "workspace.json"),
    );
  }
  if (env.platform === "darwin") {
    wsCandidates.push(
      path.join(home, "Library", "Application Support", "siyuan", "workspace.json"),
      path.join(home, "Documents", "SiYuan", "workspace.json"),
      "/Applications/SiYuan.app/Contents/Resources/app/config/workspace.json",
      "/Applications/SiYuan.app/Contents/Resources/config/workspace.json",
    );
  } else if (env.platform === "win32") {
    const appData = env.appData || "";
    const localAppData = env.localAppData || "";
    if (appData) wsCandidates.push(path.join(appData, "SiYuan", "workspace.json"));
    if (localAppData) wsCandidates.push(path.join(localAppData, "SiYuan", "workspace.json"));
    if (home) {
      wsCandidates.push(
        path.join(home, "Documents", "SiYuan", "workspace.json"),
        path.join(home, "AppData", "Roaming", "SiYuan", "workspace.json"),
        path.join(home, "AppData", "Local", "SiYuan", "workspace.json"),
      );
    }
  }
  // 便携版 / 绿色版：workspace.json 常与 exe 同目录，或落在程序目录的 data/ 下
  // （process.execPath = .../SiYuan/SiYuan.exe，process.resourcesPath = .../SiYuan/resources）
  try {
    const exeDir = env.execPath ? path.dirname(env.execPath) : "";
    if (exeDir) {
      wsCandidates.push(
        path.join(exeDir, "workspace.json"),
        path.join(exeDir, "data", "workspace.json"),
      );
    }
    const resDir = env.resourcesPath;
    if (resDir) {
      const progDir = path.dirname(resDir);
      wsCandidates.push(
        path.join(progDir, "workspace.json"),
        path.join(progDir, "data", "workspace.json"),
      );
    }
  } catch { /* ignore */ }
  for (const wsFile of wsCandidates) {
    try {
      if (!fsOps.existsSync(wsFile)) continue;
      const raw = JSON.parse(fsOps.readFileSync(wsFile, "utf-8"));
      // 兼容多种 workspace.json 格式：数组 / {workspaces} / {data}
      const list = Array.isArray(raw) ? raw : (raw.workspaces || raw.data || []);
      for (const ws of list) {
        const p = typeof ws === "string" ? ws : (ws && ws.path) || "";
        if (p) pushCand(path.join(p, "data", "plugins", PLUGIN_NAME));
      }
    } catch { /* ignore parse errors */ }
  }

  // 3. cwd 相对路径
  pushCand(path.join(env.cwd, "data", "plugins", PLUGIN_NAME));
  pushCand(path.join(env.cwd, "..", "data", "plugins", PLUGIN_NAME));

  // 4. this.path 也加入候选
  if (env.thisPath) pushCand(env.thisPath);

  // 遍历候选，找第一个严格符合插件目录特征的
  for (const r of candidates) {
    if (!r) continue;
    if (isPluginRoot(r)) return r;
  }

  // 兜底：若 thisPath/dirname 是 asar，绝不能再当 base
  const rawFallback = env.thisPath || dirname || ".";
  if (isAsarPath(rawFallback)) return "";
  return rawFallback;
}
