/**
 * 分类标签库单元测试（label-store.ts，2026-08-14 新增）。
 * 验证：空库播种 / add 去重 / 自动配色轮转 / load 往返 / rename / remove / onChange。
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

const mod = await import("../src/annotation/label-store.ts");
const { LabelStore, LABEL_COLORS, DEFAULT_LABELS } = mod;

function makeStore() {
  let n = 0;
  const store = new LabelStore(() => { n++; });
  return { store, calls: { get n() { return n; } } };
}

test("空库 load 自动播种预置标签", () => {
  const { store } = makeStore();
  store.load(null);
  assert.equal(store.size, DEFAULT_LABELS.length, `应播种 ${DEFAULT_LABELS.length} 个预置标签`);
  const names = store.getAll().map((l) => l.name);
  assert.ok(names.includes("科技"), "应含 科技");
  assert.ok(names.includes("医学"), "应含 医学");
});

test("add: 同名去重（忽略大小写）", () => {
  const { store } = makeStore();
  store.load(null);
  const before = store.size;
  const a = store.add("科技");
  const b = store.add("科技");
  assert.equal(a.id, b.id, "同名应返回已有标签");
  assert.equal(store.size, before, "去重后数量不变");
});

test("add: 自动配色轮转（按 LABEL_COLORS 长度取模）", () => {
  // 空库播种 DEFAULT_LABELS（14 个，2026-08-15 增 4 个流程标签）；
  // 再 add 时颜色按 LABEL_COLORS[seedCount % LABEL_COLORS.length] 分配。
  const s = new LabelStore(() => {});
  s.load(null);
  const seedCount = s.size;
  assert.ok(seedCount >= 14, "预置标签数应 ≥ 14（主题 10 + 流程 4）");
  const added1 = s.add("新增1");
  // add 内部 nextColor 在调用前 size = seedCount，add 后 size = seedCount + 1
  assert.equal(added1.color, LABEL_COLORS[seedCount % LABEL_COLORS.length],
    "第一个新增标签应按 LABEL_COLORS 轮转（索引 = 预置数 mod 色板长）");
  const added2 = s.add("新增2");
  assert.equal(added2.color, LABEL_COLORS[(seedCount + 1) % LABEL_COLORS.length], "下一个颜色递增");
  assert.notEqual(added1.color, added2.color);
});

test("load/toJSON 往返容错", () => {
  const { store } = makeStore();
  store.load({
    labels: [
      { id: "a", name: "科技", color: "#0d9e5f", createdAt: "2026-01-01T00:00:00Z" },
      { id: "b", name: "环保" }, // 缺 color/createdAt → 自动补
    ],
  });
  assert.equal(store.size, 2);
  assert.equal(store.get("a")?.color, "#0d9e5f");
  assert.ok(store.get("b")?.color, "缺 color 应自动补");
  assert.ok(store.get("b")?.createdAt, "缺 createdAt 应自动补");

  const json = store.toJSON();
  assert.equal(json.labels.length, 2);
  assert.equal(json.labels[0].id, "a");
});

test("colorMap: id -> color 映射", () => {
  const { store } = makeStore();
  store.load({ labels: [{ id: "x", name: "法律", color: "#5b6ee1" }] });
  assert.equal(store.colorMap()["x"], "#5b6ee1");
});

test("rename: 重命名标签；重名保护", () => {
  const { store } = makeStore();
  store.load({ labels: [{ id: "a", name: "科技", color: "#0d9e5f" }, { id: "b", name: "环保", color: "#e6a23c" }] });
  store.rename("a", "科技前沿");
  assert.equal(store.get("a")?.name, "科技前沿");
  // 重名保护：b 想改成 a 的新名 → 拒绝
  store.rename("b", "科技前沿");
  assert.equal(store.get("b")?.name, "环保", "重名应被拒绝");
});

test("remove: 删除标签定义，不影响其它", () => {
  const { store } = makeStore();
  store.load({ labels: [{ id: "a", name: "科技", color: "#0d9e5f" }, { id: "b", name: "环保", color: "#e6a23c" }] });
  store.remove("a");
  assert.equal(store.size, 1);
  assert.equal(store.get("b")?.name, "环保");
});

test("onChange: add/rename/remove 触发持久化", () => {
  const { store, calls } = makeStore();
  store.load(null);
  const before = calls.n;
  store.add("自定义");
  assert.ok(calls.n > before, "add 应触发 onChange");
  store.rename(store.getAll()[0].id, "改名");
  assert.ok(calls.n > before, "rename 应触发 onChange");
  store.remove(store.getAll()[0].id);
  assert.ok(calls.n > before, "remove 应触发 onChange");
});
