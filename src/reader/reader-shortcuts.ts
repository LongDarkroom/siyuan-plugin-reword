/**
 * 阅读器 - 键盘快捷键（注册表 + 冲突检测 + hint overlay 数据源）
 * --------------------------------------------------------------------
 * - 18 项快捷键注册表（←→翻页 / Home/End 跳头尾 / Space 下一段 / Ctrl± 字号 /
 *   Ctrl+F 搜索 / Ctrl+B 书签 / Ctrl+T TTS / Ctrl+S 设置 / Ctrl+Shift+L 主题 /
 *   F11 全屏 / Ctrl ± 0 1 2 3 PDF 缩放 / ? 显隐 hint / Esc 关闭浮窗）
 * - 冲突检测：与思源全局快捷键冲突时跳过（不抢），由 ReaderHint 标注
 * - 跨平台：Mac 用 Cmd，其它用 Ctrl
 * - 注册/注销生命周期：mount 时注册，dispose 时清理（避免热重载泄漏）
 * - 测试：reader-shortcuts.test.mjs（注册表完整性 + 冲突检测 + 键位匹配）
 *
 * 不依赖：annotation / vocab / ai / dict（reader 内部独立）
 */

export type ShortcutAction =
  | "prevPage"
  | "nextPage"
  | "prevSection"
  | "nextSection"
  | "goStart"
  | "goEnd"
  | "fontIncrease"
  | "fontDecrease"
  | "openSearch"
  | "toggleBookmark"
  | "openTTS"
  | "openSettings"
  | "toggleTheme"
  | "toggleFullscreen"
  | "showHint"
  | "closeOverlay"
  // [REword patch 2026-08-29] PDF 缩放（参考 Obsidian PDF++ 风格）
  | "zoomIn"            // Cmd/Ctrl + =    放大到下一档
  | "zoomOut"           // Cmd/Ctrl + -    缩小到上一档
  | "zoomReset"         // Cmd/Ctrl + 0    重置到 fit-page
  | "fitWidth"          // Cmd/Ctrl + 1    适应宽度
  | "fitPage"           // Cmd/Ctrl + 2    适应整页
  | "cycleZoomPreset";  // Cmd/Ctrl + 3    循环切换预设档位（50/75/100/125/150/200%）

export interface ShortcutSpec {
  action: ShortcutAction;
  /** 人类可读标签（hint overlay 用） */
  label: string;
  /** Windows/Linux 修饰键（与 ctrlKey 一起使用） */
  ctrl?: boolean;
  /** Mac 修饰键（与 metaKey 一起使用） */
  cmd?: boolean;
  /** Shift 键 */
  shift?: boolean;
  /** Alt/Option 键 */
  alt?: boolean;
  /** 主键（不区分大小写）；特殊键用 'ArrowLeft' / 'Home' 等 */
  key: string;
}

/** 完整快捷键注册表（18 项；不含 ?/Esc 因为它们无修饰键，单独处理） */
export const READER_SHORTCUTS: ShortcutSpec[] = [
  { action: "prevPage",       label: "上一页",                key: "ArrowLeft" },
  { action: "nextPage",       label: "下一页",                key: "ArrowRight" },
  { action: "prevSection",    label: "上一段（连续滚动）",      key: "ArrowUp" },
  { action: "nextSection",    label: "下一段（连续滚动）",      key: "ArrowDown" },
  { action: "goStart",        label: "跳到开头",               key: "Home" },
  { action: "goEnd",          label: "跳到结尾",               key: "End" },
  { action: "nextSection",    label: "下一段（Space）",        key: " " },
  { action: "fontIncrease",   label: "字号 +",   ctrl: true, cmd: true,  key: "=" },
  { action: "fontDecrease",   label: "字号 -",   ctrl: true, cmd: true,  key: "-" },
  { action: "openSearch",     label: "搜索",     ctrl: true, cmd: true,  key: "f" },
  { action: "toggleBookmark", label: "添加/移除书签", ctrl: true, cmd: true,  key: "b" },
  { action: "openTTS",        label: "TTS 朗读",  ctrl: true, cmd: true,  key: "t" },
  { action: "openSettings",   label: "设置",      ctrl: true, cmd: true,  key: "s" },
  { action: "toggleTheme",    label: "切换主题（明/暗）", ctrl: true, cmd: true, shift: true, key: "l" },
  { action: "toggleFullscreen", label: "全屏",  key: "F11" },
  // [REword patch 2026-08-29] PDF 缩放快捷键（参考 Obsidian PDF++）
  // 注意：fontIncrease / fontDecrease 跟 zoomIn / zoomOut 都用 "=" / "-"，
  // 实际触发哪个由"当前是否在 PDF"决定（ReaderView 内部按格式分流）。
  { action: "zoomIn",         label: "PDF 放大",    ctrl: true, cmd: true,  key: "=" },
  { action: "zoomOut",        label: "PDF 缩小",    ctrl: true, cmd: true,  key: "-" },
  { action: "zoomReset",      label: "PDF 重置缩放", ctrl: true, cmd: true,  key: "0" },
  { action: "fitWidth",       label: "PDF 适应宽度", ctrl: true, cmd: true,  key: "1" },
  { action: "fitPage",        label: "PDF 适应整页", ctrl: true, cmd: true,  key: "2" },
  { action: "cycleZoomPreset",label: "PDF 切换缩放档位", ctrl: true, cmd: true,  key: "3" },
];

/** 无修饰键快捷键（独立处理） */
export const NO_MODIFIER_SHORTCUTS: Array<{ action: ShortcutAction; label: string; key: string }> = [
  { action: "showHint",     label: "显示/隐藏快捷键面板",   key: "?" },
  { action: "closeOverlay", label: "关闭浮窗 / 退出全屏",  key: "Escape" },
];

/** 用户自定义覆盖表：action → 部分字段（未给的字段沿用默认） */
export type ShortcutOverride = Partial<
  Pick<ShortcutSpec, "ctrl" | "cmd" | "shift" | "alt" | "key">
>;

/**
 * 合并自定义覆盖与默认表（2026-10-06 快捷键自定义 UI）。
 *
 * 设计要点：**按 action 合并**而非整表替换 —— 用户只改想改的项，
 * 其余动作的默认键位必须原样保留（否则会出现"改一个键崩一堆"的体验）。
 * 未在 `overrides` 里出现的 action 走 `READER_SHORTCUTS` 原值。
 */
export function mergeShortcuts(overrides?: Record<string, ShortcutOverride> | null): ShortcutSpec[] {
  if (!overrides) return READER_SHORTCUTS;
  return READER_SHORTCUTS.map((spec) => {
    const ov = overrides[spec.action];
    if (!ov) return spec;
    const merged: ShortcutSpec = { ...spec };
    // key 必须存在且非空，否则该动作会变成"匹配不到任何键"
    if (typeof ov.key === "string" && ov.key.trim()) merged.key = ov.key.trim();
    // 修饰键允许显式给 false（用于取消某个修饰键），故用 in 判断后逐项赋值
    if ("ctrl" in ov) merged.ctrl = ov.ctrl;
    if ("cmd" in ov) merged.cmd = ov.cmd;
    if ("shift" in ov) merged.shift = ov.shift;
    if ("alt" in ov) merged.alt = ov.alt;
    return merged;
  });
}

/** 把 keydown 事件匹配到 ShortcutAction；无匹配返回 null
 *  @param overrides 用户自定义键位（快捷键设置面板写入）
 */
export function matchShortcut(
  e: KeyboardEvent,
  isMac: boolean,
  overrides?: Record<string, ShortcutOverride> | null,
): ShortcutAction | null {
  // 跳过输入框内（让 input/textarea 正常接收）
  const target = e.target as HTMLElement | null;
  if (target) {
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
      return null;
    }
  }

  const table = mergeShortcuts(overrides);

  // 无修饰键（? / Escape）
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    for (const spec of NO_MODIFIER_SHORTCUTS) {
      if (e.key === spec.key) return spec.action;
    }
    // Space / Arrow / Home / End
    for (const spec of table) {
      if (spec.ctrl || spec.cmd || spec.shift) continue;
      if (e.key === spec.key) return spec.action;
    }
    return null;
  }

  // 有修饰键
  for (const spec of table) {
    if (spec.ctrl || spec.cmd) {
      const wantMod = isMac ? e.metaKey : e.ctrlKey;
      if (!wantMod) continue;
      if (isMac && spec.cmd && !e.metaKey) continue;
      if (!isMac && spec.ctrl && !e.ctrlKey) continue;
    } else {
      // 该快捷键无修饰键要求，但当前有修饰键 → 不匹配
      continue;
    }
    if (!!spec.shift !== e.shiftKey) continue;
    if (e.altKey) continue; // 我们的快捷键不用 alt
    if (e.key.toLowerCase() === spec.key.toLowerCase()) return spec.action;
  }
  return null;
}

/** 探测与思源全局快捷键冲突（粗略：以相同 key 组合视为冲突）
 *  spec.ctrl/cmd 表示「Mac/Win 任一侧有修饰键即视为匹配」（双平台共用） */
export function detectConflicts(
  siyuanReserved: Array<{ ctrl?: boolean; cmd?: boolean; shift?: boolean; key: string }>,
  overrides?: Record<string, ShortcutOverride> | null,
): ShortcutSpec[] {
  const conflicts: ShortcutSpec[] = [];
  for (const spec of mergeShortcuts(overrides)) {
    for (const reserved of siyuanReserved) {
      const keyMatch = spec.key.toLowerCase() === reserved.key.toLowerCase();
      if (!keyMatch) continue;
      // spec 的 ctrl/cmd 只要任一与 reserved 匹配 → 视为冲突（双平台共通）
      const modCtrlOk =
        (spec.ctrl && reserved.ctrl) || (spec.cmd && reserved.cmd) ||
        (!spec.ctrl && !spec.cmd && !reserved.ctrl && !reserved.cmd);
      const modShiftOk = !!spec.shift === !!reserved.shift;
      if (modCtrlOk && modShiftOk) {
        conflicts.push(spec);
        break;
      }
    }
  }
  return conflicts;
}

/** 生成 hint overlay 文本（按行） */
export function getHintLines(overrides?: Record<string, ShortcutOverride> | null): Array<{ keys: string; label: string }> {
  const lines: Array<{ keys: string; label: string }> = [];
  for (const spec of mergeShortcuts(overrides)) {
    lines.push({
      keys: formatKeys(spec),
      label: spec.label,
    });
  }
  for (const spec of NO_MODIFIER_SHORTCUTS) {
    lines.push({
      keys: spec.key === "?" ? "?" : spec.key,
      label: spec.label,
    });
  }
  return lines;
}

function formatKeys(spec: ShortcutSpec): string {
  const parts: string[] = [];
  if (spec.ctrl) parts.push("Ctrl");
  if (spec.cmd) parts.push("Cmd");
  if (spec.shift) parts.push("Shift");
  parts.push(spec.key === " " ? "Space" : spec.key);
  return parts.join(" + ");
}

/** 快捷键控制器：mount 时绑定到 rootEl，dispose 时解绑 */
export class ShortcutController {
  private rootEl: HTMLElement;
  private isMac: boolean;
  private siyuanReserved: Array<{ ctrl?: boolean; cmd?: boolean; shift?: boolean; key: string }>;
  private bound: ((e: KeyboardEvent) => void) | null = null;
  private handlers: Partial<Record<ShortcutAction, () => void | Promise<void>>> = {};
  private conflicts: Set<ShortcutAction> = new Set();
  /** 用户自定义键位（2026-10-06 快捷键设置）；setOverrides 可在运行期替换 */
  private overrides: Record<string, ShortcutOverride> | null = null;

  constructor(
    rootEl: HTMLElement,
    isMac: boolean = false,
    /** 思源全局保留快捷键（如思源内置 Ctrl+F 搜索）；本控制器会跳过这些 */
    siyuanReserved: Array<{ ctrl?: boolean; cmd?: boolean; shift?: boolean; key: string }> = []
  ) {
    this.rootEl = rootEl;
    this.isMac = isMac;
    this.siyuanReserved = siyuanReserved;
    // 探测冲突
    for (const c of detectConflicts(siyuanReserved, this.overrides)) {
      this.conflicts.add(c.action);
    }
  }

  /**
   * 替换自定义键位并**重算冲突**（2026-10-06）。
   * 必须在改键后调用，否则冲突集合仍是旧的 —— 表现为"改完键位，
   * 与思源冲突的那一项仍被静默跳过"，且用户无从得知。
   */
  setOverrides(overrides: Record<string, ShortcutOverride> | null): void {
    this.overrides = overrides && Object.keys(overrides).length ? overrides : null;
    this.conflicts = new Set(detectConflicts(this.siyuanReserved, this.overrides).map((c) => c.action));
  }

  /** 当前生效的键位表（默认值 + 用户覆盖） */
  getTable(): ShortcutSpec[] {
    return mergeShortcuts(this.overrides);
  }

  /** 注册 action 处理器 */
  on(action: ShortcutAction, handler: () => void | Promise<void>): void {
    this.handlers[action] = handler;
  }

  /** 启动监听（rootEl 获得焦点时） */
  start(): void {
    if (this.bound) return;
    this.bound = (e: KeyboardEvent) => this.handleKeydown(e);
    this.rootEl.addEventListener("keydown", this.bound as EventListener);
    // 让 rootEl 可获焦
    if (!this.rootEl.hasAttribute("tabindex")) {
      this.rootEl.setAttribute("tabindex", "-1");
    }
  }

  /** 停止监听 */
  stop(): void {
    if (this.bound && this.rootEl) {
      this.rootEl.removeEventListener("keydown", this.bound as EventListener);
    }
    this.bound = null;
  }

  /** 获取当前所有冲突的 action（hint overlay 标注用） */
  getConflicts(): ShortcutAction[] {
    return Array.from(this.conflicts);
  }

  private handleKeydown(e: KeyboardEvent): void {
    const action = matchShortcut(e, this.isMac, this.overrides);
    if (!action) return;
    if (this.conflicts.has(action)) return; // 与思源冲突，跳过
    const handler = this.handlers[action];
    if (!handler) return;
    e.preventDefault();
    void handler();
  }
}
