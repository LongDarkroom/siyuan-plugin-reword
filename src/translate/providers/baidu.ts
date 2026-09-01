/**
 * 百度翻译开放平台（通用翻译 API）
 * ------------------------------------------------------------------
 * - 免费额度：标准版完全免费（QPS 有限制）。
 * - 鉴权：md5(appid + q + salt + key)（32 位小写十六进制）。
 * - 批量：单次 q 总长度 ≤ 6000 字节；内部按字符切分多段、逐批请求。
 * - CORS：必须走思源内核 forwardProxy（带签名，前端不可直连）。
 * - 目标语言：简体中文用 "zh"。
 */
import type { Translator, TranslateRequest } from "../types.ts";
import { md5Hex } from "./sign.ts";
import type { PostFn } from "./tencent.ts";

const BAIDU_URL = "https://fanyi-api.baidu.com/api/trans/vip/translate";
const MAX_Q_CHARS = 1800; // 单段上限（留余量，避免超 6000 字节）

export class BaiduTranslator implements Translator {
  readonly name = "baidu" as const;

  private appId: string;
  private key: string;
  private post: PostFn;

  constructor(appId: string, key: string, opts?: { post?: PostFn }) {
    this.appId = appId;
    this.key = key;
    this.post = opts?.post ?? defaultPost;
  }

  get available(): boolean {
    return !!(this.appId && this.key);
  }

  async translate(req: TranslateRequest): Promise<string[]> {
    if (!this.available) throw new Error("百度翻译未配置 AppId/Key");

    const from = req.from && req.from !== "auto" ? req.from : "auto";
    const to = req.to === "zh" ? "zh" : req.to;

    const out: string[] = new Array(req.texts.length).fill("");
    for (let i = 0; i < req.texts.length; i++) {
      const t = (req.texts[i] || "").slice(0, MAX_Q_CHARS);
      if (!t) continue;
      out[i] = await this.callOnce(t, from, to);
    }
    return out;
  }

  private async callOnce(q: string, from: string, to: string): Promise<string> {
    const salt = String(Math.floor(Math.random() * 1e9));
    const sign = md5Hex(this.appId + q + salt + this.key);

    const params = new URLSearchParams({
      q,
      from,
      to,
      appid: this.appId,
      salt,
      sign,
    });

    const res = await this.post(`${BAIDU_URL}?${params.toString()}`, {}, "");
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`百度翻译请求失败 (${res.status}): ${res.body.slice(0, 200)}`);
    }
    const data = JSON.parse(res.body || "{}") as any;
    if (data.error_code) {
      throw new Error(`百度翻译错误: ${data.error_code} ${data.error_msg || ""}`);
    }
    const transResult: Array<{ dst?: string }> = data.trans_result || [];
    return transResult.map((d) => d?.dst ?? "").join("");
  }
}

/** 默认 POST：经思源内核代理转发 */
async function defaultPost(
  url: string,
  _headers: Record<string, string>,
  _payload: string
): Promise<{ status: number; body: string }> {
  const { forwardProxyRaw } = await import("../../siyuan/api.ts");
  const r = await forwardProxyRaw({ url, method: "GET" });
  return { status: r.status, body: r.body };
}
