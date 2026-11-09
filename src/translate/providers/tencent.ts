/**
 * 腾讯云机器翻译 TMT（TextTranslateBatch）
 * ------------------------------------------------------------------
 * - 免费额度：每月 500 万字符（标准版）。
 * - 鉴权：TC3-HMAC-SHA256 签名（SecretId / SecretKey）。
 * - 批量：单次最多 8 段，每段 ≤ 1800 字符（内部再分桶兜底）。
 * - CORS：必须走思源内核 forwardProxy（带签名，前端不可直连）。
 * - 目标语言：简体中文用 "zh"（腾讯 TMT 直接接受 zh）。
 */
import type { Translator, TranslateRequest } from "../types.ts";
import { hmacSha256Chain, bytesToHex, sha256Hex } from "./sign.ts";

/** POST 适配器（生产 = 思源 forwardProxy；测试 = mock） */
export type PostFn = (
  url: string,
  headers: Record<string, string>,
  payload: string,
  contentType?: string
) => Promise<{ status: number; body: string }>;

const TENCENT_HOST = "tmt.tencentcloudapi.com";
const TENCENT_ENDPOINT = `https://${TENCENT_HOST}/`;
const TENCENT_SERVICE = "tmt";
const TENCENT_REGION = "ap-guangzhou";
const TENCENT_ACTION = "TextTranslateBatch";
const TENCENT_VERSION = "2018-03-21";
const MAX_SEGMENTS = 8;
const MAX_SEGMENT_CHARS = 1800;

/**
 * 签名调试开关（2026-10-03）。
 * 默认关闭：签名详情含 Credential 与原文，绝不能无条件进控制台。
 * 需要排查签名时在控制台执行：
 *   localStorage.setItem("reword:debug-tencent-sign", "1")
 */
function tencentSignDebug(): boolean {
  try {
    return localStorage.getItem("reword:debug-tencent-sign") === "1";
  } catch {
    return false;
  }
}

/** 掩码 Authorization 里的 SecretId：AKID****ABCD（保留首尾各 4 位，便于核对是否配错） */
function maskCredential(authorization: string): string {
  return authorization.replace(/(Credential=)([A-Za-z0-9]{4})[A-Za-z0-9]+/g, "$1$2****");
}

export class TencentTranslator implements Translator {
  readonly name = "tencent" as const;

  private secretId: string;
  private secretKey: string;
  private post: PostFn;

  constructor(secretId: string, secretKey: string, opts?: { post?: PostFn }) {
    this.secretId = (secretId || "").trim();
    this.secretKey = (secretKey || "").trim();
    this.post = opts?.post ?? defaultPost;
  }

  get available(): boolean {
    return !!(this.secretId && this.secretKey);
  }

  async translate(req: TranslateRequest): Promise<string[]> {
    if (!this.available) throw new Error("腾讯翻译未配置 SecretId/SecretKey");

    const from = req.from && req.from !== "auto" ? req.from : "auto";
    const to = req.to === "zh" ? "zh" : req.to;

    // 内部分桶：每段 ≤ MAX_SEGMENT_CHARS，每批 ≤ MAX_SEGMENTS
    const buckets = this.bucketize(req.texts);
    const out: string[] = new Array(req.texts.length).fill("");

    let cursor = 0;
    for (const bucket of buckets) {
      const indices = bucket.indices;
      const texts = bucket.texts;
      const result = await this.callOnce(texts, from, to);
      indices.forEach((origIdx, j) => {
        out[origIdx] = result[j] ?? "";
      });
      cursor += indices.length;
    }
    void cursor;
    return out;
  }

  private bucketize(texts: string[]): Array<{ indices: number[]; texts: string[] }> {
    const buckets: Array<{ indices: number[]; texts: string[] }> = [];
    let cur: { indices: number[]; texts: string[] } = { indices: [], texts: [] };
    for (let i = 0; i < texts.length; i++) {
      const t = (texts[i] || "").slice(0, MAX_SEGMENT_CHARS);
      if (cur.texts.length >= MAX_SEGMENTS) {
        buckets.push(cur);
        cur = { indices: [], texts: [] };
      }
      cur.indices.push(i);
      cur.texts.push(t);
    }
    if (cur.texts.length) buckets.push(cur);
    return buckets;
  }

  private async callOnce(texts: string[], from: string, to: string): Promise<string[]> {
    const payload = JSON.stringify({
      SourceTextList: texts,
      Source: from,
      Target: to,
      ProjectId: 0,
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const contentType = "application/json; charset=utf-8";

    const hashedPayload = await sha256Hex(payload);
    const canonicalHeaders = `content-type:${contentType}\nhost:${TENCENT_HOST}\n`;
    const signedHeaders = "content-type;host";
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
    const credentialScope = `${date}/${TENCENT_SERVICE}/tc3_request`;
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;

    // TC3 链式签名：每轮用上一轮的二进制结果作为 key（不能用 hex 字符串，否则签名校验失败）
    const sigBytes = await hmacSha256Chain("TC3" + this.secretKey, [
      date,
      TENCENT_SERVICE,
      "tc3_request",
      stringToSign,
    ]);
    const signature = bytesToHex(sigBytes);

    const authorization =
      `TC3-HMAC-SHA256 Credential=${this.secretId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    // 2026-10-03 安全加固：原为无条件 console.debug，每次翻译请求都把
    //   authorization（含 Credential=<SecretId>/...）与 payload（用户书籍原文）
    //   打进开发者控制台，且已随构建产物分发。现改为「默认关闭的调试开关」，
    //   即使打开也对 SecretId 掩码、payload 只报字节数。
    //   排查签名：控制台执行 localStorage.setItem("reword:debug-tencent-sign","1")。
    if (tencentSignDebug()) {
      // eslint-disable-next-line no-console
      console.debug("[REword] 腾讯签名详情", {
        canonicalRequest,
        stringToSign,
        authorization: maskCredential(authorization),
        payloadBytes: payload.length,
        timestamp,
        date,
      });
    }

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      Host: TENCENT_HOST,
      Authorization: authorization,
      "X-TC-Action": TENCENT_ACTION,
      "X-TC-Version": TENCENT_VERSION,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Region": TENCENT_REGION,
    };

    // ⚠️ 必须让思源 forwardProxy 实际发出的 Content-Type 与签名时一致，
    // 否则腾讯云会报 AuthFailure.SignatureFailure。
    const res = await this.post(TENCENT_ENDPOINT, headers, payload, contentType);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`腾讯翻译请求失败 (${res.status}): ${res.body.slice(0, 200)}`);
    }
    const data = JSON.parse(res.body || "{}") as any;
    if (data.Response && data.Response.Error) {
      throw new Error(`腾讯翻译错误: ${data.Response.Error.Code} ${data.Response.Error.Message}`);
    }
    // 2026-08-31 修复（P0 级）：腾讯云 TMT `TextTranslateBatch` 批量接口实际返回
    // 的是 `TargetTextList`（直接字符串数组，顺序与 SourceTextList 对齐），
    // 而非 `TranslationList`。旧字段名错误导致译文恒为空 → 触发 AI 兜底 → 60s 超时
    // → 双语页面永远不显示释义。实测响应：{Response:{TargetTextList:[...],UsedAmount:N}}
    const targetTextList = data.Response?.TargetTextList;
    if (Array.isArray(targetTextList)) return targetTextList;
    // 兼容旧/单句结构（极少走此分支，仅作防御）
    const legacyList: Array<{ TargetText?: string }> = data.Response?.TranslationList || [];
    return legacyList.map((d) => d?.TargetText ?? "");
  }
}

/** 默认 POST：经思源内核代理转发（绕 CORS + 签名安全） */
async function defaultPost(
  url: string,
  headers: Record<string, string>,
  payload: string,
  contentType?: string
): Promise<{ status: number; body: string }> {
  const { forwardProxyRaw } = await import("../../siyuan/api.ts");
  const r = await forwardProxyRaw({
    url,
    method: "POST",
    headers,
    payload,
    // 与签名时用的 content-type 保持一致；不传则思源默认 application/json
    contentType: contentType || "application/json",
  });
  return { status: r.status, body: r.body };
}
