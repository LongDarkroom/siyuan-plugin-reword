import { createHmac } from "node:crypto";
import { sha256Hex, hmacSha256Chain, bytesToHex } from "../src/translate/providers/sign.ts";

const secretId = "AKIDz8krbsJ5yKBZQpn74WFkmLPx3*******";
const secretKey = "Gu5t9xGARNpq86cd98joQYCN3*******";
const service = "tmt";
const host = "tmt.tencentcloudapi.com";
const timestamp = 1551113065;
const date = "2019-02-25";

const payload = JSON.stringify({ SourceTextList: ["hello"], Source: "auto", Target: "zh", ProjectId: 0 });
const hashedPayload = await sha256Hex(payload);
const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
const signedHeaders = "content-type;host";
const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
const credentialScope = `${date}/${service}/tc3_request`;
const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;

const sig = await hmacSha256Chain("TC3" + secretKey, [date, service, "tc3_request", stringToSign]);
const signature = bytesToHex(sig);

const secretDate = createHmac("sha256", "TC3" + secretKey).update(date).digest();
const secretService = createHmac("sha256", secretDate).update(service).digest();
const secretSigning = createHmac("sha256", secretService).update("tc3_request").digest();
const nodeSig = createHmac("sha256", secretSigning).update(stringToSign).digest("hex");

console.log("signature:", signature);
console.log("node sig :", nodeSig);
console.log("match:", signature === nodeSig);
console.log("canonicalRequest:\n" + canonicalRequest);
console.log("stringToSign:\n" + stringToSign);
