/**
 * REword · 待办与日历同步（Todo & Calendar Sync）类型定义
 * ------------------------------------------------------------------
 * 设计要点（2026-09-13，均已内核级查证）：
 *  - 待办 = 思源原生待办块：`type='i' subtype='t'`（由 markdown `- [ ] 文本` 自动生成，
 *    同时会生成一层 `type='l' subtype='t'` 的列表容器）。
 *  - 截止时间存块自定义属性 **`custom-due`**，格式 `YYYY-MM-DDTHH:MM`（本地时间，无时区），
 *    与 CalDAV VEVENT 的 `DTSTART` 同源，免二次转换。
 *  - 完成态**只存在于块 markdown**（`- [x] ...` / `- [ ] ...`）——`content` 与 `ial` 都不变。
 *  - 块属性落在 blocks 表的 **`ial`** 列（⚠️ 该表**没有** `attrs` 列）。
 *  - CalDAV 的 VEVENT `UID` 直接用块 ID，天然一对一，无需额外映射表。
 */

/**
 * 内置 Radicale 服务的管控方式：
 *  - `follow`：插件接管——思源启动时拉起服务，思源退出时停止
 *  - `manual`：仅由设置面板里的按钮手动启停
 */
export type ServiceMode = "follow" | "manual";

/** CalDAV 同步设置（持久化于 hiword-calendar.json） */
export interface CalendarSyncSettings {
  /** 是否启用「同步到日历」 */
  enabled: boolean;
  /** CalDAV 服务器根地址，如 http://192.168.10.191:5232 */
  serverUrl: string;
  username: string;
  password: string;
  /** 日历集合路径（相对服务器根，形如 /test/reword/） */
  calendarPath: string;
  /** 事件默认时长（分钟） */
  defaultDurationMinutes: number;
  /** 提醒提前量（分钟，0 = 事件开始时提醒） */
  reminderMinutes: number;
  /** 托管待办文档的 hpath（默认 /Reword/待办） */
  managedDocPath: string;
  /** Radicale 服务管控方式（默认 follow = 插件跟随思源启停） */
  serviceMode: ServiceMode;
  /**
   * 服务解释器路径。留空则用内置默认 `~/.caldav-test/venv/bin/python`。
   * 插件据此执行 `<解释器> -m radicale --config <配置文件>`。
   */
  servicePythonPath: string;
  /** 服务配置文件路径。留空则用内置默认 `~/.caldav-test/radicale.conf`。 */
  serviceConfigPath: string;
}

export const DEFAULT_CALENDAR_SETTINGS: CalendarSyncSettings = {
  enabled: false,
  serverUrl: "",
  username: "",
  password: "",
  calendarPath: "",
  defaultDurationMinutes: 30,
  reminderMinutes: 0,
  managedDocPath: "/Reword/待办",
  serviceMode: "follow",
  servicePythonPath: "",
  serviceConfigPath: "",
};

/** 内置默认服务路径（设置项留空时回退到这两个） */
export const DEFAULT_SERVICE_PYTHON = "~/.caldav-test/venv/bin/python";
export const DEFAULT_SERVICE_CONFIG = "~/.caldav-test/radicale.conf";

/** 服务运行状态（供设置页 / 面板展示） */
export interface ServiceStatus {
  /** 端口是否在监听 */
  running: boolean;
  /** 是否是本插件拉起的（pidfile 与之匹配） */
  owned: boolean;
  /** 侦测到的进程号（无则 null） */
  pid: number | null;
  /** 服务程序路径是否已就位 */
  programFound: boolean;
  /** 面向用户的一句话状态说明 */
  detail: string;
}

/** 持久化文件名（petal：data/storage/petal/<plugin>/hiword-calendar.json） */
export const CALENDAR_STORAGE_KEY = "hiword-calendar.json";

/** 单条待办的同步快照（用于增量：只比对变化才 PUT/DELETE） */
export interface SyncEntry {
  /** 上次同步的 due（YYYY-MM-DDTHH:MM） */
  due: string;
  /** 上次同步时的事件标题 */
  title: string;
}

export interface CalendarSyncState {
  /** 上次同步时间戳（ms） */
  lastSyncAt: number;
  /** blockId -> 快照 */
  entries: Record<string, SyncEntry>;
  /** 上次同步的错误信息（空串 = 无错） */
  lastError: string;
  /** 托管待办文档 ID（首次创建后缓存，免每次查路径） */
  managedDocId: string;
}

/** 一条待办（由思源待办块投影而来，供 UI / 同步共用） */
export interface TodoItem {
  blockId: string;
  /** 纯文本标题（已去掉列表标记） */
  title: string;
  /** YYYY-MM-DDTHH:MM（本地）或 ''（无截止） */
  due: string;
  done: boolean;
  /** 所在文档可读路径 */
  hpath: string;
  /** 是否位于插件托管的「Reword 待办」文档内 */
  managed: boolean;
}

/** 面板/同步模块所需的最小宿主能力（避免与 index.ts 循环依赖） */
export interface CalendarHost {
  /** 当前激活文档根 ID（可空） */
  currentRootId: string | null;
  /** 同步设置与状态（由 index.ts 持有并注入） */
  calendarStore: CalendarStoreLike;
  /** 提示条 */
  showMessage(msg: string, timeout?: number, type?: string): void;
  /** 请求刷新所有已打开的待办日历面板 */
  refreshCalendarPanels(): void;
}

/** CalendarStore 的最小接口（供 model / panel 消费，避免类型循环） */
export interface CalendarStoreLike {
  settings(): CalendarSyncSettings;
  updateSettings(patch: Partial<CalendarSyncSettings>): Promise<void>;
  state(): CalendarSyncState;
  setEntry(blockId: string, entry: SyncEntry | null): Promise<void>;
  replaceEntries(entries: Record<string, SyncEntry>): Promise<void>;
  setLastSync(at: number, error?: string): Promise<void>;
  managedDocId(): string;
  setManagedDocId(id: string): Promise<void>;
}
