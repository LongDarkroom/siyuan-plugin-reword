/**
 * 免费翻译引擎单元测试（腾讯 / 有道 / 百度）
 * ------------------------------------------------------------------
 * 验证四件事：
 *  1. **签名算法黄金对照**（以 node:crypto 为准）——曾踩过三个坑：
 *     ① MD5 漏掉每步循环左移；② MD5 常量表下标差 1；③ 腾讯 TC3 链式 HMAC
 *     用 hex 字符串而非二进制当下一轮 key。三者都会让签名校验失败、静默落到 AI 兜底。
 *  2. 签名/请求正常发出（mock PostFn 不依赖真实网络与密钥）；
 *  3. 多段输入时结果「同序对齐」（索引不乱）；
 *  4. 腾讯内部按 8 段/批分桶；有道/百度逐段请求。
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { TencentTranslator } from "../src/translate/providers/tencent.ts";
import { YoudaoTranslator } from "../src/translate/providers/youdao.ts";
import { BaiduTranslator } from "../src/translate/providers/baidu.ts";
import {
  md5Hex,
  sha256Hex,
  hmacSha256Hex,
  hmacSha256Chain,
  bytesToHex,
} from "../src/translate/providers/sign.ts";
import { isEngineAvailable, isTencentLocked, buildProviders } from "../src/translate/engine.ts";

/* ===================== 签名黄金对照 ===================== */

test("MD5：与 node:crypto 逐向量一致（百度签名依赖）", () => {
  const vectors = [
    "",
    "abc",
    "hello",
    "20260830123456",
    "message digest",
    "The quick brown fox jumps over the lazy dog",
    "中文也需要正确",
  ];
  for (const s of vectors) {
    const expect = crypto.createHash("md5").update(s, "utf8").digest("hex");
    assert.equal(md5Hex(s), expect, `md5(${JSON.stringify(s)}) 不匹配`);
  }
});

test("SHA256 hex：与 node:crypto 一致", async () => {
  for (const s of ["abc", "hello world"]) {
    const expect = crypto.createHash("sha256").update(s, "utf8").digest("hex");
    assert.equal(await sha256Hex(s), expect);
  }
});

test("HMAC-SHA256 单次：与 node:crypto 一致", async () => {
  for (const [k, d] of [["key", "hello"], ["TC3secret", "2026-08-30"]]) {
    const expect = crypto.createHmac("sha256", Buffer.from(k, "utf8")).update(d, "utf8").digest("hex");
    assert.equal(await hmacSha256Hex(k, d), expect);
  }
});

test("腾讯 TC3 链式 HMAC：必须用二进制中间值，与规范实现一致", async () => {
  const secretKey = "test-secret-key-123";
  const steps = ["2026-08-30", "tmt", "tc3_request", "TC3-HMAC-SHA256\n1234567890\nsig"];
  // 规范：每轮以上一轮二进制结果为 key
  const h = (keyBuf, data) => crypto.createHmac("sha256", keyBuf).update(data, "utf8").digest();
  let cur = Buffer.from("TC3" + secretKey, "utf8");
  for (const st of steps) cur = h(cur, st);
  const expect = cur.toString("hex");

  assert.equal(bytesToHex(await hmacSha256Chain("TC3" + secretKey, steps)), expect);
});

/** 通用 mock：从请求里抽出原文段，回贴「译」后缀，保持顺序 */
function makeMockPost() {
  const calls = [];
  const post = async (url, headers, payload) => {
    calls.push({ url, headers, payload });
    let texts = [];
    if (url.includes("tencentcloudapi")) {
      texts = JSON.parse(payload).SourceTextList;
      return {
        status: 200,
        body: JSON.stringify({
          Response: { TranslationList: texts.map((t) => ({ TargetText: t ? t + "译" : "" })) },
        }),
      };
    }
    if (url.includes("youdao")) {
      texts = [new URLSearchParams(url.split("?")[1]).get("q")].filter(Boolean);
      return {
        status: 200,
        body: JSON.stringify({ errorCode: "0", translation: texts.map((t) => t + "译") }),
      };
    }
    // baidu
    texts = [new URLSearchParams(url.split("?")[1]).get("q")].filter(Boolean);
    return {
      status: 200,
      body: JSON.stringify({ trans_result: texts.map((t) => ({ dst: t + "译" })) }),
    };
  };
  return { post, calls };
}

const REQ = (texts) => ({ texts, from: "en", to: "zh" });

test("腾讯：多段同序对齐 + 自动分桶（10 段 → 2 次请求，8+2）", async () => {
  const { post, calls } = makeMockPost();
  const tr = new TencentTranslator("id", "key", { post });
  const src = Array.from({ length: 10 }, (_, i) => `seg${i}`);
  const out = await tr.translate(REQ(src));
  assert.equal(out.length, 10);
  assert.deepEqual(out, src.map((s) => s + "译"));
  assert.equal(calls.length, 2, "应自动按 8 段/批分桶");
  // 第一批 8 段，第二批 2 段
  assert.equal(JSON.parse(calls[0].payload).SourceTextList.length, 8);
  assert.equal(JSON.parse(calls[1].payload).SourceTextList.length, 2);
});

test("腾讯：空输入返回等长空串", async () => {
  const { post } = makeMockPost();
  const tr = new TencentTranslator("id", "key", { post });
  const out = await tr.translate(REQ(["", "hello", ""]));
  assert.deepEqual(out, ["", "hello译", ""]);
});

test("腾讯：未配置时 available=false 且调用抛错", async () => {
  const tr = new TencentTranslator("", "");
  assert.equal(tr.available, false);
  await assert.rejects(() => tr.translate(REQ(["x"])));
});

test("有道：逐段请求 + 同序对齐", async () => {
  const { post, calls } = makeMockPost();
  const tr = new YoudaoTranslator("ak", "as", { post });
  const src = ["one", "two", "three"];
  const out = await tr.translate(REQ(src));
  assert.deepEqual(out, src.map((s) => s + "译"));
  assert.equal(calls.length, 3, "有道逐段请求");
});

test("百度：逐段请求 + 同序对齐", async () => {
  const { post, calls } = makeMockPost();
  const tr = new BaiduTranslator("appid", "key", { post });
  const src = ["alpha", "beta"];
  const out = await tr.translate(REQ(src));
  assert.deepEqual(out, src.map((s) => s + "译"));
  assert.equal(calls.length, 2, "百度逐段请求");
});

test("百度：未配置时 available=false", () => {
  assert.equal(new BaiduTranslator("", "").available, false);
});

/* ===================== 引擎可用性与用量锁 ===================== */

test("isEngineAvailable：仅当启用+已配置+未锁定时返回 true", () => {
  const base = {
    tencentEnabled: true, tencentSecretId: "id", tencentSecretKey: "key",
    youdaoEnabled: true, youdaoAppKey: "ak", youdaoAppSecret: "as",
    baiduEnabled: true, baiduAppId: "id", baiduKey: "key",
    msEnabled: true, msKey: "k", msRegion: "r",
    libreEnabled: true, libreUrl: "https://libre",
    aiEnabled: true, aiApiKey: "sk",
  };
  assert.equal(isEngineAvailable("tencent", base), true);
  assert.equal(isEngineAvailable("youdao", base), true);
  assert.equal(isEngineAvailable("baidu", base), true);
  assert.equal(isEngineAvailable("microsoft", base), true);
  assert.equal(isEngineAvailable("libretranslate", base), true);
  assert.equal(isEngineAvailable("ai", base), true);
  // 缺密钥则不可用
  assert.equal(isEngineAvailable("tencent", { ...base, tencentSecretId: "" }), false);
  // 未启用则不可用
  assert.equal(isEngineAvailable("youdao", { ...base, youdaoEnabled: false }), false);
});

test("isTencentLocked：达到设定上限后锁定", () => {
  assert.equal(isTencentLocked({ tencentCharsUsed: 0, tencentCharsLock: 4_000_000 }), false);
  assert.equal(isTencentLocked({ tencentCharsUsed: 3_999_999, tencentCharsLock: 4_000_000 }), false);
  assert.equal(isTencentLocked({ tencentCharsUsed: 4_000_000, tencentCharsLock: 4_000_000 }), true);
  assert.equal(isTencentLocked({ tencentCharsUsed: 5_000_000, tencentCharsLock: 4_000_000 }), true);
  // 默认锁 400 万
  assert.equal(isTencentLocked({ tencentCharsUsed: 4_000_001 }), true);
});

test("buildProviders：engine=auto 按 priority 链；engine=tencent 仅腾讯+AI", () => {
  const cfg = {
    tencentEnabled: true, tencentSecretId: "id", tencentSecretKey: "key",
    youdaoEnabled: true, youdaoAppKey: "ak", youdaoAppSecret: "as",
    aiEnabled: true, aiApiKey: "sk",
    priority: ["youdao", "tencent"],
  };
  const deps = { translateOne: async (t) => t };
  const auto = buildProviders(cfg, deps, "auto");
  assert.equal(auto.map((p) => p.name).join(","), "youdao,tencent,ai");
  const tencentOnly = buildProviders(cfg, deps, "tencent");
  assert.equal(tencentOnly.map((p) => p.name).join(","), "tencent,ai");
  const aiOnly = buildProviders(cfg, deps, "ai");
  assert.equal(aiOnly.map((p) => p.name).join(","), "ai");
});

test("buildProviders：腾讯达到用量锁后被跳过", () => {
  const cfg = {
    tencentEnabled: true, tencentSecretId: "id", tencentSecretKey: "key",
    tencentCharsUsed: 4_000_000, tencentCharsLock: 4_000_000,
    priority: ["tencent"],
  };
  const deps = { translateOne: async (t) => t };
  const providers = buildProviders(cfg, deps, "auto");
  assert.equal(providers.map((p) => p.name).join(","), "ai");
});
