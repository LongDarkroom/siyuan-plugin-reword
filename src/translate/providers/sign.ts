/**
 * 翻译引擎签名工具
 * ------------------------------------------------------------------
 * 腾讯 / 有道 / 百度 三家机器翻译都要求「服务端签名」才能调用，且因 CORS /
 * 密钥安全原因不能在前端直连，必须走思源内核 forwardProxy。
 *
 * 本文件提供：
 *  - sha256Hex / hmacSha256Hex：基于 Web Crypto（crypto.subtle），浏览器
 *    / Electron 渲染进程可用，与 reader-tts.ts 同款做法。
 *  - md5Hex：百度翻译需要 MD5，Web Crypto 不含 MD5，故内联一个纯 JS 实现
 *    （零依赖，约 50 行），避免引入额外依赖。
 *  - 所有函数为「可注入」设计：provider 默认用上述实现，测试可注入 mock。
 */

/** Web Crypto 句柄（浏览器 / Electron / Node>=20 均自带 globalThis.crypto） */
function getCrypto(): Crypto {
  const c = (globalThis as any).crypto;
  if (!c || !c.subtle) throw new Error("Web Crypto 不可用，签名失败");
  return c as Crypto;
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const c = getCrypto();
  const buf = await c.subtle.digest("SHA-256", data as BufferSource);
  return new Uint8Array(buf);
}

export async function sha256Hex(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const digest = await sha256Bytes(bytes);
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const c = getCrypto();
  const cryptoKey = await c.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await c.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data) as BufferSource);
  return new Uint8Array(sig);
}

export async function hmacSha256Hex(key: string | Uint8Array, data: string): Promise<string> {
  const keyBytes = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const sig = await hmacSha256(keyBytes, data);
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 二进制 → 小写十六进制 */
export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * TC3 链式 HMAC-SHA256（腾讯云签名规范）。
 *
 * ⚠️ 关键：每一轮必须用上一轮的**二进制**结果作为下一轮的 key。
 * 若把中间结果先转成 hex 字符串再当 key，key 会从 32 字节变成 64 字节 ASCII，
 * 与规范不等价，腾讯云必然返回 SignatureFailure。
 *
 * @param key 首轮密钥（字符串按 UTF-8 编码）
 * @param steps 依次参与链式计算的数据（date → service → "tc3_request" → stringToSign）
 * @returns 最终签名的二进制
 */
export async function hmacSha256Chain(
  key: string | Uint8Array,
  steps: string[]
): Promise<Uint8Array> {
  let cur: Uint8Array = typeof key === "string" ? new TextEncoder().encode(key) : key;
  for (const step of steps) {
    cur = await hmacSha256(cur, step);
  }
  return cur;
}

export async function hmacSha256Base64(key: string | Uint8Array, data: string): Promise<string> {
  const keyBytes = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const sig = await hmacSha256(keyBytes, data);
  // Uint8Array → base64
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

/* ===================== 纯 JS MD5（百度签名用） ===================== */
function md5State(): number[] {
  return [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
}

function rotl(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c));
}

function md5Block(s: number[], block: Uint8Array): void {
  const a0 = s[0], b0 = s[1], c0 = s[2], d0 = s[3];
  const m = new Array<number>(16);
  for (let i = 0; i < 16; i++) {
    m[i] = (block[i * 4] | (block[i * 4 + 1] << 8) | (block[i * 4 + 2] << 16) | (block[i * 4 + 3] << 24)) >>> 0;
  }
  let A = a0, B = b0, C = c0, D = d0;
  // 标准 MD5 常量表：K[idx] = floor(abs(sin(idx + 1)) * 2^32)，idx = 0..63。
  const K = (idx: number) =>
    (Math.floor(Math.abs(Math.sin(idx + 1)) * 4294967296)) >>> 0;
  // ⚠️ 调用处传入的步序号是 1..64，需映射到标准下标 0..63（此前未减 1，导致常量整体错位）。
  const T = (i: number) => K(i - 1);
  const F = (x: number, y: number, z: number) => (x & y) | (~x & z);
  const G = (x: number, y: number, z: number) => (x & z) | (y & ~z);
  const H = (x: number, y: number, z: number) => x ^ y ^ z;
  const I = (x: number, y: number, z: number) => y ^ (x | ~z);
  // ⚠️ 标准 MD5 每步必须「循环左移 s 位」后再加 b；此前实现漏掉 rotl，导致摘要全错。
  const FF = (a: number, b: number, c: number, d: number, k: number, s: number, i: number) => {
    const n = (a + F(b, c, d) + k + T(i)) >>> 0;
    return (rotl(n, s) + b) >>> 0;
  };
  const GG = (a: number, b: number, c: number, d: number, k: number, s: number, i: number) => {
    const n = (a + G(b, c, d) + k + T(i)) >>> 0;
    return (rotl(n, s) + b) >>> 0;
  };
  const HH = (a: number, b: number, c: number, d: number, k: number, s: number, i: number) => {
    const n = (a + H(b, c, d) + k + T(i)) >>> 0;
    return (rotl(n, s) + b) >>> 0;
  };
  const II = (a: number, b: number, c: number, d: number, k: number, s: number, i: number) => {
    const n = (a + I(b, c, d) + k + T(i)) >>> 0;
    return (rotl(n, s) + b) >>> 0;
  };
  // Round 1
  A = FF(A, B, C, D, m[0], 7, 1); D = FF(D, A, B, C, m[1], 12, 2); C = FF(C, D, A, B, m[2], 17, 3); B = FF(B, C, D, A, m[3], 22, 4);
  A = FF(A, B, C, D, m[4], 7, 5); D = FF(D, A, B, C, m[5], 12, 6); C = FF(C, D, A, B, m[6], 17, 7); B = FF(B, C, D, A, m[7], 22, 8);
  A = FF(A, B, C, D, m[8], 7, 9); D = FF(D, A, B, C, m[9], 12, 10); C = FF(C, D, A, B, m[10], 17, 11); B = FF(B, C, D, A, m[11], 22, 12);
  A = FF(A, B, C, D, m[12], 7, 13); D = FF(D, A, B, C, m[13], 12, 14); C = FF(C, D, A, B, m[14], 17, 15); B = FF(B, C, D, A, m[15], 22, 16);
  // Round 2
  A = GG(A, B, C, D, m[1], 5, 17); D = GG(D, A, B, C, m[6], 9, 18); C = GG(C, D, A, B, m[11], 14, 19); B = GG(B, C, D, A, m[0], 20, 20);
  A = GG(A, B, C, D, m[5], 5, 21); D = GG(D, A, B, C, m[10], 9, 22); C = GG(C, D, A, B, m[15], 14, 23); B = GG(B, C, D, A, m[4], 20, 24);
  A = GG(A, B, C, D, m[9], 5, 25); D = GG(D, A, B, C, m[14], 9, 26); C = GG(C, D, A, B, m[3], 14, 27); B = GG(B, C, D, A, m[8], 20, 28);
  A = GG(A, B, C, D, m[13], 5, 29); D = GG(D, A, B, C, m[2], 9, 30); C = GG(C, D, A, B, m[7], 14, 31); B = GG(B, C, D, A, m[12], 20, 32);
  // Round 3
  A = HH(A, B, C, D, m[5], 4, 33); D = HH(D, A, B, C, m[8], 11, 34); C = HH(C, D, A, B, m[11], 16, 35); B = HH(B, C, D, A, m[14], 23, 36);
  A = HH(A, B, C, D, m[1], 4, 37); D = HH(D, A, B, C, m[4], 11, 38); C = HH(C, D, A, B, m[7], 16, 39); B = HH(B, C, D, A, m[10], 23, 40);
  A = HH(A, B, C, D, m[13], 4, 41); D = HH(D, A, B, C, m[0], 11, 42); C = HH(C, D, A, B, m[3], 16, 43); B = HH(B, C, D, A, m[6], 23, 44);
  A = HH(A, B, C, D, m[9], 4, 45); D = HH(D, A, B, C, m[12], 11, 46); C = HH(C, D, A, B, m[15], 16, 47); B = HH(B, C, D, A, m[2], 23, 48);
  // Round 4
  A = II(A, B, C, D, m[0], 6, 49); D = II(D, A, B, C, m[7], 10, 50); C = II(C, D, A, B, m[14], 15, 51); B = II(B, C, D, A, m[5], 21, 52);
  A = II(A, B, C, D, m[12], 6, 53); D = II(D, A, B, C, m[3], 10, 54); C = II(C, D, A, B, m[10], 15, 55); B = II(B, C, D, A, m[1], 21, 56);
  A = II(A, B, C, D, m[8], 6, 57); D = II(D, A, B, C, m[15], 10, 58); C = II(C, D, A, B, m[6], 15, 59); B = II(B, C, D, A, m[13], 21, 60);
  A = II(A, B, C, D, m[4], 6, 61); D = II(D, A, B, C, m[11], 10, 62); C = II(C, D, A, B, m[2], 15, 63); B = II(B, C, D, A, m[9], 21, 64);
  s[0] = (s[0] + A) >>> 0;
  s[1] = (s[1] + B) >>> 0;
  s[2] = (s[2] + C) >>> 0;
  s[3] = (s[3] + D) >>> 0;
}

export function md5Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const len = bytes.length;
  const s = md5State();
  const blockSize = 64;
  const paddedLen = ((len + 8) >> 6 << 6) + 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(bytes);
  buf[len] = 0x80;
  // 长度位（小端，bit 数）
  const bitLen = len * 8;
  buf[paddedLen - 8] = bitLen & 0xff;
  buf[paddedLen - 7] = (bitLen >>> 8) & 0xff;
  buf[paddedLen - 6] = (bitLen >>> 16) & 0xff;
  buf[paddedLen - 5] = (bitLen >>> 24) & 0xff;
  buf[paddedLen - 4] = (bitLen / 0x100000000) & 0xff;
  buf[paddedLen - 3] = ((bitLen / 0x100000000) >>> 8) & 0xff;
  buf[paddedLen - 2] = ((bitLen / 0x100000000) >>> 16) & 0xff;
  buf[paddedLen - 1] = ((bitLen / 0x100000000) >>> 24) & 0xff;
  for (let off = 0; off < paddedLen; off += blockSize) {
    md5Block(s, buf.subarray(off, off + blockSize));
  }
  // ⚠️ MD5 输出为「小端字节序」：每个 32 位状态字按低字节在前输出 4 个字节。
  // 直接 v.toString(16) 是大端打印，会得到错误的摘要（曾导致百度签名校验失败）。
  const out = s
    .map((v) => {
      let r = "";
      for (let i = 0; i < 4; i++) {
        r += (((v >>> (i * 8)) & 0xff).toString(16)).padStart(2, "0");
      }
      return r;
    })
    .join("");
  return out;
}
