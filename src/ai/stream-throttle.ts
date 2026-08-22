/**
 * REword · 流式渲染节流器
 * ------------------------------------------------------------------
 * 流式生成时 onToken 每收到一个 chunk 就回调一次，若每次都全量重渲染
 * （Lute Md2HTML + DOM 注入）会拖垮主线程。本节流器把高频回调合并为
 * 固定时间窗口内的一次执行（统一在窗口边界执行，语义简单可测）：
 *
 *  - schedule()：请求一次渲染；窗口内重复调用只合并为一次
 *  - flush()：立即执行未决的渲染（生成完成时调用，保证最后一段不丢）
 *  - cancel()：取消未决渲染（中断/销毁时调用）
 *
 * 不依赖 rAF，用 setTimeout 实现，便于 Node 单测。
 */

export interface StreamThrottle {
  /** 请求一次渲染（窗口内合并；统一在窗口边界执行一次） */
  schedule: () => void;
  /** 立即执行未决渲染（生成完成时调用，保证最后一段不丢） */
  flush: () => void;
  /** 取消未决渲染（中断/销毁时调用） */
  cancel: () => void;
}

/**
 * 创建节流器。
 * @param fn 实际渲染回调（内部应做幂等全量渲染，如 renderWithLute(累计文本)）
 * @param intervalMs 合并窗口，默认 100ms
 */
export function createStreamThrottle(fn: () => void, intervalMs = 100): StreamThrottle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    fn();
  };
  return {
    schedule() {
      if (timer) return; // 已有未决渲染，合并
      timer = setTimeout(run, intervalMs);
    },
    flush() {
      // 仅在存在未决渲染时立即执行一次（生成完成保底不丢字）；无事可做则跳过
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      fn();
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
