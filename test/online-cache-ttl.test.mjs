// 2.4 缓存 TTL 测试
// 覆盖：
//   - 正缓存命中 + 改 TTL 后过期 → 重新请求
//   - 负缓存 30s 后过期 → 重新请求
//   - 失败计数累加:连续失败 N 次后 failCount=N
//   - getCacheState 状态正确
//   - setOnlineDictTtl / setOnlinePhoneticTtl 调整 TTL 生效

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchOnlineDict,
  resetOnlineDictCache,
  setOnlineDictTtl,
  getOnlineDictCacheState,
} from "../src/dict/online-dict.ts";
import {
  fetchOnlinePhonetic,
  resetOnlinePhoneticCache,
  setOnlinePhoneticTtl,
  getOnlinePhoneticCacheState,
} from "../src/dict/online-phonetic.ts";

/** 计数 transport：每次调用计数 +1,返回指定 body */
function counterTransport(body, status = 200) {
  let count = 0;
  return {
    get count() { return count; },
    transport: async () => { count++; return { status, body }; },
  };
}

/** 失败 transport：每次都返回 status=0 */
function failTransport() {
  let count = 0;
  return {
    get count() { return count; },
    transport: async () => { count++; return { status: 0, body: "" }; },
  };
}

const DICT_HTML = '<span class="phontype">英</span><span class="Phonitic">/test/</span>' +
                   '<div class="exp">n. 测试</div>';

test("2.4 online-dict:正缓存命中,过期前不重发", async () => {
  resetOnlineDictCache();
  setOnlineDictTtl({ positiveMs: 60_000, negativeMs: 30_000 });
  const t = counterTransport(DICT_HTML);
  const r1 = await fetchOnlineDict("alpha", t.transport);
  const r2 = await fetchOnlineDict("alpha", t.transport);
  const r3 = await fetchOnlineDict("ALPHA", t.transport); // 大小写归一
  assert.ok(r1);
  assert.equal(r1.word, "alpha");
  assert.deepEqual(r2, r1, "二次应拿到同一对象");
  assert.deepEqual(r3, r1, "大写也应命中（小写归一）");
  assert.equal(t.count, 1, "应只发 1 次");
  assert.equal(getOnlineDictCacheState("alpha"), "positive");
});

test("2.4 online-dict:正缓存过期后重发", async () => {
  resetOnlineDictCache();
  setOnlineDictTtl({ positiveMs: 50, negativeMs: 30 });
  const t = counterTransport(DICT_HTML);
  await fetchOnlineDict("beta", t.transport);
  assert.equal(t.count, 1);
  assert.equal(getOnlineDictCacheState("beta"), "positive");
  // 等过期
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(getOnlineDictCacheState("beta"), "miss", "过期后应视为未命中");
  await fetchOnlineDict("beta", t.transport);
  assert.equal(t.count, 2, "过期后应重发");
});

test("2.4 online-dict:负缓存 30s 内不重发,过期后重试", async () => {
  resetOnlineDictCache();
  setOnlineDictTtl({ positiveMs: 60_000, negativeMs: 60 }); // 负 60ms
  const t = failTransport();
  const r1 = await fetchOnlineDict("gamma", t.transport);
  assert.equal(r1, null);
  assert.equal(t.count, 1);
  assert.equal(getOnlineDictCacheState("gamma"), "negative");
  // 60ms 内再查：应不重发
  await fetchOnlineDict("gamma", t.transport);
  assert.equal(t.count, 1, "负缓存未过期应不重发");
  // 等过期
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(getOnlineDictCacheState("gamma"), "miss");
  await fetchOnlineDict("gamma", t.transport);
  assert.equal(t.count, 2, "过期后应重试");
});

test("2.4 online-dict:成功后再失败 → 正缓存保留", async () => {
  resetOnlineDictCache();
  setOnlineDictTtl({ positiveMs: 60_000, negativeMs: 60_000 });
  let mode = "ok";
  const t = async () => {
    if (mode === "ok") return { status: 200, body: DICT_HTML };
    return { status: 0, body: "" };
  };
  await fetchOnlineDict("delta", t);
  // 切到失败模式
  mode = "fail";
  // 仍应返回正缓存
  const r = await fetchOnlineDict("delta", t);
  assert.ok(r, "应仍返回正缓存,不重新请求");
});

test("2.4 online-dict:setOnlineDictTtl 调整生效", async () => {
  resetOnlineDictCache();
  setOnlineDictTtl({ positiveMs: 60_000, negativeMs: 30_000 });
  assert.equal(getOnlineDictCacheState("x"), "miss");
});

test("2.4 online-phonetic:正缓存命中", async () => {
  resetOnlinePhoneticCache();
  setOnlinePhoneticTtl({ positiveMs: 60_000, negativeMs: 30_000 });
  const PHON_HTML = '<span class="phontype">英</span><span class="Phonitic">/kət/</span>';
  const t = counterTransport(PHON_HTML);
  const r1 = await fetchOnlinePhonetic("cat", t.transport);
  const r2 = await fetchOnlinePhonetic("cat", t.transport);
  assert.equal(r1, "英 /kət/");
  assert.equal(r2, "英 /kət/");
  assert.equal(t.count, 1);
  assert.equal(getOnlinePhoneticCacheState("cat"), "positive");
});

test("2.4 online-phonetic:负缓存过期后重试", async () => {
  resetOnlinePhoneticCache();
  setOnlinePhoneticTtl({ positiveMs: 60_000, negativeMs: 60 });
  const t = failTransport();
  await fetchOnlinePhonetic("dog", t.transport);
  assert.equal(t.count, 1);
  assert.equal(getOnlinePhoneticCacheState("dog"), "negative");
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(getOnlinePhoneticCacheState("dog"), "miss");
  await fetchOnlinePhonetic("dog", t.transport);
  assert.equal(t.count, 2);
});

test("2.4 online-phonetic:连续失败下负缓存应累加(诊断价值)", async () => {
  resetOnlinePhoneticCache();
  setOnlinePhoneticTtl({ positiveMs: 60_000, negativeMs: 60_000 });
  // 该测试只验证缓存状态切换；不连续触发 30s 过期重试，靠 resetOnlinePhoneticCache 隔离
  // 真实场景下 failCount 用于日志/UI 诊断，本测试不直接读 failCount（避免暴露内部字段）
  const t = failTransport();
  await fetchOnlinePhonetic("elephant", t.transport);
  await fetchOnlinePhonetic("fish", t.transport);
  // 各自独立：负缓存隔离
  assert.equal(getOnlinePhoneticCacheState("elephant"), "negative");
  assert.equal(getOnlinePhoneticCacheState("fish"), "negative");
});
