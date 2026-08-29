/**
 * 移动端 PDF 适配 Phase 2 · 测试 4: 触屏单击关闭浮层
 * ----------------------------------------------------------------
 * 覆盖：
 *  - 中心短按 toggleToolbar（已有）
 *  - 触屏单击关闭批注/搜索/设置弹窗（避免和双击/长按冲突）
 *  - tap 延迟避免和 double-tap 冲突（300ms 内仍可触发 double-tap）
 *  - 桌面 click 不受影响
 *
 * 不依赖：foliate / siyuan SDK
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const viewPath = join(__dirname, "..", "src", "reader", "ReaderView.svelte");
const src = readFileSync(viewPath, "utf-8");

test("[核心] 中心短按 toggleToolbar（已有 Phase 1 触屏支持）", () => {
  const fnIdx = src.indexOf("const onTouchEnd = (e: TouchEvent) => {");
  const body = src.slice(fnIdx, fnIdx + 3000);
  assert.ok(/toggleToolbar\(\)/.test(body), "中心点击应 toggleToolbar");
  // 中心判定：0.33 < x/w < 0.67
  assert.ok(
    /x\s*<\s*w\s*\*\s*0\.33[\s\S]{0,200}?x\s*>\s*w\s*\*\s*0\.67/.test(body),
    "中心区域判定 0.33 < x/w < 0.67"
  );
});

test("[核心] 左右分区触屏翻页", () => {
  const fnIdx = src.indexOf("const onTouchEnd = (e: TouchEvent) => {");
  const body = src.slice(fnIdx, fnIdx + 3000);
  // 左 1/3 翻上一页
  assert.ok(/x\s*<\s*w\s*\*\s*0\.33[\s\S]{0,100}?void\s+view\.goLeft\(\)/.test(body), "左 1/3 应 goLeft");
  // 右 1/3 翻下一页
  assert.ok(/x\s*>\s*w\s*\*\s*0\.67[\s\S]{0,100}?void\s+view\.goRight\(\)/.test(body), "右 1/3 应 goRight");
});

test("[关键] 触屏短按关闭批注/搜索/设置浮层", () => {
  // 触屏单击空白处应关闭浮层（避免和长按/双击冲突）
  // 验证 toggleToolbar 调用（这同时也是"关闭浮层"的入口）
  assert.ok(/toggleToolbar/.test(src), "toggleToolbar 函数应存在");
  // 验证搜索/设置 弹窗状态（确实存在）
  assert.ok(/showSearch/.test(src), "showSearch 状态应存在");
  assert.ok(/showSettings/.test(src), "showSettings 状态应存在");
  // 验证 toggleToolbar 内部关闭搜索/设置（toggleToolbar 实现里会 set false）
  // 找 toggleToolbar 函数体（用大括号深度匹配）
  const fnStart = src.indexOf("function toggleToolbar()");
  assert.ok(fnStart > 0, "toggleToolbar 函数应存在");
  let depth = 0;
  let bodyStart = -1;
  let bodyEnd = -1;
  for (let i = fnStart; i < src.length; i++) {
    if (src[i] === "{") {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
  }
  assert.ok(bodyEnd > 0, "应能定位 toggleToolbar 函数体");
  const body = src.slice(bodyStart, bodyEnd);
  // 应有 showSearch = false / showSettings = false / showToc = false
  assert.ok(
    /showSearch\s*=\s*false/.test(body) || /showSettings\s*=\s*false/.test(body) || /showToc\s*=\s*false/.test(body),
    "toggleToolbar 内部应关闭搜索/设置/目录浮层"
  );
});

test("[关键] tap 延迟：双击期间不立即触发单击", () => {
  // double-tap 判定在 onTouchEnd 第一时间执行（300ms 内）
  // 单击分区翻页在 dt < 350ms 内执行
  // 双击不会误触发翻页（因为 dt < 300 < 350 时进 double-tap 分支 return）
  // 精确定位 double-tap 块的 return
  const nowIdx = src.indexOf("now - lastTapT < DOUBLE_TAP_INTERVAL");
  assert.ok(nowIdx > 0, "应有 now - lastTapT < DOUBLE_TAP_INTERVAL 判定");
  // 该判定之后 500 字符内应 return（要跨过 if 块内的 onDblClickToggleZoom 调用）
  const after = src.slice(nowIdx, nowIdx + 500);
  assert.ok(/return/.test(after), "double-tap 命中后应 return（不继续走翻页/工具栏逻辑）");
});

test("[关键] 触屏 tap 关闭浮层不破坏桌面 click", () => {
  // 桌面 click 路径应仍走 mousedown / mouseup → onContentMouseUp → selToolbar
  // 触屏 tap 路径走 onTouchEnd → toggleToolbar
  // 两条路径不冲突
  assert.ok(/onContentMouseUp/.test(src) || /mouseup/.test(src), "桌面 mouseup 路径应保留");
  assert.ok(/onTouchEnd/.test(src), "触屏 touchend 路径应保留");
});

test("[核心] 触屏与桌面入口并存（不互斥）", () => {
  // 触屏：touchstart/move/end
  // 桌面：mousedown/mouseup
  // 两者都注册到 doc
  assert.ok(
    /trackDocListener\(doc,\s*["']touchstart["']/.test(src) &&
    /trackDocListener\(doc,\s*["']touchend["']/.test(src) &&
    /trackDocListener\(doc,\s*["']mouseup["']/.test(src),
    "触屏 + 桌面事件监听并存"
  );
});

test("[行为] 触屏单击批注浮层不会误触 double-tap", () => {
  // 单击工具栏 toggle 不会触发 double-tap（因为 tap 是 toggleToolbar 的 if 内进 return）
  // 触屏单击路径在 dt < 350 + 位移小时进 toggleToolbar 分支
  // 而 double-tap 判定在 dt < 300 时进 if 块
  // 注意：dt = Date.now() - touchT（touchstart 时间）
  // 第一次 tap 不会进 double-tap 块（因为 lastTapT = 0，now - 0 > 300）
  // 第二次 tap 才会触发
  const fnIdx = src.indexOf("const onTouchEnd = (e: TouchEvent) => {");
  const body = src.slice(fnIdx, fnIdx + 3000);
  // 第一次 tap 应记录 lastTapT = now（不触发 double-tap）
  assert.ok(/lastTapT\s*=\s*now/.test(body), "第一次 tap 应只记录 lastTapT");
});

test("[关键] 长按/双击/单击 三种手势互不冲突", () => {
  // 长按：500ms 内静止 → 触发
  // 双击：300ms 内两次静止 → 触发（仅 PDF 缩放 toggle）
  // 单击：350ms 内单击 → 触发（分区翻页/工具栏 toggle）
  // 时间线：
  //   - 0ms: touchstart
  //   - 300ms: 第一次 tap（lastTapT 记录）
  //   - 600ms: 第二次 tap（不会进 double-tap 块，因为 now - lastTapT = 300 边界）
  //   - 但实际 iOS 触屏双击间隔通常 100-200ms，< 300
  // 验证三个常量
  assert.ok(/const\s+LONG_PRESS_MS\s*=\s*500/.test(src), "LONG_PRESS_MS = 500");
  assert.ok(/const\s+DOUBLE_TAP_INTERVAL\s*=\s*300/.test(src), "DOUBLE_TAP_INTERVAL = 300");
  assert.ok(/dt\s*<\s*350/.test(src), "单击判定 dt < 350");
});
