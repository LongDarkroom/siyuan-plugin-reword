/**
 * siyuan SDK 测试桩
 * ------------------------------------------------------------------
 * `siyuan` npm 包是纯类型包（package.json exports 只有 .d.ts，无 JS 实现），
 * Node 测试环境直接 import 会报 ERR_PACKAGE_PATH_NOT_EXPORTED。
 * 本桩提供 src 中实际用到的符号的最小 no-op 实现，仅保证模块可加载；
 * 测试不调用真实 UI/网络能力（相关函数在测试中不应被触发）。
 */
export class Plugin {}
export class Setting {}
export class Dialog {}
export class Protyle {}
export class Lute {}
export class App {}

export function showMessage() {}
export function fetchPost() {
  return Promise.reject(new Error("siyuan stub: fetchPost 不应在测试中被调用"));
}
export function fetchSyncPost() {
  return Promise.reject(new Error("siyuan stub: fetchSyncPost 不应在测试中被调用"));
}
export function openTab() {}
export function openMobileFileById() {}
export function getFrontend() {
  return { desktop: true, mobile: false, browser: false };
}
export function getActiveEditor() {
  return null;
}

export const Constants = {};
export const platformUtils = {};
export const IWebSocketData = {};

// 2026-08-23 扩展：src/reader/reader-fonts.ts 等需要 siyuan 桩
export const putFile = async () => false;
export const getFileBlob = async () => null;
export const removeFile = async () => undefined;
