/**
 * 有道智云文本翻译（signType=v3）
 * ------------------------------------------------------------------
 * - 免费额度：新用户有试用额度。
 * - 鉴权：sha256(appKey + input(原文前 10~20 字) + salt + curtime + appSecret)。
 * - 批量：单次 q 最大 5000 字节；内部按字符切分多段、逐批请求。
 * - CORS：必须走思源内核 forwardProxy（带签名，前端不可直连）。
 * - 目标语言：简体中文用 "zh-CHS"。
 */
import type { Translator, TranslateRequest } from "../types.ts";
import { sha256Hex } from "./sign.ts";
import type { PostFn } from "./tencent.ts";

const YOUDAO_URL = "https://openapi.youdao.com/api";
const MAX_Q_CHARS = 1800; // 单段上限（留余量，避免超 5000 字节）

export class YoudaoTranslator implements Translator {
  readonly name = "youdao" as const;

  private appKey: string;
  private appSecret: string;
  private post: PostFn;

  constructor(appKey: string, appSecret: string, opts?: { post?: PostFn }) {
    this.appKey = appKey;
    this.appSecret = appSecret;
    this.post = opts?.post ?? defaultPost;
  }

  get available(): boolean {
    return !!(this.appKey && this.appSecret);
  }

  async translate(req: TranslateRequest): Promise<string[]> {
    if (!this.available) throw new Error("有道翻译未配置 AppKey/AppSecret");

    const from = req.from && req.from !== "auto" ? req.from : "auto";
    const to = req.to === "zh" ? "zh-CHS" : req.to;

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
    const curtime = String(Math.floor(Date.now() / 1000));
    // input：原文前 20 字符（超过 20 则取前 10 + 后 10）
    const input = q.length <= 20 ? q : q.slice(0, 10) + q.slice(q.length - 10);
    const sign = await sha256Hex(this.appKey + input + salt + curtime + this.appSecret);

    const params = new URLSearchParams({
      q,
      from,
      to,
      appKey: this.appKey,
      salt,
      sign,
      signType: "v3",
      curtime,
    });

    const res = await this.post(
      `${YOUDAO_URL}?${params.toString()}`,
      { "Content-Type": "application/x-www-form-urlencoded" },
      "" // GET 风格（有道 v3 用 query）
    );
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`有道翻译请求失败 (${res.status}): ${res.body.slice(0, 200)}`);
    }
    const data = JSON.parse(res.body || "{}") as any;
    if (data.errorCode && data.errorCode !== "0") {
      throw new Error(`有道翻译错误: ${data.errorCode}`);
    }
    return data.translation?.[0] ?? "";
  }
}

/** 默认 POST：经思源内核代理转发 */
async function defaultPost(
  url: string,
  headers: Record<string, string>,
  _payload: string
): Promise<{ status: number; body: string }> {
  const { forwardProxyRaw } = await import("../../siyuan/api.ts");
  const r = await forwardProxyRaw({
    url,
    method: "GET",
    headers,
  });
  return { status: r.status, body: r.body };
}
