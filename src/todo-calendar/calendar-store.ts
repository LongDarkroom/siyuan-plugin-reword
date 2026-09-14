/**
 * REword · 日历同步存储（Calendar Store）
 * ------------------------------------------------------------------
 * 持久化于 petal：`hiword-calendar.json`（与 hiword-daily-plan.json 同模式）。
 * 保存两块内容：
 *   - settings：CalDAV 连接参数（服务器/账户/密码/集合路径/提醒提前量）
 *   - state：同步状态（上次同步时间、每条待办的上次同步快照、托管文档 ID）
 *
 * 增量同步靠 state.entries（blockId → {due,title}）比对：
 * 只有 due / title 变化才重新 PUT，被删/被勾选完成的才 DELETE。
 */
import {
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarSyncSettings,
  type CalendarSyncState,
  type SyncEntry,
} from "./types.ts";

interface CalendarPersistShape {
  settings: CalendarSyncSettings;
  state: CalendarSyncState;
}

function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}

function num(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function bool(v: unknown, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}

export class CalendarStore {
  private settingsData: CalendarSyncSettings = { ...DEFAULT_CALENDAR_SETTINGS };
  private stateData: CalendarSyncState = {
    lastSyncAt: 0,
    entries: {},
    lastError: "",
    managedDocId: "",
  };
  private loaded = false;

  constructor(private onChange: () => void | Promise<void>) {}

  load(raw: unknown): void {
    const r = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
    const s = r.settings && typeof r.settings === "object" ? r.settings : {};
    const st = r.state && typeof r.state === "object" ? r.state : {};

    this.settingsData = {
      enabled: bool(s.enabled, DEFAULT_CALENDAR_SETTINGS.enabled),
      serverUrl: str(s.serverUrl, DEFAULT_CALENDAR_SETTINGS.serverUrl).trim(),
      username: str(s.username, DEFAULT_CALENDAR_SETTINGS.username),
      password: str(s.password, DEFAULT_CALENDAR_SETTINGS.password),
      calendarPath: str(s.calendarPath, DEFAULT_CALENDAR_SETTINGS.calendarPath).trim(),
      defaultDurationMinutes: Math.max(5, Math.min(1440, num(s.defaultDurationMinutes, DEFAULT_CALENDAR_SETTINGS.defaultDurationMinutes))),
      reminderMinutes: Math.max(0, Math.min(1440, num(s.reminderMinutes, DEFAULT_CALENDAR_SETTINGS.reminderMinutes))),
      managedDocPath: str(s.managedDocPath, DEFAULT_CALENDAR_SETTINGS.managedDocPath) || DEFAULT_CALENDAR_SETTINGS.managedDocPath,
      serviceMode: s.serviceMode === "manual" ? "manual" : "follow",
      servicePythonPath: str(s.servicePythonPath, DEFAULT_CALENDAR_SETTINGS.servicePythonPath).trim(),
      serviceConfigPath: str(s.serviceConfigPath, DEFAULT_CALENDAR_SETTINGS.serviceConfigPath).trim(),
    };

    const entries: Record<string, SyncEntry> = {};
    const rawEntries = st.entries && typeof st.entries === "object" ? st.entries : {};
    for (const [k, v] of Object.entries(rawEntries as Record<string, any>)) {
      if (!k || !v || typeof v !== "object") continue;
      entries[k] = { due: str(v.due), title: str(v.title) };
    }

    this.stateData = {
      lastSyncAt: num(st.lastSyncAt, 0),
      entries,
      lastError: str(st.lastError),
      managedDocId: str(st.managedDocId),
    };
    this.loaded = true;
  }

  export(): CalendarPersistShape {
    return {
      settings: { ...this.settingsData },
      state: {
        lastSyncAt: this.stateData.lastSyncAt,
        lastError: this.stateData.lastError,
        managedDocId: this.stateData.managedDocId,
        entries: { ...this.stateData.entries },
      },
    };
  }

  private async persist(): Promise<void> {
    if (!this.loaded) return;
    await this.onChange?.();
  }

  /* ---------- settings ---------- */

  settings(): CalendarSyncSettings {
    return { ...this.settingsData };
  }

  async updateSettings(patch: Partial<CalendarSyncSettings>): Promise<void> {
    Object.assign(this.settingsData, patch);
    await this.persist();
  }

  /* ---------- state ---------- */

  state(): CalendarSyncState {
    return {
      lastSyncAt: this.stateData.lastSyncAt,
      lastError: this.stateData.lastError,
      managedDocId: this.stateData.managedDocId,
      entries: { ...this.stateData.entries },
    };
  }

  async setEntry(blockId: string, entry: SyncEntry | null): Promise<void> {
    if (entry) this.stateData.entries[blockId] = { due: entry.due, title: entry.title };
    else delete this.stateData.entries[blockId];
    await this.persist();
  }

  async replaceEntries(entries: Record<string, SyncEntry>): Promise<void> {
    this.stateData.entries = { ...entries };
    await this.persist();
  }

  async setLastSync(at: number, error = ""): Promise<void> {
    this.stateData.lastSyncAt = at;
    this.stateData.lastError = error;
    await this.persist();
  }

  managedDocId(): string {
    return this.stateData.managedDocId;
  }

  async setManagedDocId(id: string): Promise<void> {
    if (this.stateData.managedDocId === id) return;
    this.stateData.managedDocId = id;
    await this.persist();
  }

  /** 测试辅助 */
  __resetForTest(patch?: Partial<CalendarSyncSettings>): void {
    this.settingsData = { ...DEFAULT_CALENDAR_SETTINGS, ...patch };
    this.stateData = { lastSyncAt: 0, entries: {}, lastError: "", managedDocId: "" };
    this.loaded = true;
  }
}
