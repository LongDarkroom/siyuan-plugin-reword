/**
 * SiYuan 内核 API 封装（兼容 shim）
 * ------------------------------------------------------------------
 * 历史封装已统一收敛至 `src/siyuan/api.ts`（唯一枢纽）。本文件仅作为
 * 旧 copilot chat（src/copilot/ai/ai-client.ts 等）的兼容层：
 *   - 其余公共函数一律 re-export 枢纽；
 *   - 仅保留旧 chat 强依赖的对象式 `forwardProxy({url, method, timeout, headers, payload})`，
 *     底层委托枢纽 `forwardProxyRaw`，消除此前 60s 默认超时 / 返回结构分叉。
 *
 * 本文件不再包含任何独立实现逻辑，仅做转发，避免与枢纽产生行为不一致。
 */

import { forwardProxyRaw } from "../../siyuan/api.ts";

export * from "../../siyuan/api.ts";

/** 兼容旧 chat 的对象式转发别名，返回形态保持 { status, headers, body } */
export async function forwardProxy(req: {
  url: string;
  method?: string;
  timeout?: number;
  headers?: Record<string, string>;
  payload?: string;
}): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const r = await forwardProxyRaw({
    url: req.url,
    method: req.method || "POST",
    timeout: req.timeout || 60000,
    headers: req.headers || {},
    payload: req.payload || "",
  });
  return { status: r.status, headers: r.headers, body: r.body };
}
