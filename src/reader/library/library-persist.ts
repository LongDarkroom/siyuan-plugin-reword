/**
 * 书库持久化层（library/）
 * ---------------------------------------------------------------
 * 从 bookshelf-store.ts 原位抽取「安全恢复」职责，对外契约 100% 不变：
 *  - 主索引损坏 → 回退 .bak 镜像；
 *  - 单条损坏 → quarantine 隔离坏条、保留其余（绝不因一条坏数据清空整架）；
 *  - 写盘失败 → 指数退避重试（最多 3 次）+ 最终 reportError 上报（不再静默）；
 *  - 写成功后镜像 .bak，保证下一轮可恢复。
 *
 * 对应 Readest 蓝图：本文件 ≈ Readest libs/library.ts 的「持久化 + 恢复」部分；
 * BookshelfStore ≈ Readest LibraryStore（对外 API 不变，内部委托到此层）。
 *
 * 持久化原语：saveData/loadData 是 SiYuan 原生 Plugin API
 * （落盘到 data/storage/petal/<插件>/<key>），并非直接写 JSON 文件。
 */

import { reportError } from "../../core/safe.ts";
import { getLogger } from "../../core/logger.ts";

/** 书架主索引键（与老数据文件名一致，向后兼容） */
export const INDEX_KEY = "hiword-bookshelf.json";
/** 用户分组索引键（独立文件：书架索引保持纯数组） */
export const GROUPS_KEY = "hiword-bookshelf-groups.json";

/** 主索引键 → .bak 镜像键（hiword-bookshelf.json → hiword-bookshelf.bak.json） */
export function backupKeyOf(key: string): string {
  if (key.endsWith(".json")) return key.slice(0, -".json".length) + ".bak.json";
  return key + ".bak";
}

/** loadLibraryIndex 返回结果 */
export interface LibraryLoadResult<T> {
  /** 通过校验的条目（已剔除坏条） */
  data: T[];
  /** 被隔离的坏条（仅记录，不由本层写回；上层可自愈写回清洗后的 data） */
  quarantined: unknown[];
  /** 主索引是否损坏/缺失（触发了 .bak 回退或降级为空） */
  primaryFailed: boolean;
  /** 是否从 .bak 成功恢复 */
  recoveredFromBackup: boolean;
}

/** 极简插件接口：仅需 saveData/loadData（与 SiYuan Plugin 兼容，便于单测 mock） */
export interface PersistBackend {
  loadData?(key: string): Promise<unknown>;
  saveData?(key: string, data: unknown): Promise<void>;
}

/**
 * 加载书库索引（安全恢复核心）。
 * @param validate 条目类型守卫，返回 false 的条目被 quarantine。
 *
 * 行为：
 *  1) 主索引是合法数组 → 逐条校验，坏条隔离、好条保留；
 *  2) 主索引损坏/缺失（loadData 抛错或非数组）→ 回退 .bak；
 *  3) 两者皆不可用 → 空架（绝不静默清空「其他数据」，仅本索引降级为空）。
 * 注：首次运行 loadData 返回 undefined（文件本就不存在）属正常，不告警、不降级。
 */
export async function loadLibraryIndex<T>(
  plugin: PersistBackend,
  key: string,
  validate: (x: unknown) => x is T
): Promise<LibraryLoadResult<T>> {
  const empty: LibraryLoadResult<T> = {
    data: [],
    quarantined: [],
    primaryFailed: false,
    recoveredFromBackup: false,
  };
  const logger = getLogger();

  // 1) 尝试主索引
  let primary: unknown;
  let primaryThrew = false;
  try {
    primary = await plugin.loadData?.(key);
  } catch {
    primaryThrew = true;
    primary = undefined;
  }

  if (Array.isArray(primary)) {
    const { good, bad } = partition(primary, validate);
    if (bad.length === 0) return { ...empty, data: good };
    // 坏条隔离：保留其余，并记日志（恢复场景由调用方写回清洗后的数据）
    logger.warn(`[library] ${key} 发现 ${bad.length} 条损坏记录，已隔离保留其余`, {
      operation: "书库恢复",
    });
    return { ...empty, data: good, quarantined: bad, primaryFailed: false };
  }

  // 2) 主索引损坏/缺失 → 回退 .bak
  const corrupt = primaryThrew || (primary !== undefined && !Array.isArray(primary));
  if (corrupt) {
    try {
      const bak = await plugin.loadData?.(backupKeyOf(key));
      if (Array.isArray(bak)) {
        const { good, bad } = partition(bak, validate);
        logger.warn(
          `[library] ${key} 主索引损坏，已从 .bak 恢复 ${good.length} 条` +
            (bad.length ? `（另有 ${bad.length} 条坏条被隔离）` : ""),
          { operation: "书库恢复" }
        );
        return {
          data: good,
          quarantined: bad,
          primaryFailed: true,
          recoveredFromBackup: true,
        };
      }
    } catch {
      /* .bak 也不可用 */
    }
    logger.warn(
      `[library] ${key} 主索引与 .bak 均不可用，书架降级为空（未影响其他数据）`,
      { operation: "书库恢复" }
    );
    return { ...empty, primaryFailed: true, recoveredFromBackup: false };
  }

  // 3) 主索引不存在（首次运行）→ 正常空架，不告警
  return empty;
}

/**
 * 保存书库索引（安全写盘核心）。
 * - 立即写主索引 + 指数退避重试（200/400/800ms，最多 3 次）；
 * - 写成功后镜像 .bak（best-effort，备份失败仅记日志不阻断）；
 * - 最终失败经 reportError 上报（不再静默吞掉 console.warn）。
 * @returns 主索引是否写入成功（备份镜像失败不计入失败）。
 */
export async function saveLibraryIndex<T>(
  plugin: PersistBackend,
  key: string,
  data: T[],
  onError?: (e: unknown) => void
): Promise<boolean> {
  const bakKey = backupKeyOf(key);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      await plugin.saveData?.(key, data);
      // 主索引写成功 → 镜像 .bak（best-effort）
      try {
        await plugin.saveData?.(bakKey, data);
      } catch {
        getLogger().warn(`[library] ${key} 主索引已写，.bak 镜像失败`, {
          operation: "书库备份",
        });
      }
      return true;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) {
        const backoff = 200 * Math.pow(2, attempt); // 200, 400, 800ms
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  reportError(lastErr, `书库持久化失败(${key})`);
  onError?.(lastErr);
  return false;
}

/** 把数组按校验器拆成「好条 / 坏条」 */
function partition<T>(
  arr: unknown[],
  validate: (x: unknown) => x is T
): { good: T[]; bad: unknown[] } {
  const good: T[] = [];
  const bad: unknown[] = [];
  for (const item of arr) {
    if (validate(item)) good.push(item);
    else bad.push(item);
  }
  return { good, bad };
}
