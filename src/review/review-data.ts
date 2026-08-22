/**
 * 复习数据接入层（自研 SRS 的「数据获取接口」落地）
 * ------------------------------------------------------------------
 * 把 difficulty.ts 预留的 setFrequencyData / setAwlData 注入点真正接上：
 *   - AWL 学术词表：直接内置（src/review/data/awl.ts，准确可靠）；
 *   - 高频词种子：内置 FREQUENCY_SEED 作为无外部词频表时的回退；
 *   - 真实词频表（COCA/BNC 全量）：运行期调用 setFrequencyData(map) 注入即可，
 *     本层不强制依赖，缺省走种子 + 中性回退。
 *
 * 这样 difficulty.ts 四个维度（rarity / length / awl / polysemy）在第一版就
 * 有真实数据支撑：length 由词本身算，polysemy 由词典义项数喂（见 vocab-store
 * 在收词时写入 senseCount），rarity/awl 由本层注入的词表支撑。
 */

import {
  setFrequencyData,
  setAwlData,
  isFrequencyDataInjected,
  isAwlDataInjected,
  computeDifficulty,
} from "./difficulty.ts";
import { getReviewConfig, setReviewConfig } from "./config.ts";
import { AWL_WORDS_UNIQUE, AWL_WORDS } from "./data/awl.ts";
import { FREQUENCY_SEED } from "./data/frequency-seed.ts";
import { FREQUENCY_FULL_RANKED, FREQUENCY_FULL_COUNT } from "./data/frequency-full.ts";
import type { WordRecord } from "../types.ts";
import { getLogger } from "../core/logger.ts";

/**
 * 全量真实词频表（一次性构建 Map<word, rank>，rank=1-based 频率降序位置）。
 * 来源 hermitdave/FrequencyWords en_50k，约 5 万词条，覆盖绝大多数学习/阅读词汇。
 * 仅在首次加载时构建一次；之后 rarityFactor(word) 直接用 rank/词频规模归一化。
 */
let fullFrequencyMap: Map<string, number> | null = null;
function buildFullFrequencyMap(): Map<string, number> {
  if (fullFrequencyMap) return fullFrequencyMap;
  const m = new Map<string, number>();
  const list = FREQUENCY_FULL_RANKED.split(" ");
  for (let i = 0; i < list.length; i++) m.set(list[i], i + 1);
  fullFrequencyMap = m;
  return m;
}

/**
 * 在插件加载时调用一次：注入 AWL 与真实词频表。
 * 必须在词库 ensureDifficulties() 之前调用，使难度计算能用到这些表。
 *
 * 5.1 改造：
 *   - 使用 AWL_WORDS_UNIQUE（去重+小写化），确保命中率不被重复词族拖累；
 *   - 词频/AWL 注入失败时打 warn 日志，便于用户排查"难度退化为 0.5"的根因；
 *   - 注入完成后暴露 isInjected 状态供诊断/测试读取。
 */
export function initReviewData(): void {
  // AWL：总是注入（内置，准确可靠）
  try {
    const set = new Set(AWL_WORDS_UNIQUE);
    setAwlData(set);
    getLogger().info(`[REword][review-data] AWL 注入完成：${set.size} 词族（Sublist 1-3）`);
  } catch (e) {
    getLogger().warn("[REword][review-data] AWL 注入失败，awl 维度将全部为 0：", { error: e });
  }

  // 全量真实词频表：优先用（覆盖 ~5 万词条），并同步把归一化规模设为表长，
  // 使最稀有词 rarity→1、最常用词 rarity→0，判别更准确。
  if (FREQUENCY_FULL_COUNT > 0) {
    try {
      setFrequencyData(buildFullFrequencyMap());
      setReviewConfig({ frequencyCorpusSize: FREQUENCY_FULL_COUNT });
      getLogger().info(`[REword][review-data] 词频表注入完成：${FREQUENCY_FULL_COUNT} 词条`);
    } catch (e) {
      getLogger().warn("[REword][review-data] 词频表注入失败，rarity 维度将回退中性 0.5：", { error: e });
    }
    return;
  }

  // 回退：若全量模块为空，使用内置高频种子（受开关控制）
  if (getReviewConfig().enableFrequencySeed) {
    try {
      const m = new Map<string, number>();
      for (const [k, v] of Object.entries(FREQUENCY_SEED)) m.set(k.toLowerCase(), v);
      setFrequencyData(m);
      getLogger().info(`[REword][review-data] 词频种子回退注入：${m.size} 词`);
    } catch (e) {
      getLogger().warn("[REword][review-data] 词频种子注入失败：", { error: e });
    }
  } else {
    getLogger().info("[REword][review-data] 词频种子已关闭，跳过注入");
  }
}

/** 计算单个单词的固有难度（结合已注入词表 + 义项数）。供存储层在收词时缓存。 */
export function computeWordDifficulty(word: string, senseCount?: number): number {
  return computeDifficulty(word, { senseCount }).difficulty;
}

// ============ 5.1 可观测 API：让外部/测试确认注入是否到位 ============

/** 注入状态（用于诊断面板/测试断言） */
export interface ReviewDataInjectionStatus {
  awl: boolean;
  frequency: boolean;
  /** 词频表归一化规模（来自 ReviewConfig.frequencyCorpusSize） */
  corpusSize: number;
  /** 注入使用的源：full = 全量 ~5 万词；seed = 内置 100 词种子；none = 未注入 */
  frequencySource: "full" | "seed" | "none";
}

/** 取当前 review data 注入状态（不抛错，返回降级默认） */
export function getReviewDataStatus(): ReviewDataInjectionStatus {
  const cfg = getReviewConfig();
  const freqIn = isFrequencyDataInjected();
  // 推断 source：以 corpusSize 阈值区分（全量 ≈ 5 万、种子 = 100）
  const source: "full" | "seed" | "none" = !freqIn
    ? "none"
    : cfg.frequencyCorpusSize >= 1000
      ? "full"
      : "seed";
  return {
    awl: isAwlDataInjected(),
    frequency: freqIn,
    corpusSize: cfg.frequencyCorpusSize,
    frequencySource: source,
  };
}

/** 是否已就绪（两个维度都注入成功） */
export function isReviewDataReady(): boolean {
  return isAwlDataInjected() && isFrequencyDataInjected();
}

/**
 * 测试辅助：清空 review-data 模块级缓存（不触碰已注入的外部表）。
 * 用于让不同测试用例拿到确定的"未注入"起点。
 */
export function __resetReviewDataForTest(): void {
  fullFrequencyMap = null;
  // 静默警告：调用方应自行清空外部 difficulty 注入（见 difficulty.__resetInjectedDataForTest）
}

// 显式重导出，避免与 data/awl.ts 的内部符号混淆
export { AWL_WORDS };
