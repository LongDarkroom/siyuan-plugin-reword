// 生成 REword 许可证密钥对（一次性运行）
//   - 公钥（SPKI PEM）内嵌进 src/license/license.ts 供运行时验签
//   - 私钥（PKCS#8 PEM）写入 scripts/license.key.pem（已加入 .gitignore，切勿提交）
//
// 运行：node scripts/gen-license-keys.mjs
import { webcrypto } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function derToPem(der, type) {
  const b64 = Buffer.from(der).toString("base64");
  const wrapped = b64.match(/.{1,64}/g).join("\n");
  return `-----BEGIN ${type}-----\n${wrapped}\n-----END ${type}-----\n`;
}

const { subtle } = webcrypto;
const { publicKey, privateKey } = await subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);

const pubDer = await subtle.exportKey("spki", publicKey);
const privDer = await subtle.exportKey("pkcs8", privateKey);
const pubPem = derToPem(pubDer, "PUBLIC KEY");
const privPem = derToPem(privDer, "PRIVATE KEY");

mkdirSync(__dirname, { recursive: true });
writeFileSync(join(__dirname, "license.key.pem"), privPem, "utf8");
writeFileSync(join(__dirname, "license.key.pub.pem"), pubPem, "utf8");

console.log("私钥已写入 scripts/license.key.pem（请勿提交到仓库）");
console.log("公钥（SPKI PEM），请将下方内容粘贴到 src/license/license.ts 的 LICENSE_PUBLIC_KEY_PEM：\n");
console.log(pubPem);
