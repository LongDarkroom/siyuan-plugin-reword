// 许可证激活模块回归测试
// 覆盖：验签链路（DER→raw 兼容）、设备绑定、过期、篡改、浮动 ANY、空输入。
// 运行（license.ts 依赖 siyuan 桩）：
//   node --experimental-loader=./test/siyuan-stub-loader.mjs --experimental-strip-types test/license.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as ecSign, createPrivateKey } from "node:crypto";
import { verifyLicenseCode } from "../src/license/license.ts";

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 与 scripts/issue-license.mjs 同源的 DER→raw 转换（Node sign 输出 DER，Web Crypto 需要 IEEE P1363 raw r||s）
function derToRawSig(der, size = 32) {
  let i = 0;
  const readLen = () => {
    const b = der[i++];
    if (b < 0x80) return b;
    let len = 0;
    for (let j = 0; j < b - 0x80; j++) len = len * 256 + der[i++];
    return len;
  };
  if (der[i++] !== 0x30) throw new Error("bad DER: SEQUENCE");
  readLen();
  if (der[i++] !== 0x02) throw new Error("bad DER: INTEGER r");
  let rLen = readLen();
  let r = der.subarray(i, i + rLen); i += rLen;
  if (der[i++] !== 0x02) throw new Error("bad DER: INTEGER s");
  let sLen = readLen();
  let s = der.subarray(i, i + sLen);
  r = r[0] === 0 ? r.subarray(1) : r;
  s = s[0] === 0 ? s.subarray(1) : s;
  const pad = (buf, n) => {
    if (buf.length > n) throw new Error("component too long");
    const out = Buffer.alloc(n);
    buf.copy(out, n - buf.length);
    return out;
  };
  return Buffer.concat([pad(r, size), pad(s, size)]);
}

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pubPem = publicKey.export({ type: "spki", format: "pem" });
const privPem = privateKey.export({ type: "pkcs8", format: "pem" });

function makeCode(dev, expDays, plan = "pro") {
  const payload = { v: 1, dev, iat: Date.now(), exp: expDays !== 0 ? Date.now() + expDays * 86400000 : 0, plan };
  const canonical = `${payload.v}|${payload.dev}|${payload.iat}|${payload.exp}|${payload.plan}`;
  const sig = derToRawSig(ecSign("sha256", Buffer.from(canonical, "utf8"), createPrivateKey(privPem)));
  return b64url(Buffer.from(JSON.stringify({ ...payload, sig: b64url(sig) })));
}

test("1) 有效激活码：正确设备 + 未过期 → valid", async () => {
  const st = await verifyLicenseCode(makeCode("dev-a", 365), "dev-a", pubPem);
  assert.equal(st.valid, true);
  assert.equal(st.plan, "pro");
  assert.ok(st.exp > Date.now());
  assert.ok(typeof st.iat === "number" && st.iat > 0, "iat 应为正整数时间戳");
});

test("2) 设备不匹配 → 拒绝", async () => {
  const st = await verifyLicenseCode(makeCode("dev-a", 365), "dev-b", pubPem);
  assert.equal(st.valid, false);
  assert.match(st.reason || "", /设备不匹配/);
});

test("3) 过期 → 拒绝", async () => {
  const st = await verifyLicenseCode(makeCode("dev-a", -1), "dev-a", pubPem);
  assert.equal(st.valid, false);
  assert.match(st.reason || "", /过期/);
});

test("4) 篡改签名 → 拒绝", async () => {
  const good = makeCode("dev-a", 365);
  const tampered = good.slice(0, -4) + "AAAA";
  const st = await verifyLicenseCode(tampered, "dev-a", pubPem);
  assert.equal(st.valid, false);
});

test("5) 浮动 ANY：任意设备可用", async () => {
  const st = await verifyLicenseCode(makeCode("ANY", 365), "whatever-dev", pubPem);
  assert.equal(st.valid, true);
});

test("6) 永久许可 exp=0", async () => {
  const st = await verifyLicenseCode(makeCode("dev-a", 0), "dev-a", pubPem);
  assert.equal(st.valid, true);
});

test("7) 空 / 乱码输入 → 拒绝", async () => {
  assert.equal((await verifyLicenseCode("", "dev-a", pubPem)).valid, false);
  assert.equal((await verifyLicenseCode("   ", "dev-a", pubPem)).valid, false);
  assert.equal((await verifyLicenseCode("not-a-code", "dev-a", pubPem)).valid, false);
});

test("8) 错误公钥验签 → 拒绝（防误配公钥）", async () => {
  const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const otherPub = other.publicKey.export({ type: "spki", format: "pem" });
  const st = await verifyLicenseCode(makeCode("dev-a", 365), "dev-a", otherPub);
  assert.equal(st.valid, false);
});
