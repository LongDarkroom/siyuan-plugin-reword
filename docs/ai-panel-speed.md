# REword AI 面板生成速度分析报告

> 背景：AI 功能面板生成速度慢于 Copilot 插件，但同一 API 在 Copilot 中响应快。
> 结论：API 调用层两边**同源**（REword 已全面复用 Copilot 的 `ai-client.ts` 引擎，见 `src/ai/ai-orchestrator.ts:17`、`src/copilot/ai/ai-client.ts:4`），慢几乎全部来自**渲染链路与完成前阻塞**，而非网络。

## 一、根因清单（按优先级）

### 🔴 P0｜正文非流式渲染（感知差异最大）

- **证据**：`src/ai/ai-panel.ts` 调用 `runAiDeepRead` / `runAiChat` 时只传了 `onThinking`，没传 `onToken`（`onToken` 在 `ai-orchestrator.ts` 中标注为「预留接口」）。
- **表现**：点击发送后只有三个跳动圆点（最多加思考过程滚动）；模型**完整生成全部内容**（数秒~数十秒）后，`loadingMsg.remove()` + `renderDeepReadHtml()` 才一次性渲染。
- **影响**：占据用户感知延迟的 **90% 以上**。

### 🟠 P1｜流式传输可能静默降级为缓冲

- **证据**：`requestAIStream`（`src/copilot/ai/ai-client.ts`）优先**直连 fetch 读 SSE**；一旦直连失败（CORS/网络）且零产出，回退内核代理 `forwardProxyFetch` 的**缓冲式请求**——此时 `onToken` 只会一次性回调整个内容，逐字效果消失。
- **表现**：即便修好 P0，在 CORS 受限的端点（部分 API 网关/自建代理不放 CORS 头）上仍是「等了很久突然全出」。

### 🟠 P1｜完成前同步阻塞（结果"卡"在最后一刻）

- **证据 A（对话模式）**：渲染前 `await ensureSession()` + `await sessionStore.saveMessages()`（写 JSON 文件）。
- **证据 B（学习模式）**：返回结果前**串行 await 每个词** `vocabStore.upsertWord()`（每词一次文件写）。
- **表现**：生成已完成，却因落盘/写回没跑完，用户多等几百 ms~数秒。

### 🟡 P2｜对话历史无裁剪，上下文越滚越大

- **证据**：用户输入 push 进 `chatHistory` 后**整段全量发送**，无 token 预算裁剪；Copilot 自带 `contextEstimator` 做历史压缩。
- **表现**：多轮对话后请求体膨胀 → **首 token 延迟（TTFT）变长**，表现为「越聊越慢」。

### 🟡 P2｜一次性渲染开销

- **证据**：`renderWithLute`（`src/ai/ai-render.ts`）**每次** `window.Lute.New()` 全新实例 + 逐项配置 20+ 个 `Set*` 开关再全量 `Md2HTML`；随后 `enhanceSiYuanRender` 跑 KaTeX 公式 + highlight.js 高亮。
- **表现**：长回答在"出结果"那一刻还会再顿一下。

### 🟢 P3｜输入采集串行

- **证据**：`expandBlockRefs`（`ai-panel.ts`）对每个 `((块引用))` **逐个 await `fetchBlockText`**（网络往返）；另把整段 raw markdown 塞进 `data-raw-md` 属性，加大 innerHTML 解析负担。

## 二、解决方案（与根因一一对应）

| 优先级 | 方案 | 落地要点 |
|---|---|---|
| **P0-1** | **启用 `onToken` 流式渲染正文** | 发送时把 `onToken` 传给 `runAiDeepRead`/`runAiChat`；第一个 chunk 到达即把 loading 消息**原位升级**为结果气泡，之后增量追加 |
| **P0-2** | **节流批量渲染，避免每 token 重绘** | 累积文本后按 ~80-150ms 节流（`requestAnimationFrame` 合并），按段落/句子边界分批渲染；保持滚动跟随但不强制跳底 |
| **P0-3** | **结构化精读（learning 模式）降级为流式 markdown** | JSON 结构化无法逐字渲染卡片——生成期间先显示动态「已生成 N 字」计数（或增量 markdown），结束后再升级为结构化卡片 |
| **P1-1** | **传输层模式开关 + 失败透明化** | 设置增加「流式传输：直连 SSE（默认）/ 内核代理缓冲」；直连失败回退时在状态栏提示「已切换为缓冲模式」 |
| **P1-2** | **缓冲模式也走增量 UI** | 回退路径 `onToken` 一次性回调时同样触发"首屏即出"，并按 chunk 切分模拟打字机效果 |
| **P1-3** | **完成前异步化** | ① 对话模式：先渲染气泡，`saveMessages` 改 `void`（fire-and-forget，失败打日志）；② 学习模式：词库写回改为 `Promise.allSettled` 并行，`savedWords` 提示延迟更新 |
| **P2-1** | **历史上下文裁剪** | 按 token 预算（如 maxTokens 的 60%）保留最近 N 条消息，最旧消息压缩为 1 行摘要；可复用 `estimateTokens`（`src/copilot/ai/ai-client.ts`）与 `src/ai/chat-trim.ts`。注：原参照的 `copilot-src/utils/contextEstimator.ts` 已于 2026-08-28 随死代码清理移除 |
| **P2-2** | **渲染优化** | `renderWithLute` 缓存复用 Lute 实例（模块级单例）；KaTeX/highlight 改为**空闲时异步增强**，先出文本后补公式/高亮 |
| **P3-1** | **块引用展开缓存** | 会话内按 blockId → 正文 LRU 缓存；限制展开总量（如 8000 字截断） |
| **P3-2** | **移除冗余属性** | `data-raw-md` 改存 JS 侧 Map（按 msgIndex），不再塞进 DOM 属性 |

## 三、实施排期建议

| 阶段 | 内容 | 预期效果 | 工作量 |
|---|---|---|---|
| ① 立即做 | P1-3 异步化 + P0 流式骨架（onToken 透传 + 首屏即出 + 节流） | 感知速度提升 **60%+**，有打字机效果 | 中 |
| ② 紧随 | P1-1/P1-2 传输层开关与提示、缓冲模拟打字机 | 全端点覆盖流式体验 | 中 |
| ③ 一周内 | P2-1 上下文裁剪、P2-2 渲染优化 | 多轮对话 TTFT 恢复快、出结果不再卡顿 | 中 |
| ④ 低优 | P3 输入采集缓存与属性瘦身 | 长文档首帧更早 | 小 |

## 四、验证方式

1. **单测**：流式节流器（合并边界、时间窗口）、历史裁剪函数（token 预算边界）、`onToken` 透传路径（mock transport 逐步 emit chunk）。
2. **真机**：reload 后发送长问题，确认①首个 token 到达即显示正文；②生成过程滚动流畅不卡；③结束后会话落盘/词库写回不再阻塞首屏；④多轮对话第 5 轮 TTFT 与第 1 轮接近。
3. **回退路径**：用无 CORS 头端点验证「缓冲模式提示 + 打字机模拟」生效。

## 五、实施记录

- 2026-08-19：完成阶段① —— P0 流式骨架（onToken 透传 + 首屏即出 + 节流增量渲染）、P1-3 异步化（对话落盘 fire-and-forget、词库写回并行）。新增 `src/ai/stream-throttle.ts` 节流器与单测。
