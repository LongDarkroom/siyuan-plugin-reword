// 签发 REword 激活码（持有私钥，离线签发）
//
// 用法：
//   node scripts/issue-license.mjs --device <设备码> [--plan pro] [--days 365]
//   node scripts/issue-license.mjs --any              # 不绑定设备（浮动许可）
//
// 设备码：在插件「设置 → 许可证」面板中复制「本机设备码」。
// 私钥：scripts/license.key.pem（已 gitignore，切勿外泄）。
import { readFileSync } from "node:fs";
import { createPrivateKey, sign as ecSign } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Node crypto.sign() 输出 DER 编码的 ECDSA 签名，而浏览器 Web Crypto subtle.verify
// 要求 IEEE P1363 的 raw r||s 格式。这里解析 DER 并转成两个固定长度(32B)的大端整数。
function derToRawSig(der, size = 32) {
  let i = 0;
  const readLen = () => {
    const b = der[i++];
    if (b < 0x80) return b;
    let len = 0;
    for (let j = 0; j < b - 0x80; j++) len = len * 256 + der[i++];
    return len;
  };
  if (der[i++] !== 0x30) throw new Error("bad DER: expected SEQUENCE");
  readLen();
  if (der[i++] !== 0x02) throw new Error("bad DER: expected INTEGER r");
  let rLen = readLen();
  let r = der.subarray(i, i + rLen); i += rLen;
  if (der[i++] !== 0x02) throw new Error("bad DER: expected INTEGER s");
  let sLen = readLen();
  let s = der.subarray(i, i + sLen);
  r = r[0] === 0 ? r.subarray(1) : r; // 去掉前导 0x00
  s = s[0] === 0 ? s.subarray(1) : s;
  const pad = (buf, n) => {
    if (buf.length > n) throw new Error("signature component too long");
    const out = Buffer.alloc(n);
    buf.copy(out, n - buf.length);
    return out;
  };
  return Buffer.concat([pad(r, size), pad(s, size)]);
}
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--device") out.device = argv[++i];
    else if (a === "--plan") out.plan = argv[++i];
    else if (a === "--days") out.days = parseInt(argv[++i], 10);
    else if (a === "--any") out.any = true;
    else if (a === "--out") out.out = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.any && !args.device) {
  console.error("错误：必须指定 --device <设备码> 或 --any");
  process.exit(1);
}
const device = args.any ? "ANY" : args.device;
const plan = args.plan || "pro";
const days = args.days ?? 365;
const exp = days > 0 ? Date.now() + days * 86400000 : 0;

const keyPem = readFileSync(join(__dirname, "license.key.pem"), "utf8");
const privateKey = createPrivateKey(keyPem);

const payload = {
  v: 1,
  dev: device,
  iat: Date.now(),
  exp,
  plan,
};
const canonical = `${payload.v}|${payload.dev}|${payload.iat}|${payload.exp}|${payload.plan}`;
// Node 产出 DER 签名，必须转成 raw r||s（浏览器 Web Crypto subtle.verify 的格式）
const sigDer = ecSign("sha256", Buffer.from(canonical, "utf8"), privateKey);
const sig = derToRawSig(sigDer);
const code = b64url(JSON.stringify({ ...payload, sig: b64url(sig) }));

console.log("签发成功，激活码如下（复制给用户，粘贴进插件设置）：\n");
console.log(code);
console.log(
  `\n元数据：plan=${plan} 设备=${device} 有效期=${days > 0 ? days + " 天" : "永久"}`
);
if (args.out) {
  writeFileSync(args.out, code, "utf8");
  console.log(`已写入 ${args.out}`);
}
