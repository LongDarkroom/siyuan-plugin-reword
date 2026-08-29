/**
 * 运行环境检测（移动端 / 触屏 / 平台）
 * ------------------------------------------------------------------
 * 移动端适配统一入口。全插件判断是否"在移动端 / 触屏"都应走本文件，
 * 不要再各处手写 `getFrontend().endsWith("mobile")`，避免散落与不一致。
 *
 * 依据 SiYuan 官方约定：
 *   getFrontend() → "desktop" | "desktop-window" | "mobile" | "browser-desktop" | "browser-mobile"
 *   （"mobile" 含 iOS/Android App；"browser-mobile" 含移动端浏览器）
 *
 * 历史：2026-08-29 移动端适配 Phase 0 引入，统一原先散落在
 * src/siyuan/api.ts 的 `const isMobile = getFrontend().endsWith('mobile')` 手写分支。
 */

import { getFrontend } from "siyuan";

/** 当前前端（容错包装，避免个别旧版本无 getFrontend 时抛错）。 */
export function currentFrontend(): string {
    try {
        return getFrontend();
    } catch {
        return "desktop";
    }
}

/** 是否移动端前端（含 App 与移动浏览器）。这是"是否走触摸交互"的主开关。 */
export function isMobile(): boolean {
    try {
        return currentFrontend().endsWith("mobile");
    } catch {
        return false;
    }
}

/** 是否触屏设备（移动端，或桌面带触摸）。用于决定是否绑定 pointer/touch 手势。 */
export function isTouchDevice(): boolean {
    if (isMobile()) return true;
    try {
        return "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0;
    } catch {
        return false;
    }
}

/**
 * 是否 iOS（iPad/iPhone/iPod）。
 * 主信号取 getFrontend()==="mobile" + UA 启发式（iPadOS 13+ 的 Safari 会伪装成 MacIntel，
 * 故 UA 仅作辅助；真正的"移动端"判定仍以 isMobile() 为准）。
 */
export function isIOS(): boolean {
    try {
        if (isMobile() && /iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
        return /iPad|iPhone|iPod/.test(navigator.userAgent);
    } catch {
        return false;
    }
}

/** 是否 Android（含移动浏览器）。 */
export function isAndroid(): boolean {
    try {
        if (isMobile() && /Android/.test(navigator.userAgent)) return true;
        return /Android/.test(navigator.userAgent);
    } catch {
        return false;
    }
}

/**
 * 设备分级（[REword patch 2026-08-29] 移动端 PDF 适配 Phase 1）
 * ----------------------------------------------------------------
 * 区分 5 类设备用于差异化体验：
 *  - 'ipad'           iPad（含 iPad mini / Air / Pro）— 完整功能
 *  - 'iphone'         iPhone（小屏）— 降级模式
 *  - 'android-tablet' Android 平板 — 完整功能
 *  - 'android-phone'  Android 手机（小屏）— 降级模式
 *  - 'desktop'        桌面（Electron / 浏览器）— 完整功能
 *
 * 判定优先级：
 *  1. isMobile() === true → mobile path
 *  2. UA 启发式（iPad / iPhone / Android）
 *  3. 屏幕尺寸（iPadOS 13+ Safari 伪装 MacIntel 时 fallback 到尺寸判断）
 */
export type DeviceClass = 'ipad' | 'iphone' | 'android-tablet' | 'android-phone' | 'desktop';

export function getDeviceClass(): DeviceClass {
    try {
        const mob = isMobile();
        const ua = navigator.userAgent;
        const w = typeof window !== 'undefined' ? window.innerWidth : 0;
        const h = typeof window !== 'undefined' ? window.innerHeight : 0;
        const maxDim = Math.max(w, h);
        // 桌面优先（思源 B 端 / Electron desktop）
        if (!mob && maxDim >= 600) return 'desktop';
        // iPad 优先：UA 含 iPad 或 iPadOS 13+ 伪装（MacIntel + touch）
        const isIPadUA = /iPad/.test(ua);
        const isIPadOS = maxDim >= 768 && (
            (navigator as any).maxTouchPoints > 0 &&
            (/Macintosh/.test(ua) || /MacIntel/.test(ua))
        );
        if (mob && (isIPadUA || isIPadOS || maxDim >= 768)) {
            return /iPad/.test(ua) || isIPadOS ? 'ipad' : 'android-tablet';
        }
        if (/iPhone|iPod/.test(ua)) return 'iphone';
        if (/Android/.test(ua)) {
            return maxDim >= 600 ? 'android-tablet' : 'android-phone';
        }
        // 兜底：移动端 + 屏幕小 → iphone 类降级
        if (mob && maxDim < 600) return 'iphone';
        return 'desktop';
    } catch {
        return 'desktop';
    }
}

/** 是否小屏移动设备（iPhone / Android Phone）— 用于降级模式 */
export function isSmallMobile(): boolean {
    const cls = getDeviceClass();
    return cls === 'iphone' || cls === 'android-phone';
}

/** 是否大屏移动设备（iPad / Android Tablet）— 完整模式 */
export function isLargeMobile(): boolean {
    const cls = getDeviceClass();
    return cls === 'ipad' || cls === 'android-tablet';
}
