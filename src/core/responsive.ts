/**
 * 响应式布局工具（2026-08-29 移动端适配 Phase 5）
 * ------------------------------------------------------------------
 * 提供"屏幕尺寸 / 软键盘状态 / 设备能力"三类查询。
 * 全插件判断"在移动端 / 小屏 / 软键盘弹起"等都应走本文件，
 * 避免散落写 `window.innerWidth < 600` 这种 magic number。
 *
 * 与 env.ts 的关系：
 *  - env.ts 关心"是什么设备"（iPhone / iPad / Android / Desktop）
 *  - responsive.ts 关心"现在能用的视口是多少"（屏幕、视口、软键盘）
 * 两者正交，env 决定交互模式，responsive 决定 UI 尺寸。
 */

/** 屏幕断点（与 SiYuan B3 设计 token 对齐） */
export const BREAKPOINTS = {
  /** 小屏手机（portrait） */
  phone: 480,
  /** 大屏手机 / 小平板（portrait iPad mini） */
  largePhone: 600,
  /** 平板 / 桌面（横屏 iPad） */
  tablet: 768,
  /** 桌面 */
  desktop: 1024,
} as const;

export type BreakpointKey = keyof typeof BREAKPOINTS;

/** 当前视口宽度（默认 window.innerWidth，但可被 visualViewport 替代） */
export function viewportWidth(): number {
  if (typeof window === "undefined") return BREAKPOINTS.desktop;
  // visualViewport 在移动端更准（不包含被软键盘推走的部分）
  const vv = (window as any).visualViewport;
  if (vv && typeof vv.width === "number" && vv.width > 0) return vv.width;
  return window.innerWidth;
}

/** 当前视口高度 */
export function viewportHeight(): number {
  if (typeof window === "undefined") return BREAKPOINTS.desktop;
  const vv = (window as any).visualViewport;
  if (vv && typeof vv.height === "number" && vv.height > 0) return vv.height;
  return window.innerHeight;
}

/** 软键盘是否弹起（仅在移动端 + 视口高度被压时为 true） */
export function isSoftKeyboardOpen(): boolean {
  if (typeof window === "undefined") return false;
  const vv = (window as any).visualViewport;
  if (!vv) return false;
  // 经验值：键盘弹起会压缩 visualViewport 至少 ~150px
  const shrunk = window.innerHeight - vv.height;
  return shrunk > 150;
}

/** 断点判定（粗粒度；与 deviceClass 不完全等价） */
export function isPhoneSize(): boolean {
  return viewportWidth() <= BREAKPOINTS.phone;
}
export function isLargePhoneOrSmallTablet(): boolean {
  const w = viewportWidth();
  return w > BREAKPOINTS.phone && w <= BREAKPOINTS.tablet;
}
export function isTabletOrLarger(): boolean {
  return viewportWidth() > BREAKPOINTS.tablet;
}

/**
 * 响应式宽度换算：给定"设计宽度"（桌面默认），按视口宽度折算。
 *  - phone（≤480）：designWidth * 0.92 - 16px
 *  - largePhone（≤600）：designWidth * 0.85
 *  - tablet（≤1024）：designWidth * 0.7
 *  - desktop：原样
 *
 * 用途：所有 Dialog / Popup 的 width 从固定 px 改为"在视口内可放下"。
 *  - width=720px 的设置 dialog，在 360px iPhone 上 = 360*0.92-16 = 315px
 *  - width=720px 的设置 dialog，在 768px iPad 上 = 720*0.7 = 504px（仍合理）
 *  - width=720px 的设置 dialog，在 1280px desktop 上 = 720px
 *
 * @param designWidth 桌面默认宽度（px）
 * @param min 不低于这个值（默认 280）
 * @param max 不超过 designWidth
 */
export function responsiveWidth(designWidth: number, min = 280, max?: number): number {
  const vw = viewportWidth();
  const cap = max ?? designWidth;
  if (vw >= cap) return Math.min(designWidth, cap);
  if (vw <= BREAKPOINTS.phone) {
    return Math.max(min, Math.min(cap, Math.round(vw * 0.92 - 16)));
  }
  if (vw <= BREAKPOINTS.largePhone) {
    return Math.max(min, Math.min(cap, Math.round(designWidth * 0.85)));
  }
  if (vw <= BREAKPOINTS.tablet) {
    return Math.max(min, Math.min(cap, Math.round(designWidth * 0.7)));
  }
  return Math.min(designWidth, cap);
}

/**
 * 响应式 height 换算（与 width 独立）
 *  - phone（≤480）：视口高度的 75%
 *  - largePhone（≤600）：80%
 *  - tablet（≤1024）：85%
 *  - desktop：原样
 */
export function responsiveHeight(designHeight: number, min = 280, max?: number): number {
  const vh = viewportHeight();
  const cap = max ?? designHeight;
  if (vh >= cap) return Math.min(designHeight, cap);
  if (vh <= BREAKPOINTS.phone) {
    return Math.max(min, Math.min(cap, Math.round(vh * 0.75)));
  }
  if (vh <= BREAKPOINTS.largePhone) {
    return Math.max(min, Math.min(cap, Math.round(vh * 0.8)));
  }
  if (vh <= BREAKPOINTS.tablet) {
    return Math.max(min, Math.min(cap, Math.round(vh * 0.85)));
  }
  return Math.min(designHeight, cap);
}

/**
 * 像素 → CSS 长度（响应式 Dialog 推荐用法）
 *  - 桌面：原样返回
 *  - 移动端：包成 "calc(100vw - Npx)" / "calc(100vh - Npx)"，
 *    让思源 Dialog 直接铺满视口（更适合触屏交互）
 *
 * 用法：
 * ```ts
 * new Dialog({
 *   title: "设置",
 *   width: responsiveDialogSize(720, "width"),
 *   ...
 * });
 * ```
 */
export function responsiveDialogSize(designPx: number, axis: "width" | "height"): string {
  if (typeof window === "undefined") return `${designPx}px`;
  if (axis === "width") {
    const vw = viewportWidth();
    if (vw <= BREAKPOINTS.phone) return `calc(100vw - 16px)`;
    if (vw <= BREAKPOINTS.largePhone) return `calc(100vw - 32px)`;
    if (vw <= BREAKPOINTS.tablet) return `calc(100vw - 64px)`;
    return `${designPx}px`;
  } else {
    const vh = viewportHeight();
    if (vh <= BREAKPOINTS.phone) return `calc(100vh - 32px)`;
    if (vh <= BREAKPOINTS.largePhone) return `calc(100vh - 64px)`;
    if (vh <= BREAKPOINTS.tablet) return `calc(100vh - 96px)`;
    return `${designPx}px`;
  }
}

/* ------------------------------------------------------------------
 * visualViewport 监听：iOS 软键盘 / Android 输入法弹起时主动通知
 * ------------------------------------------------------------------ */

/** visualViewport 变化监听器 */
export interface ViewportListener {
  /** 视口尺寸变化（旋转、软键盘、地址栏收起等） */
  onResize: (info: { width: number; height: number; keyboardOpen: boolean }) => void;
}

/**
 * 注册 visualViewport / window resize 监听，返回 dispose 函数。
 * 内部去重 + 合并 rAF；用于浮动工具栏 / 输入框定位等需要在键盘弹起时重排的 UI。
 *
 * 浏览器兼容：visualViewport 是标准 API，Chrome 61+/Safari 13+。无此 API 时降级到 window resize。
 */
export function watchViewport(listener: ViewportListener): () => void {
  if (typeof window === "undefined") return () => {};

  let raf = 0;
  let lastW = 0;
  let lastH = 0;
  let lastKeyboard = false;
  const fire = () => {
    raf = 0;
    const w = viewportWidth();
    const h = viewportHeight();
    const keyboardOpen = isSoftKeyboardOpen();
    if (w === lastW && h === lastH && keyboardOpen === lastKeyboard) return;
    lastW = w;
    lastH = h;
    lastKeyboard = keyboardOpen;
    listener.onResize({ width: w, height: h, keyboardOpen });
  };
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(fire);
  };

  const vv = (window as any).visualViewport;
  if (vv && typeof vv.addEventListener === "function") {
    vv.addEventListener("resize", schedule);
    // scroll 事件在 iOS 软键盘弹起时也会触发
    vv.addEventListener("scroll", schedule);
  } else {
    // 降级：仅监听 window resize（无 visualViewport 时代）
    window.addEventListener("resize", schedule);
  }

  // 立即 fire 一次，让 listener 拿到初始值
  schedule();

  return () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (vv && typeof vv.removeEventListener === "function") {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
    } else {
      window.removeEventListener("resize", schedule);
    }
  };
}
