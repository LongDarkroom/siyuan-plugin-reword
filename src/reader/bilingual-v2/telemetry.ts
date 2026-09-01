/**
 * bilingual-v2 · Telemetry 总线
 * ------------------------------------------------------------------
 * 重做核心目标之一：让用户「看清翻译引擎在干什么、花了多少」。
 *
 * 设计原则（与 v1 最大的区别）：可观测性从第一天就是基础设施，
 * 而不是事后补丁。每次翻译无论成功/失败/命中缓存，都 emit 一条事件；
 * 引擎看板与成本面板只需订阅总线，零额外埋点。
 *
 * 事件维度覆盖用户三大需求：
 *  - 引擎状态：phase=try/done/error + engine + error → 实时看板
 *  - 成本分解：phase=cost 携带 缓存节省 / AI 段数 / 各引擎字符消耗 / token
 *  - 直译释义：v2 只走 literal 单一模式，无需区分风格
 */

export type TelemetryPhase = "try" | "hit" | "done" | "error" | "cost";

export interface TelemetryEvent {
  /** 阶段：try=尝试某引擎 / hit=命中缓存 / done=批次完成 / error=引擎失败 / cost=成本结算 */
  phase: TelemetryPhase;
  /** 引擎名：tencent/youdao/baidu/microsoft/libretranslate/ai/cache/none */
  engine?: string;
  /** 图书 ID（用于按书聚合） */
  bookId?: string;
  /** 本次事件涉及段数 */
  segmentCount?: number;
  /** 免费引擎字符消耗（腾讯/有道/百度计费用） */
  chars?: number;
  /** AI token 明细（仅 AI 段有值） */
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** 本批是否全部命中缓存（缓存节省部分，最该让用户看见） */
  fromCache?: boolean;
  /** 耗时 ms（引擎调用往返） */
  latencyMs?: number;
  /** 错误码 / 错误信息（phase=error 时） */
  error?: string;
  /** 一次预翻译运行的唯一 ID，便于面板聚合「本次预翻译」 */
  runId?: string;
}

type Listener = (e: TelemetryEvent) => void;

class TelemetryBus {
  private listeners = new Set<Listener>();

  /** 订阅总线，返回取消订阅函数 */
  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** 上报一条事件（监听器异常被隔离，不影响翻译主流程） */
  emit(e: TelemetryEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch (_) {
        /* swallow listener errors */
      }
    }
  }

  /** 清空全部监听（模块卸载时） */
  clear(): void {
    this.listeners.clear();
  }
}

/** 全局单例总线 */
export const telemetry = new TelemetryBus();

/** 引擎中文短标签（用于看板 UI） */
export function engineLabel(p: string): string {
  switch (p) {
    case "tencent": return "腾讯";
    case "youdao": return "有道";
    case "baidu": return "百度";
    case "microsoft": return "微软";
    case "libretranslate": return "Libre";
    case "ai": return "AI";
    case "cache": return "缓存";
    case "none": return "失败";
    default: return p || "";
  }
}
