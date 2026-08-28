import { logSwallow } from "../core/safe.ts";
/**
 * REword · 离线许可证激活模块
 * ------------------------------------------------------------------
 * 设计：非对称签名（ECDSA P-256 + SHA-256）。私钥在开发者本地签发激活码，
 * 公钥内嵌于此文件供运行时验签。用户无法伪造（没有私钥），但可逆向提取公钥
 * （无法用于伪造，仅能验证）——这是离线方案固有的、可接受的安全边界。
 *
 * 激活码 = base64url(JSON{ v, dev, iat, exp, plan, sig })
 *   - dev: 绑定的设备码（"ANY" 表示不绑定，浮动许可）
 *   - exp: 过期时间戳（0 = 永久）
 *   - sig: 对 canonical = `${v}|${dev}|${iat}|${exp}|${plan}` 的 ECDSA 签名（raw r||s）
 *
 * 设备绑定：优先取 window.siyuan.config.system.workspaceDir 的 SHA-256；
 * 不可用时回退到持久化的随机设备码。
 */
import { showMessage } from "siyuan";

/** 内嵌公钥（SPKI PEM）—— 由 scripts/gen-license-keys.mjs 生成，勿手改 */
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEGtuK2+UCR2a8r4iJ0z8V5C/lBoMi
a3i4MgSeGjVaSFkPZPsIYzDr2rlLjNz2bpgofP9SfXQfErcx0o88N+2ZLA==
-----END PUBLIC KEY-----`;

/** 受许可门禁保护的功能。空集合 = 全部免费；非空 = 需激活才可用 */
export const LICENSED_FEATURES = new Set<string>(["ai-deep-read"]);

const LICENSE_DATA_KEY = "hiword-license.json";
const DEVICE_ID_KEY = "hiword-device-id.json";
const CODE_VERSION = 1;

export interface LicensePayload {
  v: number;
  dev: string;
  iat: number;
  exp: number;
  plan: string;
  sig?: string;
}

export interface LicenseStatus {
  valid: boolean;
  plan: string;
  exp: number;
  iat?: number;
  reason?: string;
}

interface PersistIO {
  load: (key: string) => Promise<any>;
  save: (key: string, value: any) => Promise<void>;
}

// ───────────────────────── base64url（浏览器/Node 通用，不依赖 Buffer） ─────────────────────────
function b64urlEncodeBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecodeToBytes(s: string): Uint8Array {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlEncodeStr(s: string): string {
  return b64urlEncodeBytes(new TextEncoder().encode(s));
}
function b64urlDecodeStr(s: string): string {
  return new TextDecoder().decode(b64urlDecodeToBytes(s));
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  return b64urlDecodeToBytes(b64.replace(/-/g, "+").replace(/_/g, "/"));
}

// ───────────────────────── 模块状态 ─────────────────────────
let io: PersistIO | null = null;
let deviceId = "";
let currentCode: string | null = null;
let currentStatus: LicenseStatus = { valid: false, plan: "", exp: 0, reason: "未激活" };
let opener: (() => void) | null = null;
let pubKeyCache: CryptoKey | null = null;
let pubKeyCachePem = "";

function getCrypto(): Crypto | null {
  return (globalThis as any).crypto || null;
}

async function importPublicKey(pem: string): Promise<CryptoKey> {
  if (pubKeyCache && pubKeyCachePem === pem) return pubKeyCache;
  const c = getCrypto();
  if (!c?.subtle) throw new Error("Web Crypto 不可用，无法验证许可证");
  const der = pemToDer(pem);
  pubKeyCache = await c.subtle.importKey(
    "spki",
    der as BufferSource,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
  pubKeyCachePem = pem;
  return pubKeyCache;
}

/** 验证激活码（可注入公钥，便于测试）。返回结构化状态。 */
export async function verifyLicenseCode(
  code: string,
  devId: string,
  publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM
): Promise<LicenseStatus> {
  if (!code || !code.trim()) return { valid: false, plan: "", exp: 0, reason: "激活码为空" };
  let payload: LicensePayload;
  try {
    payload = JSON.parse(b64urlDecodeStr(code.trim()));
  } catch {
    return { valid: false, plan: "", exp: 0, reason: "激活码格式错误" };
  }
  if (!payload.sig) return { valid: false, plan: "", exp: 0, reason: "激活码缺少签名" };
  if (payload.v !== CODE_VERSION) return { valid: false, plan: "", exp: 0, reason: "激活码版本不兼容" };

  const canonical = `${payload.v}|${payload.dev}|${payload.iat}|${payload.exp}|${payload.plan}`;
  const sigBytes = b64urlDecodeToBytes(payload.sig);
  try {
    const pubKey = await importPublicKey(publicKeyPem);
    const c = getCrypto()!;
    const ok = await c.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pubKey,
      sigBytes as BufferSource,
      new TextEncoder().encode(canonical)
    );
    if (!ok) return { valid: false, plan: "", exp: 0, reason: "签名无效（可能被篡改）" };
  } catch (e) {
    return { valid: false, plan: "", exp: 0, reason: "验签失败：" + (e as Error).message };
  }

  // 签名有效后再检查时效性 / 设备绑定
  if (payload.exp && payload.exp !== 0 && payload.exp <= Date.now()) {
    return { valid: false, plan: payload.plan, exp: payload.exp, reason: "许可证已过期" };
  }
  if (payload.dev && payload.dev !== "ANY" && payload.dev !== devId) {
    return { valid: false, plan: payload.plan, exp: payload.exp, reason: "设备不匹配（本机未授权）" };
  }
  return { valid: true, plan: payload.plan, exp: payload.exp, iat: payload.iat };
}

/** 计算本机设备码（workspaceDir 哈希优先，回退持久化随机码） */
export async function getDeviceId(): Promise<string> {
  if (deviceId) return deviceId;
  const sys = (globalThis as any).window?.siyuan?.config?.system;
  const seed: string = sys?.workspaceDir || sys?.dataDir || "";
  const c = getCrypto();
  if (seed && c?.subtle) {
    const digest = await c.subtle.digest("SHA-256", new TextEncoder().encode(seed));
    deviceId = b64urlEncodeBytes(new Uint8Array(digest)).slice(0, 22);
    return deviceId;
  }
  // 回退：持久化随机码
  try {
    const stored = await io?.load(DEVICE_ID_KEY);
    if (stored?.id) {
      deviceId = stored.id;
      return deviceId;
    }
  } catch (__swallowErr) { logSwallow(__swallowErr, "license.ts · getDeviceId", "debug"); }
  const id = "dev-" + b64urlEncodeBytes(c ? c.getRandomValues(new Uint8Array(16)) : new Uint8Array(16));
  deviceId = id;
  try { await io?.save(DEVICE_ID_KEY, { id }); } catch (__swallowErr) { logSwallow(__swallowErr, "license.ts · getDeviceId", "debug"); }
  return deviceId;
}

/** 插件加载时调用：注入持久化 IO 并校验已存激活码 */
export async function initLicense(opts: PersistIO): Promise<void> {
  io = opts;
  await getDeviceId();
  try {
    const data = await io.load(LICENSE_DATA_KEY);
    if (data?.code) {
      currentCode = data.code;
      currentStatus = await verifyLicenseCode(data.code, deviceId);
      return;
    }
  } catch (__swallowErr) { logSwallow(__swallowErr, "license.ts · initLicense", "debug"); }
  currentStatus = { valid: false, plan: "", exp: 0, reason: "未激活" };
}

/** 激活：验签通过则持久化激活码 */
export async function activate(code: string): Promise<LicenseStatus> {
  const status = await verifyLicenseCode(code, deviceId);
  if (status.valid) {
    currentCode = code;
    try { await io?.save(LICENSE_DATA_KEY, { code, activatedAt: Date.now() }); } catch (__swallowErr) { logSwallow(__swallowErr, "license.ts · activate", "debug"); }
  }
  currentStatus = status;
  return status;
}

/** 解除激活 */
export async function deactivate(): Promise<void> {
  currentCode = null;
  currentStatus = { valid: false, plan: "", exp: 0, reason: "已解除激活" };
  try { await io?.save(LICENSE_DATA_KEY, {}); } catch (__swallowErr) { logSwallow(__swallowErr, "license.ts · deactivate", "debug"); }
}

export function isActivated(feature?: string): boolean {
  if (!currentStatus.valid) return false;
  if (feature) {
    // 未纳入门禁的功能一律放行；已纳入的，持有任何有效许可证即解锁
    if (!LICENSED_FEATURES.has(feature)) return true;
  }
  return currentStatus.valid;
}

export function isFeatureGated(feature: string): boolean {
  return LICENSED_FEATURES.has(feature);
}

export function getStatus(): LicenseStatus {
  return currentStatus;
}
export function getCode(): string | null {
  return currentCode;
}

/** 门禁：未激活则返回 false 并提示 + 打开设置。已激活返回 true。 */
export function requireLicense(feature?: string): boolean {
  if (isActivated(feature)) return true;
  try {
    showMessage("该功能需要激活许可证，请在「设置 → 许可证」中输入激活码。", 4000, "info");
  } catch (__swallowErr) { logSwallow(__swallowErr, "license.ts · requireLicense", "debug"); }
  try { openLicenseSettings(); } catch (__swallowErr) { logSwallow(__swallowErr, "license.ts · requireLicense", "debug"); }
  return false;
}

export function setOpener(fn: () => void): void {
  opener = fn;
}
export function openLicenseSettings(): void {
  try { opener?.(); } catch (__swallowErr) { logSwallow(__swallowErr, "license.ts · openLicenseSettings", "debug"); }
}
