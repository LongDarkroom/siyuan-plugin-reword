/**
 * 阅读器 - 键盘快捷键（注册表 + 冲突检测 + hint overlay 数据源）
 * --------------------------------------------------------------------
 * - 12 项快捷键注册表（←→翻页 / Home/End 跳头尾 / Space 下一段 / Ctrl± 字号 /
 *   Ctrl+F 搜索 / Ctrl+B 书签 / Ctrl+T TTS / Ctrl+S 设置 / Ctrl+Shift+L 主题 /
 *   F11 全屏 / ? 显隐 hint / Esc 关闭浮窗）
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
  | "closeOverlay";

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

/** 完整快捷键注册表（12 项；不含 ?/Esc 因为它们无修饰键，单独处理） */
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
];

/** 无修饰键快捷键（独立处理） */
export const NO_MODIFIER_SHORTCUTS: Array<{ action: ShortcutAction; label: string; key: string }> = [
  { action: "showHint",     label: "显示/隐藏快捷键面板",   key: "?" },
  { action: "closeOverlay", label: "关闭浮窗 / 退出全屏",  key: "Escape" },
];

/** 把 keydown 事件匹配到 ShortcutAction；无匹配返回 null */
export function matchShortcut(e: KeyboardEvent, isMac: boolean): ShortcutAction | null {
  // 跳过输入框内（让 input/textarea 正常接收）
  const target = e.target as HTMLElement | null;
  if (target) {
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
      return null;
    }
  }

  // 无修饰键（? / Escape）
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    for (const spec of NO_MODIFIER_SHORTCUTS) {
      if (e.key === spec.key) return spec.action;
    }
    // Space / Arrow / Home / End
    for (const spec of READER_SHORTCUTS) {
      if (spec.ctrl || spec.cmd || spec.shift) continue;
      if (e.key === spec.key) return spec.action;
    }
    return null;
  }

  // 有修饰键
  for (const spec of READER_SHORTCUTS) {
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
export function detectConflicts(siyuanReserved: Array<{ ctrl?: boolean; cmd?: boolean; shift?: boolean; key: string }>): ShortcutSpec[] {
  const conflicts: ShortcutSpec[] = [];
  for (const spec of READER_SHORTCUTS) {
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
export function getHintLines(): Array<{ keys: string; label: string }> {
  const lines: Array<{ keys: string; label: string }> = [];
  for (const spec of READER_SHORTCUTS) {
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
    for (const c of detectConflicts(siyuanReserved)) {
      this.conflicts.add(c.action);
    }
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
    const action = matchShortcut(e, this.isMac);
    if (!action) return;
    if (this.conflicts.has(action)) return; // 与思源冲突，跳过
    const handler = this.handlers[action];
    if (!handler) return;
    e.preventDefault();
    void handler();
  }
}
