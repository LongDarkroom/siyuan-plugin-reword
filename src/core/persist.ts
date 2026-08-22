/**
 * 统一防抖持久化
 * ------------------------------------------------------------------
 * 根因修复（对应审查项 #7/#8）：历史上 annotation-store / conversation-store
 * 每次变更都「整文件落盘」且无防抖，高频操作（含潜在的流式逐 token 写入）
 * 造成大量重复 I/O；且 saveData 失败被静默吞掉 → 潜在数据丢失。
 *
 * 本类封装 saveData：
 *  - 防抖（trailing）：合并短时间内的多次更新为一次写盘；
 *  - 失败重试（指数退避，最多 3 次）；
 *  - 最终失败经 onError 上报（不静默）；
 *  - flush() 强制立即落盘（onunload 时调用，避免防抖中的数据丢失）。
 */

export interface PersistentStoreOptions {
  /** 防抖延迟（ms），默认 400 */
  delay?: number;
  /** 失败重试次数，默认 3 */
  retries?: number;
  /** 最终失败回调（如上报用户） */
  onError?: (e: unknown) => void;
}

export class PersistentStore {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: unknown = null;
  private inFlight = false;
  private opts: Required<PersistentStoreOptions>;

  constructor(
    private readonly save: (data: unknown) => Promise<void>,
    options: PersistentStoreOptions = {}
  ) {
    this.opts = {
      delay: options.delay ?? 400,
      retries: options.retries ?? 3,
      onError: options.onError ?? (() => {}),
    };
  }

  /** 提交一次更新（防抖合并） */
  update(data: unknown): void {
    this.pending = data;
    if (this.timer) return; // 已排期
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushNow();
    }, this.opts.delay);
  }

  /** 立即落盘（取消待定计时器并写入最新 pending） */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flushNow();
  }

  private async flushNow(): Promise<void> {
    if (this.inFlight) return; // 正在写，pending 会在下次被处理
    if (this.pending === null) return;
    const data = this.pending;
    this.pending = null;
    this.inFlight = true;
    try {
      await this.writeWithRetry(data, 0);
    } finally {
      this.inFlight = false;
      // 写入期间又有新更新 → 继续排期
      if (this.pending !== null && this.timer === null) {
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.flushNow();
        }, this.opts.delay);
      }
    }
  }

  private async writeWithRetry(data: unknown, attempt: number): Promise<void> {
    try {
      await this.save(data);
    } catch (e) {
      if (attempt < this.opts.retries) {
        const backoff = 200 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoff));
        await this.writeWithRetry(data, attempt + 1);
      } else {
        this.opts.onError(e);
      }
    }
  }
}
