/**
 * 生命周期可释放注册表
 * ------------------------------------------------------------------
 * 根因修复（对应审查项 #1/#2/#3/#4）：插件历史上大量 addEventListener /
 * MutationObserver / eventBus.on / setTimeout 在 onunload 时从不移除，
 * 导致插件每次重载都累积重复监听，拖慢整个思源编辑器并引发重复处理类 bug。
 *
 * 本类统一托管一切「需要反向清理」的资源，dispose() 一次性全部释放，
 * 从机制上杜绝「漏移除」类泄漏。各模块应改用本类而非裸 addEventListener。
 */

type Disposer = () => void;

export class Disposables {
  private items: Disposer[] = [];
  private disposed = false;

  /** 注册任意清理函数（最通用） */
  add(fn: Disposer): Disposer {
    this.items.push(fn);
    return fn;
  }

  /** 托管 DOM 事件监听：element.addEventListener + 自动 removeEventListener */
  addEventListener<E extends Event = Event>(
    target: EventTarget,
    type: string,
    listener: (evt: E) => void,
    options?: boolean | AddEventListenerOptions
  ): void {
    target.addEventListener(type, listener as EventListener, options);
    this.add(() => {
      try {
        target.removeEventListener(type, listener as EventListener, options);
      } catch {
        /* 某些宿主在 target 已销毁时抛错，忽略 */
      }
    });
  }

  /** 托管 MutationObserver */
  addObserver(observer: MutationObserver): void {
    this.add(() => {
      try {
        observer.disconnect();
      } catch {
        /* ignore */
      }
    });
  }

  /** 托管定时器 id（setTimeout / setInterval） */
  addTimer(id: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>): void {
    this.add(() => {
      try {
        clearTimeout(id as any);
        clearInterval(id as any);
      } catch {
        /* ignore */
      }
    });
  }

  /** 托管 requestAnimationFrame id */
  addRaf(id: number): void {
    this.add(() => {
      try {
        cancelAnimationFrame(id);
      } catch {
        /* ignore */
      }
    });
  }

  /**
   * 托管 SiYuan eventBus 订阅：eventBus.on 返回取消函数（标准 SiYuan API）。
   * 若宿主用回调式 on（返回 void），则传入 removeListener 进行反向清理。
   */
  addEventBus(on: () => void | (() => void), removeListener?: () => void): void {
    const off = on();
    if (typeof off === "function") {
      this.add(off as Disposer);
    } else if (removeListener) {
      this.add(removeListener);
    }
  }

  /** 是否已释放 */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** 释放全部托管资源（幂等，可安全多次调用） */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // 逆序释放，符合栈式依赖（后注册先清理）
    for (let i = this.items.length - 1; i >= 0; i--) {
      try {
        this.items[i]();
      } catch (e) {
        console.warn("[REword][Disposables] 释放资源时出错（已忽略）:", e);
      }
    }
    this.items = [];
  }
}
